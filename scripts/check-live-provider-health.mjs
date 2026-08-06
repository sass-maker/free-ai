#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.FREE_AI_BASE_URL || 'https://ai-gateway.sassmaker.com';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_AGE_MS = 5 * 60 * 1_000;
const FAILURE_RATE_MIN_REQUESTS = 20;
const FAILURE_RATE_LIMIT = 0.2;
const CONCENTRATION_MIN_SUCCESSES = 100;
const CONCENTRATION_WARNING_LIMIT = 0.85;

function finiteNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function evaluateLiveProviderHealth(payloads, now = Date.now()) {
  const routing = payloads.routing ?? {};
  const quotas = payloads.quotas?.quotas ?? {};
  const analytics = payloads.analytics ?? {};
  const errors = Array.isArray(payloads.errors) ? [...payloads.errors] : [];
  const warnings = [];
  const generatedAt = Date.parse(routing.generated_at ?? '');
  const freshnessMs = Number.isFinite(generatedAt) ? Math.max(0, now - generatedAt) : null;
  const summary = routing.summary ?? {};
  const providers = routing.providers ?? {};
  const totalRequests = finiteNumber(analytics.total_requests);
  const failedRequests = finiteNumber(analytics.failed_requests);
  const failureRate =
    totalRequests > 0 ? failedRequests / totalRequests : finiteNumber(analytics.failure_rate);
  const providerSuccesses = Object.entries(analytics.providers ?? {})
    .map(([provider, totals]) => ({
      provider,
      successful: finiteNumber(totals?.successful),
    }))
    .sort((a, b) => b.successful - a.successful);
  const attributedSuccesses = providerSuccesses.reduce(
    (sum, provider) => sum + provider.successful,
    0
  );
  const topSuccessfulProvider = providerSuccesses[0] ?? null;
  const providerConcentration =
    topSuccessfulProvider && attributedSuccesses > 0
      ? topSuccessfulProvider.successful / attributedSuccesses
      : 0;
  const daily = (Array.isArray(analytics.daily) ? analytics.daily : []).map((row) => {
    const requests = finiteNumber(row?.requests);
    const failed = finiteNumber(row?.failed);
    return {
      ...row,
      requests,
      failed,
      failure_rate: requests > 0 ? failed / requests : 0,
    };
  });
  const exhaustedProviders = Object.values(quotas)
    .filter((quota) => quota?.status === 'exhausted')
    .map((quota) => quota.provider)
    .filter(Boolean)
    .sort();
  const degradedProviders = Object.entries(providers)
    .filter(([, provider]) => finiteNumber(provider?.degraded_models) > 0)
    .map(([provider]) => provider)
    .sort();

  if (!Number.isFinite(generatedAt)) errors.push('routing response has no valid generated_at');
  else if (freshnessMs > MAX_RESPONSE_AGE_MS) errors.push('routing response is stale');
  if (routing.ok !== true) errors.push('routing endpoint did not report ok');
  if (summary.fallback_ready !== true) errors.push('gateway is not fallback ready');
  if (finiteNumber(summary.available_models) + finiteNumber(summary.degraded_models) < 2) {
    errors.push('fewer than two routable models are available');
  }
  if (totalRequests >= FAILURE_RATE_MIN_REQUESTS && failureRate > FAILURE_RATE_LIMIT) {
    errors.push(
      `7-day failure rate ${(failureRate * 100).toFixed(1)}% exceeds ${(FAILURE_RATE_LIMIT * 100).toFixed(0)}%`
    );
  }
  if (
    attributedSuccesses >= CONCENTRATION_MIN_SUCCESSES &&
    providerConcentration > CONCENTRATION_WARNING_LIMIT
  ) {
    warnings.push(
      `${topSuccessfulProvider?.provider} supplied ${(providerConcentration * 100).toFixed(1)}% of attributed successes`
    );
  }

  return {
    ok: errors.length === 0,
    checked_at: new Date(now).toISOString(),
    freshness_seconds: freshnessMs === null ? null : Math.round(freshnessMs / 1_000),
    routing: {
      configured_models: finiteNumber(summary.configured_models),
      manual_only_models: finiteNumber(summary.manual_only_models),
      available_models: finiteNumber(summary.available_models),
      degraded_models: finiteNumber(summary.degraded_models),
      cooldown_models: finiteNumber(summary.cooldown_models),
      exhausted_models: finiteNumber(summary.exhausted_models),
      fallback_ready: summary.fallback_ready === true,
      top_provider: summary.top_provider ?? null,
      degraded_providers: degradedProviders,
    },
    quotas: {
      checked_providers: Object.keys(quotas).length,
      exhausted_providers: exhaustedProviders,
    },
    analytics_7d: {
      total_requests: totalRequests,
      failed_requests: failedRequests,
      failure_rate: failureRate,
      provider_concentration: {
        attributed_successes: attributedSuccesses,
        top_provider: topSuccessfulProvider?.provider ?? null,
        top_provider_successes: topSuccessfulProvider?.successful ?? 0,
        share: providerConcentration,
        warning_threshold: CONCENTRATION_WARNING_LIMIT,
      },
      daily,
    },
    warnings,
    errors,
  };
}

async function fetchJson(baseUrl, path, fetchImpl) {
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      return { body: null, error: `${path} returned HTTP ${response.status}` };
    }
    return { body, error: null };
  } catch (error) {
    return {
      body: null,
      error: `${path} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function runLiveProviderHealth(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const now = options.now ?? Date.now();
  const [routing, quotas, analytics] = await Promise.all([
    fetchJson(baseUrl, '/v1/routing/status', fetchImpl),
    fetchJson(baseUrl, '/v1/provider-quotas', fetchImpl),
    fetchJson(baseUrl, '/v1/analytics?days=7', fetchImpl),
  ]);
  const errors = [routing.error, quotas.error, analytics.error].filter(Boolean);
  return {
    base_url: baseUrl,
    ...evaluateLiveProviderHealth(
      {
        routing: routing.body,
        quotas: quotas.body,
        analytics: analytics.body,
        errors,
      },
      now
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runLiveProviderHealth();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
