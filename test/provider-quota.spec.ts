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
  capabilities: { toolCalling: false, jsonMode: true, vision: false, contextWindow: 8192, maxOutputTokens: 1024 },
};

describe('provider quota polling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        }),
      ),
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })));

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
