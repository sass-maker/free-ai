import { afterEach, describe, expect, it, vi } from 'vitest';

import { getModelKey, getModelRegistry } from '../src/config';
import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

describe('GET /v1/routing/status', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns operator-readable fallback readiness without authentication', async () => {
    const { env } = makeTestEnv({
      GEMINI_API_KEY: 'gemini-test-key',
      GROQ_API_KEY: 'groq-test-key',
    });
    const [cooldownCandidate, healthyCandidate] = getModelRegistry(env);
    const now = Date.now();

    const { env: healthEnv } = makeTestEnv({
      GEMINI_API_KEY: 'gemini-test-key',
      GROQ_API_KEY: 'groq-test-key',
      healthSnapshots: [
        {
          key: getModelKey(cooldownCandidate.provider, cooldownCandidate.model),
          attempts: 10,
          successRate: 0.4,
          avgLatencyMs: 7_500,
          p90LatencyMs: 7_500,
          p99LatencyMs: 7_500,
          cooldownUntil: now + 60_000,
          headroom: 1,
          dailyUsed: 5,
          dailyLimit: 100,
          shortRetriableFailures: 3,
        },
        {
          key: getModelKey(healthyCandidate.provider, healthyCandidate.model),
          attempts: 20,
          successRate: 0.95,
          avgLatencyMs: 450,
          p90LatencyMs: 450,
          p99LatencyMs: 450,
          cooldownUntil: 0,
          headroom: 0.8,
          dailyUsed: 20,
          dailyLimit: 100,
          shortRetriableFailures: 0,
        },
      ],
    });

    const res = await app.fetch(
      new Request('https://gateway.test/v1/routing/status'),
      healthEnv,
      makeCtx()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { configured_models: number; fallback_ready: boolean; top_provider: string | null };
      fallback_order: Array<{ id: string; status: string; reasons: string[] }>;
      providers: Record<
        string,
        { configured_models: number; available_models: number; best_model: string | null }
      >;
    };

    expect(body.summary.configured_models).toBeGreaterThan(1);
    expect(body.summary.fallback_ready).toBe(true);
    expect(body.summary.top_provider).toBeTruthy();
    expect(
      body.fallback_order.some(
        (item) => item.id === healthyCandidate.id && item.status === 'available'
      )
    ).toBe(true);
    expect(
      body.fallback_order.some(
        (item) => item.id === cooldownCandidate.id && item.status === 'cooldown'
      )
    ).toBe(true);
    expect(body.fallback_order.find((item) => item.id === cooldownCandidate.id)?.reasons).toContain(
      'in_cooldown'
    );
    expect(body.providers[healthyCandidate.provider]?.configured_models).toBeGreaterThan(0);
    expect(body.providers[healthyCandidate.provider]?.best_model).toBeTruthy();
  });

  it('ranks quota-exhausted providers after routable models', async () => {
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

    const { env } = makeTestEnv({
      OPENROUTER_API_KEY: 'openrouter-test-key',
      GROQ_API_KEY: 'groq-test-key',
    });

    const res = await app.fetch(
      new Request('https://gateway.test/v1/routing/status'),
      env,
      makeCtx()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fallback_order: Array<{ provider: string; status: string; reasons: string[] }>;
      summary: { top_provider: string | null };
    };

    expect(body.summary.top_provider).not.toBe('openrouter');
    expect(body.fallback_order[0]?.provider).not.toBe('openrouter');
    expect(
      body.fallback_order.some(
        (item) => item.provider === 'openrouter' && item.status === 'exhausted'
      )
    ).toBe(true);
    expect(
      body.fallback_order
        .filter((item) => item.provider === 'openrouter')
        .every((item) => item.reasons.includes('provider_quota_exhausted'))
    ).toBe(true);
  });
});
