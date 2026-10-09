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
  it('cools only the model with two malformed outputs in the recent window', async () => {
    const state = makeState();
    let health = new HealthStateDO(state, {});
    const now = Date.now();
    const record = async (key: string, malformed = true, success = false) =>
      health.fetch(
        new Request('https://internal.local/record', {
          method: 'POST',
          body: JSON.stringify({
            key,
            success,
            malformed,
            failureClass: 'provider_fatal',
            latencyMs: 10,
            now,
          }),
        })
      );
    const lookup = async (time = now) => {
      const res = await health.fetch(
        new Request('https://internal.local/lookup', {
          method: 'POST',
          body: JSON.stringify({ keys: ['mistral:a', 'mistral:b'], limits: {}, now: time }),
        })
      );
      return ((await res.json()) as { snapshots: Array<{ cooldownUntil: number }> }).snapshots;
    };
    await record('mistral:a');
    await record('mistral:b', false);
    expect((await lookup()).map((s) => s.cooldownUntil)).toEqual([0, 0]);
    await record('mistral:a', false, true);
    await record('mistral:a');
    expect((await lookup()).map((s) => s.cooldownUntil)).toEqual([now + 60_000, 0]);
    health = new HealthStateDO(state, {});
    expect((await lookup())[0].cooldownUntil).toBe(now + 60_000);
    expect((await lookup(now + 60_001))[0].cooldownUntil).toBeLessThan(now + 60_001);
  });

  it('does not count malformed failures outside the short history window', async () => {
    const health = new HealthStateDO(makeState(), {});
    for (let i = 0; i < 12; i += 1) {
      await health.fetch(
        new Request('https://internal.local/record', {
          method: 'POST',
          body: JSON.stringify({
            key: 'mistral:a',
            success: i > 0 && i < 11,
            malformed: i === 0 || i === 11,
            latencyMs: 10,
            now: Date.now(),
          }),
        })
      );
    }
    const res = await health.fetch(new Request('https://internal.local/snapshot'));
    const body = (await res.json()) as { snapshots: Array<{ cooldownUntil: number }> };
    expect(body.snapshots[0].cooldownUntil).toBe(0);
  });

  it('keeps failed key attempts visible without cooling a model recovered by another key', async () => {
    const health = new HealthStateDO(makeState(), {});
    const now = Date.now();
    const record = async (success: boolean, keyRetryPending = false) =>
      health.fetch(
        new Request('https://internal.local/record', {
          method: 'POST',
          body: JSON.stringify({
            key: 'gemini:pinned',
            success,
            keyRetryPending,
            latencyMs: 10,
            failureClass: success ? undefined : 'usage_retriable',
            now,
          }),
        })
      );
    for (let i = 0; i < 6; i += 1) {
      await record(false, true);
      await record(true);
    }
    const before = (await (
      await health.fetch(new Request('https://internal.local/snapshot'))
    ).json()) as {
      snapshots: Array<{
        attempts: number;
        dailyUsed: number;
        cooldownUntil: number;
        shortRetriableFailures: number;
      }>;
    };
    expect(before.snapshots[0]).toMatchObject({
      attempts: 12,
      dailyUsed: 6,
      cooldownUntil: 0,
      shortRetriableFailures: 0,
    });
    await record(false);
    const after = (await (
      await health.fetch(new Request('https://internal.local/snapshot'))
    ).json()) as typeof before;
    expect(after.snapshots[0].cooldownUntil).toBeGreaterThan(now);
    expect(after.snapshots[0].shortRetriableFailures).toBe(1);
  });
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
      })
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
        })
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
