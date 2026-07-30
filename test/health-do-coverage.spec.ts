import { describe, expect, it, vi } from 'vitest';

import { HealthStateDO } from '../src/state/health-do';
import type { FailureClass } from '../src/types';

interface StateHarness {
  state: DurableObjectState;
  values: Map<string, unknown>;
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  setAlarm: ReturnType<typeof vi.fn>;
}

function makeState(
  initial: Record<string, unknown> = {},
  options: { rejectAlarm?: boolean } = {}
): StateHarness {
  const values = new Map<string, unknown>(Object.entries(initial));
  const list = vi.fn(async ({ prefix }: { prefix?: string } = {}) => {
    const entries = [...values.entries()].filter(([key]) => !prefix || key.startsWith(prefix));
    return new Map(entries);
  });
  const get = vi.fn(async (key: string) => values.get(key));
  const put = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });
  const setAlarm = options.rejectAlarm
    ? vi.fn(async () => {
        throw new Error('alarm unavailable');
      })
    : vi.fn(async () => {});

  return {
    state: {
      storage: { list, get, put, setAlarm },
    } as unknown as DurableObjectState,
    values,
    list,
    get,
    put,
    setAlarm,
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://internal.local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function record(
  health: HealthStateDO,
  params: {
    key: string;
    success: boolean;
    latencyMs: number;
    now: number;
    failureClass?: FailureClass;
  }
) {
  return health.fetch(post('/record', params));
}

describe('HealthStateDO coverage', () => {
  it('rejects unsupported methods and unknown POST routes', async () => {
    const { state } = makeState();
    const health = new HealthStateDO(state, {});

    const method = await health.fetch(new Request('https://internal.local/lookup'));
    expect(method.status).toBe(405);
    expect(method.headers.get('cache-control')).toBe('no-store');
    await expect(method.json()).resolves.toEqual({ error: 'Method not allowed' });

    const missing = await health.fetch(post('/missing', {}));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('returns healthy defaults, applies daily limits, and resets usage on a new day', async () => {
    const { state, values } = makeState();
    const health = new HealthStateDO(state, {});
    const firstDay = Date.UTC(2026, 6, 30, 12);
    const secondDay = Date.UTC(2026, 6, 31, 12);

    const empty = await health.fetch(
      post('/lookup', {
        keys: ['groq:model'],
        limits: { 'groq:model': { requestsPerDay: 10 } },
        now: firstDay,
      })
    );
    await expect(empty.json()).resolves.toMatchObject({
      snapshots: [
        {
          attempts: 0,
          successRate: 0.5,
          avgLatencyMs: 1500,
          p90LatencyMs: 1500,
          p99LatencyMs: 1500,
          dailyUsed: 0,
          dailyLimit: 10,
          headroom: 1,
        },
      ],
    });

    await record(health, {
      key: 'groq:model',
      success: true,
      latencyMs: 100,
      now: firstDay,
    });
    const sameDay = await health.fetch(
      post('/lookup', {
        keys: ['groq:model'],
        limits: { 'groq:model': { requestsPerDay: 10 } },
        now: firstDay + 1,
      })
    );
    await expect(sameDay.json()).resolves.toMatchObject({
      snapshots: [{ dailyUsed: 1, dailyLimit: 10, headroom: 0.9 }],
    });

    const reset = await health.fetch(
      post('/lookup', {
        keys: ['groq:model'],
        limits: {},
        now: secondDay,
      })
    );
    await expect(reset.json()).resolves.toMatchObject({
      snapshots: [{ dailyUsed: 0, dailyLimit: null, headroom: 1 }],
    });
    expect(values.get('m:groq:model')).toMatchObject({
      dayKey: '2026-07-31',
      dailyUsed: 0,
    });
  });

  it('caps history at 100 attempts and schedules one debounced snapshot', async () => {
    const { state, setAlarm } = makeState();
    const health = new HealthStateDO(state, {});
    const now = Date.UTC(2026, 6, 31);

    for (let index = 0; index < 101; index += 1) {
      await record(health, {
        key: 'groq:busy',
        success: true,
        latencyMs: index + 1,
        now: now + index,
      });
    }

    const snapshot = await health.fetch(new Request('https://internal.local/snapshot'));
    await expect(snapshot.json()).resolves.toMatchObject({
      snapshots: [{ key: 'groq:busy', attempts: 100, dailyUsed: 101 }],
    });
    expect(setAlarm).toHaveBeenCalledTimes(1);
  });

  it('applies base and burst cooldowns for retriable failures', async () => {
    const { state } = makeState();
    const health = new HealthStateDO(state, {});
    const now = Date.now();

    for (let index = 0; index < 7; index += 1) {
      await record(health, {
        key: 'groq:throttled',
        success: false,
        latencyMs: 200,
        failureClass: 'usage_retriable',
        now: now + index,
      });
    }

    const lookup = await health.fetch(
      post('/lookup', {
        keys: ['groq:throttled'],
        limits: {},
        now: now + 10,
      })
    );
    const body = (await lookup.json()) as {
      snapshots: Array<{ shortRetriableFailures: number; cooldownUntil: number }>;
    };
    expect(body.snapshots[0].shortRetriableFailures).toBe(7);
    expect(body.snapshots[0].cooldownUntil).toBe(now + 6 + 120_000);
  });

  it('persists compact snapshots on alarm and tolerates missing KV or alarm failures', async () => {
    const kvPut = vi.fn(async () => {});
    const { state } = makeState();
    const health = new HealthStateDO(state, {
      HEALTH_KV: { put: kvPut } as unknown as KVNamespace,
    });

    await record(health, {
      key: 'groq:model',
      success: true,
      latencyMs: 100,
      now: Date.UTC(2026, 6, 31),
    });
    await health.alarm();

    expect(kvPut).toHaveBeenCalledWith(
      'gateway-health-snapshot',
      expect.stringContaining('"key":"groq:model"'),
      { expirationTtl: 300 }
    );

    const noKv = new HealthStateDO(makeState().state, {});
    await expect(noKv.alarm()).resolves.toBeUndefined();
    const malformedKv = new HealthStateDO(makeState().state, {
      HEALTH_KV: {} as KVNamespace,
    });
    await expect(malformedKv.alarm()).resolves.toBeUndefined();

    const rejecting = makeState({}, { rejectAlarm: true });
    const withRejectingAlarm = new HealthStateDO(rejecting.state, {});
    const response = await record(withRejectingAlarm, {
      key: 'groq:model',
      success: true,
      latencyMs: 100,
      now: Date.UTC(2026, 6, 31),
    });
    expect(response.status).toBe(200);
  });

  it('rotates and persists round-robin offsets', async () => {
    const { state, get, put } = makeState({
      'round-robin': { pool: -1 },
    });
    const health = new HealthStateDO(state, {});

    await expect(
      health.fetch(post('/round-robin-next', {})).then((res) => res.json())
    ).resolves.toEqual({ offset: 0 });
    await expect(
      health.fetch(post('/round-robin-next', { key: 'pool', size: 1 })).then((res) => res.json())
    ).resolves.toEqual({ offset: 0 });

    const offsets = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await health.fetch(post('/round-robin-next', { key: 'pool', size: 3 }));
      offsets.push(((await response.json()) as { offset: number }).offset);
    }

    expect(offsets).toEqual([2, 0, 1]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it('aggregates provider health, failure classes, throttles, and empty models', async () => {
    const { state } = makeState();
    const health = new HealthStateDO(state, {});
    const now = Date.now();

    await health.fetch(
      post('/lookup', {
        keys: ['anthropic:empty'],
        limits: {},
        now,
      })
    );

    const attempts: Array<{ success: boolean; failureClass?: FailureClass }> = [
      { success: true },
      { success: false, failureClass: 'safety_refusal' },
      { success: false, failureClass: 'usage_retriable' },
      { success: true },
      { success: false, failureClass: 'usage_retriable' },
      { success: false, failureClass: 'input_nonretriable' },
      { success: false, failureClass: 'provider_fatal' },
    ];
    for (const [index, attempt] of attempts.entries()) {
      await record(health, {
        key: 'groq:model',
        latencyMs: 100,
        now: now + index,
        ...attempt,
      });
    }

    const response = await health.fetch(new Request('https://internal.local/providers/stats'));
    const body = (await response.json()) as {
      stats: Array<Record<string, unknown>>;
    };

    expect(body.stats.map((row) => row.provider)).toEqual(['anthropic', 'groq']);
    expect(body.stats[0]).toMatchObject({
      total_models: 1,
      active_models: 0,
      total_attempts: 0,
      throttle_rate: 0,
      success_rate: 0,
      avg_latency_ms: 0,
      avg_attempts_before_first_throttle: null,
      throttle_spacing_p50: null,
    });
    expect(body.stats[1]).toMatchObject({
      total_models: 1,
      active_models: 1,
      total_attempts: 7,
      throttle_count: 2,
      throttle_rate: 2 / 7,
      success_rate: 2 / 7,
      avg_latency_ms: 100,
      cooldown_events: 1,
      models_in_cooldown: 1,
      failure_breakdown: {
        safety_refusal: 1,
        usage_retriable: 2,
        input_nonretriable: 1,
        provider_fatal: 1,
      },
      avg_attempts_before_first_throttle: 2,
      throttle_spacing_p50: 2,
    });
  });

  it('hydrates model state from durable storage only once', async () => {
    const now = Date.now();
    const { state, list } = makeState({
      'm:openrouter:model': {
        history: [{ ts: now, success: true, latencyMs: 80 }],
        cooldownUntil: 0,
        dayKey: new Date(now).toISOString().slice(0, 10),
        dailyUsed: 1,
      },
    });
    const health = new HealthStateDO(state, {});

    const first = await health.fetch(new Request('https://internal.local/snapshot'));
    await expect(first.json()).resolves.toMatchObject({
      snapshots: [{ key: 'openrouter:model', attempts: 1, dailyUsed: 1 }],
    });
    await health.fetch(new Request('https://internal.local/providers/stats'));

    expect(list).toHaveBeenCalledTimes(1);
  });
});
