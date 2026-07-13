import { describe, expect, it } from 'vitest';

import {
  getBenchmarkOptimizerFixture,
  type BenchmarkExperimentCreateResponse,
  type BenchmarkOptimizerResponse,
} from '../src/benchmark/cost-optimizer';
import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

async function fetchRoute(path: string, init: RequestInit = {}) {
  const { env } = makeTestEnv();
  return app.fetch(new Request(`https://gateway.test${path}`, init), env, makeCtx());
}

describe('Benchmark cost optimizer prototype', () => {
  it('fixture includes at least three provider/model candidates', () => {
    const fixture = getBenchmarkOptimizerFixture();
    const providers = new Set(fixture.candidates.map((c) => c.provider));

    expect(fixture.candidates.length).toBeGreaterThanOrEqual(3);
    expect(providers.size).toBeGreaterThanOrEqual(3);
    expect(fixture.workloads.length).toBeGreaterThanOrEqual(3);
    expect(fixture.routes_by_workload.length).toBe(fixture.workloads.length);
    expect(fixture.experiments.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /v1/benchmark/optimizer returns fixture JSON', async () => {
    const res = await fetchRoute('/v1/benchmark/optimizer');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');

    const body = (await res.json()) as BenchmarkOptimizerResponse;
    expect(body.ok).toBe(true);
    expect(body.source).toBe('fixture');
    expect(body.candidates.length).toBeGreaterThanOrEqual(3);
    expect(body.candidates[0]).toMatchObject({
      provider: expect.any(String),
      model: expect.any(String),
      cost_usd_per_1m_tokens: expect.any(Number),
      latency_ms_p50: expect.any(Number),
      success_rate: expect.any(Number),
      quality_tier: expect.stringMatching(/^(low|medium|high)$/),
      cooldown_until: expect.any(Number),
    });
    expect(body.routes_by_workload[0].recommended).toMatchObject({
      id: expect.any(String),
      reason: expect.any(String),
    });
  });

  it('GET /benchmark serves the optimizer HTML dashboard', async () => {
    const res = await fetchRoute('/benchmark');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    expect(res.headers.get('cache-control') ?? '').toContain('no-store');

    const html = await res.text();
    expect(html).toContain('<title>AI Gateway - Benchmark &amp; Cost Optimizer</title>');
    expect(html).toContain('Model benchmark matrix');
    expect(html).toContain('Recommended route by workload');
    expect(html).toContain('Experiment ledger');
    expect(html).toContain("fetch('/v1/benchmark/optimizer')");
    expect(html).toContain("fetch('/v1/benchmark/experiments'");
  });

  it('POST /v1/benchmark/experiments returns a ledger entry for client merge', async () => {
    const res = await fetchRoute('/v1/benchmark/experiments', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
      },
      body: JSON.stringify({
        label: 'Test experiment snapshot',
        change: 'latency weight trial',
        baseline_id: 'exp-baseline-2026-06-01',
        notes: 'vitest prototype entry',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as BenchmarkExperimentCreateResponse;
    expect(body.ok).toBe(true);
    expect(body.stored).toBe('session_fixture_only');
    expect(body.entry.label).toBe('Test experiment snapshot');
    expect(body.entry.baseline_id).toBe('exp-baseline-2026-06-01');
    expect(body.entry.metrics.avg_latency_ms).toBeGreaterThan(0);
  });
});
