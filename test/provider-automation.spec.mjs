import { describe, expect, it, vi } from 'vitest';

import {
  evaluateLiveProviderHealth,
  runLiveProviderHealth,
} from '../scripts/check-live-provider-health.mjs';
import { buildRegistryReport, parseConfigModels } from '../scripts/check-model-ids.mjs';
import { runTextProviderSmoke } from '../scripts/smoke-text-providers.mjs';
import { getProviderLimits } from '../src/config';

describe('live provider health automation', () => {
  it('accepts fresh fallback-ready health with a bounded failure rate', () => {
    const now = Date.parse('2026-08-07T10:00:00.000Z');
    const report = evaluateLiveProviderHealth(
      {
        routing: {
          ok: true,
          generated_at: '2026-08-07T09:59:30.000Z',
          summary: {
            configured_models: 8,
            available_models: 2,
            degraded_models: 1,
            cooldown_models: 0,
            exhausted_models: 0,
            fallback_ready: true,
            top_provider: 'groq',
          },
          providers: { groq: { degraded_models: 0 } },
        },
        quotas: { quotas: {} },
        analytics: {
          total_requests: 100,
          failed_requests: 10,
          daily: [{ date: '2026-08-07', requests: 20, successful: 18, failed: 2 }],
        },
      },
      now
    );

    expect(report).toMatchObject({ ok: true, freshness_seconds: 30 });
    expect(report.analytics_7d.failure_rate).toBe(0.1);
    expect(report.analytics_7d.daily[0].failure_rate).toBe(0.1);
  });

  it('fails on lost fallback readiness and elevated recent failures', () => {
    const now = Date.parse('2026-08-07T10:00:00.000Z');
    const report = evaluateLiveProviderHealth(
      {
        routing: {
          ok: true,
          generated_at: '2026-08-07T09:59:30.000Z',
          summary: {
            configured_models: 8,
            available_models: 1,
            degraded_models: 0,
            fallback_ready: false,
          },
          providers: {},
        },
        quotas: {
          quotas: { openrouter: { provider: 'openrouter', status: 'exhausted' } },
        },
        analytics: { total_requests: 100, failed_requests: 31, daily: [] },
      },
      now
    );

    expect(report.ok).toBe(false);
    expect(report.quotas.exhausted_providers).toEqual(['openrouter']);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        'gateway is not fallback ready',
        'fewer than two routable models are available',
        '7-day failure rate 31.0% exceeds 20%',
      ])
    );
  });

  it('warns on provider concentration without declaring healthy routing failed', () => {
    const now = Date.parse('2026-08-07T10:00:00.000Z');
    const report = evaluateLiveProviderHealth(
      {
        routing: {
          ok: true,
          generated_at: '2026-08-07T09:59:30.000Z',
          summary: {
            configured_models: 8,
            available_models: 2,
            degraded_models: 1,
            fallback_ready: true,
          },
          providers: {},
        },
        quotas: { quotas: {} },
        analytics: {
          total_requests: 120,
          successful_requests: 115,
          failed_requests: 5,
          providers: {
            mistral: { requests: 105, successful: 103, failed: 2 },
            cerebras: { requests: 15, successful: 12, failed: 3 },
          },
          daily: [],
        },
      },
      now
    );

    expect(report.ok).toBe(true);
    expect(report.analytics_7d.provider_concentration).toMatchObject({
      attributed_successes: 115,
      top_provider: 'mistral',
      top_provider_successes: 103,
    });
    expect(report.analytics_7d.provider_concentration.share).toBeCloseTo(103 / 115);
    expect(report.warnings).toEqual(['mistral supplied 89.6% of attributed successes']);
  });

  it('turns endpoint failures into an unhealthy structured report', async () => {
    const report = await runLiveProviderHealth({
      baseUrl: 'https://gateway.test',
      fetchImpl: vi.fn(async () => new Response('unavailable', { status: 503 })),
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(7);
    expect(report.errors[0]).toContain('returned HTTP 503');
  });
});

describe('bounded text-provider smoke', () => {
  it('skips without a gateway key and makes no provider calls', async () => {
    const fetchImpl = vi.fn();
    const report = await runTextProviderSmoke({ fetchImpl, gatewayKey: '' });

    expect(report).toMatchObject({ ok: true, status: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks one enabled model per provider, excludes Workers AI, and caps output', async () => {
    const replayBodies = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (String(url).endsWith('/v1/models')) {
        return Response.json({
          data: [
            { id: 'groq-a', provider: 'groq', type: 'chat', enabled: true },
            { id: 'groq-b', provider: 'groq', type: 'chat', enabled: true },
            { id: 'workers', provider: 'workers_ai', type: 'chat', enabled: true },
            { id: 'disabled', provider: 'gemini', type: 'chat', enabled: false },
            { id: 'cerebras-a', provider: 'cerebras', type: 'chat', enabled: true },
          ],
        });
      }
      replayBodies.push(JSON.parse(init.body));
      return Response.json({ ok: true });
    });

    const report = await runTextProviderSmoke({
      baseUrl: 'https://gateway.test',
      gatewayKey: 'test-key',
      fetchImpl,
    });

    expect(report).toMatchObject({ ok: true, providers_checked: 2, max_output_tokens: 8 });
    expect(replayBodies.map((body) => body.provider)).toEqual(['groq', 'cerebras']);
    expect(replayBodies.every((body) => body.max_tokens === 8)).toBe(true);
    expect(replayBodies.every((body) => body.include_completion === false)).toBe(true);
  });

  it('retains only the numeric upstream status and error class from failed replay responses', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/v1/models')) {
        return Response.json({
          data: [{ id: 'gemini-a', provider: 'gemini', type: 'chat', enabled: true }],
        });
      }
      return Response.json(
        {
          ok: false,
          error: {
            message: 'token=secret-token https://provider.example/v1/chat raw-response-secret',
            type: 'provider_fatal',
            upstream_status: 403,
            headers: { authorization: 'Bearer secret-token' },
          },
        },
        { status: 502 }
      );
    });

    const report = await runTextProviderSmoke({
      baseUrl: 'https://gateway.test',
      gatewayKey: 'test-key',
      fetchImpl,
    });

    expect(report.ok).toBe(false);
    expect(report.results).toEqual([
      expect.objectContaining({
        provider: 'gemini',
        model: 'gemini-a',
        status: 502,
        error: 'provider_fatal',
        upstream_status: 403,
      }),
    ]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('provider.example');
    expect(serialized).not.toContain('raw-response-secret');
    expect(serialized).not.toContain('authorization');
  });

  it.each([undefined, null, '403', 0, 99, 600, 403.5])(
    'uses null for invalid upstream status %s',
    async (upstreamStatus) => {
      const fetchImpl = vi.fn(async (url) => {
        if (String(url).endsWith('/v1/models')) {
          return Response.json({
            data: [{ id: 'gemini-a', provider: 'gemini', type: 'chat', enabled: true }],
          });
        }
        return Response.json(
          {
            ok: false,
            error: { type: 'provider_fatal', upstream_status: upstreamStatus },
          },
          { status: 502 }
        );
      });

      const report = await runTextProviderSmoke({
        baseUrl: 'https://gateway.test',
        gatewayKey: 'test-key',
        fetchImpl,
      });

      expect(report.results[0]).toMatchObject({
        status: 502,
        error: 'provider_fatal',
        upstream_status: null,
      });
    }
  );

  it('drops an unrecognized error class from smoke output', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/v1/models')) {
        return Response.json({
          data: [{ id: 'gemini-a', provider: 'gemini', type: 'chat', enabled: true }],
        });
      }
      return Response.json(
        {
          ok: false,
          error: { type: 'token=secret-token https://provider.example' },
        },
        { status: 502 }
      );
    });

    const report = await runTextProviderSmoke({
      baseUrl: 'https://gateway.test',
      gatewayKey: 'test-key',
      fetchImpl,
    });

    expect(report.results[0]).toMatchObject({
      status: 502,
      error: null,
      upstream_status: null,
    });
    expect(JSON.stringify(report)).not.toContain('secret-token');
    expect(JSON.stringify(report)).not.toContain('provider.example');
  });

  it('does not retain raw fetch exception messages in smoke results', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/v1/models')) {
        return Response.json({
          data: [{ id: 'gemini-a', provider: 'gemini', type: 'chat', enabled: true }],
        });
      }
      throw new Error('token=secret-token https://provider.example/v1/chat');
    });

    const report = await runTextProviderSmoke({
      baseUrl: 'https://gateway.test',
      gatewayKey: 'test-key',
      fetchImpl,
    });

    expect(report.results[0]).toMatchObject({
      status: null,
      error: 'request_failed',
      upstream_status: null,
    });
    expect(JSON.stringify(report)).not.toContain('secret-token');
    expect(JSON.stringify(report)).not.toContain('provider.example');
  });
});

describe('OpenRouter catalog metadata retirement', () => {
  it('does not leave retired inactive aliases as stale checker entries', () => {
    const report = buildRegistryReport(parseConfigModels(), [
      {
        provider: 'openrouter',
        status: 'ok',
        reason: null,
        all: new Set(['dots-studio/dots-3-note-preview:free']),
        addable: new Set(),
      },
    ]);
    const staleIds = report.stale.map((model) => model.id);

    expect(staleIds).not.toContain('openrouter-qwen-qwen3-8-27b-free');
    expect(staleIds).not.toContain('openrouter-stealth-space-bunny-alpha');
  });

  it('removes the Qwen quota after its only disabled model is retired', () => {
    const limits = getProviderLimits({});

    expect(limits['openrouter:qwen/qwen3.8-27b:free']).toBeUndefined();
  });
});
