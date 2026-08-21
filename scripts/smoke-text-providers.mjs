#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.FREE_AI_BASE_URL || 'https://ai-gateway.sassmaker.com';
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 8;

function oneEnabledModelPerProvider(payload, includeWorkersAi) {
  const selected = new Map();
  for (const model of Array.isArray(payload?.data) ? payload.data : []) {
    if (model?.type !== 'chat' || model.enabled === false || !model.provider || !model.id) continue;
    if (!includeWorkersAi && model.provider === 'workers_ai') continue;
    if (!selected.has(model.provider)) selected.set(model.provider, model);
  }
  return [...selected.values()];
}

async function requestJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function skippedResult(baseUrl) {
  return {
    ok: true,
    status: 'skipped',
    reason: 'GATEWAY_API_KEY is not configured',
    base_url: baseUrl,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    results: [],
  };
}

function modelsFailedResult(baseUrl, status) {
  return {
    ok: false,
    status: 'failed',
    reason: `/v1/models returned HTTP ${status}`,
    base_url: baseUrl,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    results: [],
  };
}

async function smokeSingleProvider(fetchImpl, baseUrl, gatewayKey, model) {
  const startedAt = Date.now();
  try {
    const replay = await requestJson(fetchImpl, `${baseUrl}/v1/debug/replay`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${gatewayKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: model.provider,
        model: model.id,
        project_id: 'scheduled-provider-smoke',
        messages: [{ role: 'user', content: 'Reply OK.' }],
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
        include_completion: false,
      }),
    });
    return {
      provider: model.provider,
      model: model.id,
      ok: replay.response.ok && replay.body?.ok === true,
      status: replay.response.status,
      latency_ms: Date.now() - startedAt,
      error: replay.body?.error?.type ?? null,
    };
  } catch (error) {
    return {
      provider: model.provider,
      model: model.id,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runTextProviderSmoke(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const gatewayKey = options.gatewayKey ?? process.env.GATEWAY_API_KEY;
  const includeWorkersAi = options.includeWorkersAi ?? false;

  if (!gatewayKey) {
    return skippedResult(baseUrl);
  }

  try {
    const modelsResponse = await requestJson(fetchImpl, `${baseUrl}/v1/models`, {
      headers: { Accept: 'application/json' },
    });
    if (!modelsResponse.response.ok) {
      return modelsFailedResult(baseUrl, modelsResponse.response.status);
    }

    const models = oneEnabledModelPerProvider(modelsResponse.body, includeWorkersAi);
    const results = [];
    for (const model of models) {
      results.push(await smokeSingleProvider(fetchImpl, baseUrl, gatewayKey, model));
    }

    return {
      ok: models.length > 0 && results.every((result) => result.ok),
      status: models.length > 0 ? 'completed' : 'failed',
      reason: models.length > 0 ? null : 'no enabled text providers found',
      base_url: baseUrl,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      included_workers_ai: includeWorkersAi,
      providers_checked: results.length,
      results,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      base_url: baseUrl,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      results: [],
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runTextProviderSmoke({
    includeWorkersAi: process.argv.includes('--include-workers-ai'),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
