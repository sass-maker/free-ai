import { describe, expect, it, vi } from 'vitest';

import { NeuronBudgetDO } from '../src/state/neuron-budget-do';

function makeState() {
  const values = new Map<string, unknown>();
  const puts: Array<{ key: string; value: unknown }> = [];
  let concurrentReads = 0;
  let releaseConcurrentReads = () => {};
  const concurrentReadsReady = new Promise<void>((resolve) => {
    releaseConcurrentReads = resolve;
  });
  let transactionTail: Promise<void> = Promise.resolve();

  const transaction = vi.fn(
    async <T>(
      callback: (txn: {
        get: <V>(key: string) => Promise<V | undefined>;
        put: (key: string, value: unknown) => Promise<void>;
      }) => Promise<T>
    ): Promise<T> => {
      const previous = transactionTail;
      let release = () => {};
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback({
          get: async <V>(key: string) => values.get(key) as V | undefined,
          put: async (key, value) => {
            values.set(key, value);
            puts.push({ key, value });
          },
        });
      } finally {
        release();
      }
    }
  );

  const state = {
    storage: {
      get: vi.fn(async <T>(key: string) => {
        concurrentReads += 1;
        if (concurrentReads === 2) releaseConcurrentReads();
        await concurrentReadsReady;
        return values.get(key) as T | undefined;
      }),
      put: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
      transaction,
    },
  } as unknown as DurableObjectState;

  return { state, values, puts, transaction };
}

function post(path: string, body: string, headers: HeadersInit = {}): Request {
  return new Request(`https://internal.local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

function debit(neurons: unknown): Request {
  return post('/try-debit', JSON.stringify({ neurons }));
}

describe('NeuronBudgetDO', () => {
  it('atomically admits only reservations that fit from a cold daily budget', async () => {
    const { state } = makeState();
    const budget = new NeuronBudgetDO(state);

    const responses = await Promise.all([budget.fetch(debit(6_000)), budget.fetch(debit(6_000))]);
    const bodies = await Promise.all(
      responses.map((response) => response.json() as Promise<{ allowed: boolean; used: number }>)
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies.filter((body) => body.allowed)).toHaveLength(1);
    expect(bodies.filter((body) => !body.allowed)).toHaveLength(1);

    const usage = await budget.fetch(new Request('https://internal.local/usage'));
    await expect(usage.json()).resolves.toMatchObject({
      used: new Date().toISOString().slice(0, 10) === '2026-10-02' ? 6_250 : 6_000,
      remaining: new Date().toISOString().slice(0, 10) === '2026-10-02' ? 3_250 : 3_500,
      cap: 9_500,
    });
  });

  it.each(['not-a-number', null, 0, -1, 1.5, 9_501, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid neuron reservations %j without changing budget state',
    async (neurons) => {
      const { state } = makeState();
      const budget = new NeuronBudgetDO(state);

      const response = await budget.fetch(debit(neurons));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: 'Invalid neuron reservation' });

      const usage = await budget.fetch(new Request('https://internal.local/usage'));
      const baseline = new Date().toISOString().slice(0, 10) === '2026-10-02' ? 250 : 0;
      await expect(usage.json()).resolves.toMatchObject({
        used: baseline,
        remaining: 9_500 - baseline,
      });
    }
  );

  it('does not expose a reset operation through the shared binding', async () => {
    const { state } = makeState();
    const budget = new NeuronBudgetDO(state);
    await budget.fetch(debit(100));

    const reset = await budget.fetch(post('/reset', '{}', { 'x-gateway-internal': '1' }));
    expect(reset.status).toBe(404);
    const usage = await budget.fetch(new Request('https://internal.local/usage'));
    const baseline = new Date().toISOString().slice(0, 10) === '2026-10-02' ? 250 : 0;
    await expect(usage.json()).resolves.toMatchObject({
      used: 100 + baseline,
      remaining: 9_400 - baseline,
    });
  });

  it('preserves malformed Vectorize history instead of replacing it with a baseline', async () => {
    const { state, values } = makeState();
    const key = new Date().toISOString().slice(0, 7);
    const corrupt = { monthKey: key, used: Number.NaN, baselineVerified: true };
    values.set('vectorize-budget', corrupt);
    const budget = new NeuronBudgetDO(state);
    const response = await budget.fetch(
      post('/try-debit-vectorize', JSON.stringify({ dimensions: 768 }))
    );
    expect(response.status).toBe(503);
    expect(values.get('vectorize-budget')).toBe(corrupt);
  });

  it('seeds the reviewed October baseline once and blocks the next unseeded month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
    try {
      const { state, values, puts } = makeState();
      const budget = new NeuronBudgetDO(state);
      const first = await budget.fetch(
        post('/try-debit-vectorize', JSON.stringify({ dimensions: 1 }))
      );
      await expect(first.json()).resolves.toMatchObject({
        allowed: true,
        used: 35_000_001,
        remaining: 9_999_999,
        monthKey: '2026-10',
        baselineVerified: true,
      });
      const seeded = puts.find((entry) => entry.key === 'vectorize-budget')?.value as {
        monthKey: string;
        used: number;
        baselineVerified: boolean;
      };
      expect(seeded).toEqual({ monthKey: '2026-10', used: 35_000_000, baselineVerified: true });
      expect(45_000_000 - seeded.used).toBe(10_000_000);

      const second = await budget.fetch(
        post('/try-debit-vectorize', JSON.stringify({ dimensions: 768 }))
      );
      await expect(second.json()).resolves.toMatchObject({
        allowed: true,
        used: 35_000_769,
        remaining: 9_999_231,
      });
      expect(values.get('vectorize-budget')).toEqual({
        monthKey: '2026-10',
        used: 35_000_769,
        baselineVerified: true,
      });

      vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
      const nextMonth = await budget.fetch(
        post('/try-debit-vectorize', JSON.stringify({ dimensions: 1 }))
      );
      expect(nextMonth.status).toBe(503);
      await expect(nextMonth.json()).resolves.toMatchObject({
        error: 'Verified monthly Vectorize baseline unavailable',
      });
      expect(values.get('vectorize-budget')).toEqual({
        monthKey: '2026-10',
        used: 35_000_769,
        baselineVerified: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps same-month usage above the reviewed baseline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
    try {
      const { state, values } = makeState();
      values.set('vectorize-budget', {
        monthKey: '2026-10',
        used: 36_000_000,
        baselineVerified: true,
      });
      const budget = new NeuronBudgetDO(state);
      const response = await budget.fetch(
        post('/try-debit-vectorize', JSON.stringify({ dimensions: 1 }))
      );
      await expect(response.json()).resolves.toMatchObject({
        allowed: true,
        used: 36_000_001,
        remaining: 8_999_999,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
