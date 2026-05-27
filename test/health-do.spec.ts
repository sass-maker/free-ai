import { describe, expect, it, vi } from 'vitest';

import { HealthStateDO } from '../src/state/health-do';

function makeState() {
  const storage = new Map<string, unknown>();

  return {
    storage: {
      list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => {
        const entries = [...storage.entries()].filter(([key]) => !prefix || key.startsWith(prefix));
        return new Map(entries);
      }),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value);
      }),
      get: vi.fn(async (key: string) => storage.get(key)),
      setAlarm: vi.fn(async () => {}),
    },
  } as unknown as DurableObjectState;
}

describe('HealthStateDO', () => {
  it('does not invent a daily limit when snapshot limits are unavailable', async () => {
    const state = makeState();
    const health = new HealthStateDO(state, {});

    await health.fetch(
      new Request('https://internal.local/record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'groq:test-model',
          success: true,
          latencyMs: 1234,
          now: Date.UTC(2026, 4, 27),
        }),
      }),
    );

    const res = await health.fetch(new Request('https://internal.local/snapshot'));
    const body = (await res.json()) as {
      snapshots: Array<{ dailyUsed: number; dailyLimit: number | null; headroom: number }>;
    };

    expect(body.snapshots).toHaveLength(1);
    expect(body.snapshots[0]).toMatchObject({
      dailyUsed: 1,
      dailyLimit: null,
      headroom: 1,
    });
  });

  it('reports average, p90, and p99 latency from the rolling attempt window', async () => {
    const state = makeState();
    const health = new HealthStateDO(state, {});
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 10_000];

    for (const [index, latencyMs] of latencies.entries()) {
      await health.fetch(
        new Request('https://internal.local/record', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            key: 'groq:test-model',
            success: true,
            latencyMs,
            now: Date.UTC(2026, 4, 27) + index,
          }),
        }),
      );
    }

    const res = await health.fetch(new Request('https://internal.local/snapshot'));
    const body = (await res.json()) as {
      snapshots: Array<{ avgLatencyMs: number; p90LatencyMs: number; p99LatencyMs: number }>;
    };

    expect(body.snapshots[0]).toMatchObject({
      avgLatencyMs: 1450,
      p90LatencyMs: 900,
      p99LatencyMs: 10_000,
    });
  });
});
