import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProviderQuotaStatuses, providerQuotaAllowsCandidate } from '../src/providers/quota';
import type { Env, ModelCandidate } from '../src/types';
import { makeTestEnv } from './helpers/env';

const candidate: ModelCandidate = {
  id: 'openrouter-test',
  provider: 'openrouter',
  model: 'openrouter/free',
  reasoning: 'medium',
  supportsStreaming: true,
  enabled: true,
  priority: 0.5,
  capabilities: {
    toolCalling: false,
    jsonMode: true,
    vision: false,
    contextWindow: 8192,
    maxOutputTokens: 1024,
  },
};

describe('provider quota polling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { credit: 0, remaining: 12, free: true, paid: false, status: 'ok' },
    { credit: 0, remaining: 0, free: false, paid: false, status: 'exhausted' },
    { credit: 2, remaining: 0, free: false, paid: true, status: 'ok' },
    { credit: -1, remaining: 12, free: false, paid: false, status: 'exhausted' },
    { credit: 0, remaining: '12', free: false, paid: false, status: 'exhausted' },
  ])('separates paid credit from free requests: %j', async (fixture) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            limit_remaining: fixture.credit,
            is_free_tier: false,
            free_model_daily_requests: { limit: 1000, used: 988, remaining: fixture.remaining },
          },
        })
      )
    );
    const { env } = makeTestEnv({ OPENROUTER_API_KEY: 'synthetic-key' });
    const statuses = await getProviderQuotaStatuses(env as Env, ['openrouter']);
    expect(statuses.get('openrouter')).toMatchObject({
      status: fixture.status,
      freeDailyLimit: 1000,
      freeDailyUsed: 988,
    });
    expect(providerQuotaAllowsCandidate({ ...candidate, model: 'acme/model:free' }, statuses)).toBe(
      fixture.free
    );
    expect(providerQuotaAllowsCandidate({ ...candidate, model: 'acme/model' }, statuses)).toBe(
      fixture.paid
    );
  });

  it('does not reuse a credit-only cache entry for the new quota shape', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        data: {
          limit_remaining: 0,
          free_model_daily_requests: { limit: 50, used: 10, remaining: 40 },
        },
      })
    );
    vi.stubGlobal('fetch', fetcher);
    const kv = new Map([
      [
        'provider-quota:openrouter',
        JSON.stringify({
          provider: 'openrouter',
          source: 'openrouter_key',
          status: 'exhausted',
          limitRemaining: 0,
        }),
      ],
    ]);
    const { env } = makeTestEnv({ OPENROUTER_API_KEY: 'synthetic-key', kv });
    for (let i = 0; i < 2; i++) {
      const quotas = await getProviderQuotaStatuses(env as Env, ['openrouter']);
      expect(providerQuotaAllowsCandidate({ ...candidate, model: 'acme/model:free' }, quotas)).toBe(
        true
      );
    }
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('marks OpenRouter exhausted when the key endpoint reports no remaining credit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            limit: 1,
            limit_remaining: 0,
            usage: 1,
            usage_daily: 0,
            is_free_tier: true,
          },
        })
      )
    );

    const { env } = makeTestEnv({ OPENROUTER_API_KEY: 'or-key' });
    const statuses = await getProviderQuotaStatuses(env as Env, ['openrouter']);
    const status = statuses.get('openrouter');

    expect(status).toMatchObject({
      provider: 'openrouter',
      status: 'exhausted',
      source: 'openrouter_key',
    });
    expect(providerQuotaAllowsCandidate(candidate, statuses)).toBe(false);
  });

  it('allows routing when OpenRouter polling fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad gateway', { status: 502 }))
    );

    const { env } = makeTestEnv({ OPENROUTER_API_KEY: 'or-key' });
    const statuses = await getProviderQuotaStatuses(env as Env, ['openrouter']);
    const status = statuses.get('openrouter');

    expect(status).toMatchObject({
      provider: 'openrouter',
      status: 'ok',
      source: 'error',
    });
    expect(providerQuotaAllowsCandidate(candidate, statuses)).toBe(true);
  });
});
