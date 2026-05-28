import type { Env, ModelCandidate, ProviderQuotaStatus, TextProvider } from '../types';

const CACHE_TTL_SECONDS = 300;
const OPENROUTER_FREE_DAILY_LIMIT = 50;

interface OpenRouterKeyResponse {
  data?: {
    label?: string;
    usage?: number;
    limit?: number | null;
    limit_remaining?: number | null;
    usage_daily?: number;
    is_free_tier?: boolean;
    rate_limit?: {
      requests?: number;
      interval?: string;
    };
  };
}

function cacheKey(provider: TextProvider): string {
  return `provider-quota:${provider}`;
}

function fallbackStatus(provider: TextProvider, source: ProviderQuotaStatus['source'], reason?: string): ProviderQuotaStatus {
  return {
    provider,
    status: source === 'unconfigured' ? 'unknown' : 'ok',
    source,
    checkedAt: new Date().toISOString(),
    reason,
  };
}

async function readCachedQuota(env: Env, provider: TextProvider): Promise<ProviderQuotaStatus | null> {
  try {
    return await env.HEALTH_KV.get<ProviderQuotaStatus>(cacheKey(provider), 'json');
  } catch {
    return null;
  }
}

async function writeCachedQuota(env: Env, status: ProviderQuotaStatus): Promise<void> {
  try {
    await env.HEALTH_KV.put(cacheKey(status.provider), JSON.stringify(status), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch {
    // Quota polling is advisory; cache failures should never affect routing.
  }
}

async function fetchOpenRouterQuota(env: Env): Promise<ProviderQuotaStatus> {
  if (!env.OPENROUTER_API_KEY) {
    return fallbackStatus('openrouter', 'unconfigured', 'OPENROUTER_API_KEY is not configured');
  }

  const cached = await readCachedQuota(env, 'openrouter');
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      },
    });

    if (!response.ok) {
      const status = fallbackStatus('openrouter', 'error', `OpenRouter key status returned ${response.status}`);
      await writeCachedQuota(env, status);
      return status;
    }

    const body = (await response.json()) as OpenRouterKeyResponse;
    const data = body.data ?? {};
    const limitRemaining = typeof data.limit_remaining === 'number' ? data.limit_remaining : null;
    const status: ProviderQuotaStatus = {
      provider: 'openrouter',
      status: limitRemaining !== null && limitRemaining <= 0 ? 'exhausted' : 'ok',
      source: 'openrouter_key',
      checkedAt: new Date().toISOString(),
      reason:
        limitRemaining !== null && limitRemaining <= 0
          ? 'OpenRouter key reports no remaining credit limit'
          : data.is_free_tier
            ? 'OpenRouter free-model daily request limit is account-level and not exposed per model'
            : 'OpenRouter key status is usable',
      limitRemaining,
      limit: typeof data.limit === 'number' ? data.limit : null,
      usage: typeof data.usage === 'number' ? data.usage : undefined,
      usageDaily: typeof data.usage_daily === 'number' ? data.usage_daily : undefined,
      isFreeTier: data.is_free_tier,
      freeDailyLimit: data.is_free_tier ? OPENROUTER_FREE_DAILY_LIMIT : undefined,
    };

    await writeCachedQuota(env, status);
    return status;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown polling error';
    const status = fallbackStatus('openrouter', 'error', message);
    await writeCachedQuota(env, status);
    return status;
  }
}

export async function getProviderQuotaStatuses(
  env: Env,
  providers: Iterable<TextProvider>,
): Promise<Map<TextProvider, ProviderQuotaStatus>> {
  const unique = new Set(providers);
  const entries = await Promise.all(
    [...unique].map(async (provider): Promise<[TextProvider, ProviderQuotaStatus]> => {
      if (provider === 'openrouter') {
        return [provider, await fetchOpenRouterQuota(env)];
      }

      return [provider, fallbackStatus(provider, 'not_supported', 'No official cheap quota polling configured')];
    }),
  );

  return new Map(entries);
}

export function providerQuotaAllowsCandidate(
  candidate: ModelCandidate,
  quotas: Map<TextProvider, ProviderQuotaStatus>,
): boolean {
  return quotas.get(candidate.provider)?.status !== 'exhausted';
}
