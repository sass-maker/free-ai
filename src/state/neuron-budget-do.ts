/**
 * NeuronBudgetDO — Fleet-wide daily budget for Cloudflare Workers AI.
 *
 * Tracks Neurons consumed today (UTC day rollover) and refuses requests once
 * the cap is hit. The cap (9500 Neurons/day) sits 500 below the free-tier
 * 10k/day quota for traffic reserved through this application.
 *
 * Endpoints (all POST + JSON unless noted):
 *   /try-debit  { neurons }   → { allowed, used, remaining, retryAfter, dayKey }
 *   /usage      (GET or POST) → { used, remaining, dayKey, cap }
 */

interface BudgetState {
  dayKey: string;
  used: number;
  dailyBaselineApplied?: true;
}

interface BudgetDebitBody {
  neurons?: unknown;
}
interface VectorizeState {
  monthKey: string;
  used: number;
  baselineVerified: true;
}

const STORAGE_KEY = 'budget';
const VECTORIZE_STORAGE_KEY = 'vectorize-budget';
const VECTORIZE_GROWTH_KEY = 'vectorize-storage-budget';
/** Gross stored dimensions: at $0.05/100M, at most $0.10 per full month. */
const VECTORIZE_STORED_CAP = 200_000_000;
/** Oct 8 account inventory: 28,764,928 dimensions, rounded up conservatively. */
const VERIFIED_STORAGE_BASELINES: Readonly<Record<string, number>> = { '2026-10': 30_000_000 };
/** Daily Neuron cap. 500 buffer below the 10k/day free-tier quota. */
const DAILY_NEURON_CAP = 9500;
/** Reserve today's prior unguarded usage before shared consumers are enabled. */
const VERIFIED_DAILY_BASELINES: Readonly<Record<string, number>> = { '2026-10-02': 250 };
/** Leave headroom below the 50M queried-dimension paid allowance. */
const MONTHLY_VECTORIZE_CAP = 45_000_000;
/**
 * Oct 2026 estimate from the reviewed read-only provider receipt. This seeds
 * admitted queried dimensions; it is not an account-wide billing cap or a
 * separate stored-dimensions allowance.
 */
const VERIFIED_VECTORIZE_BASELINES: Readonly<Record<string, number>> = {
  '2026-10': 35_000_000,
};

const json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

function utcDayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(now: number = Date.now()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}

function utcMonthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

function secondsUntilUtcMonth(now: number): number {
  const date = new Date(now);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}

function readVectorizeState(
  value: unknown,
  monthKey: string,
  cap = MONTHLY_VECTORIZE_CAP
): VectorizeState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<VectorizeState>;
  if (
    state.monthKey !== monthKey ||
    state.baselineVerified !== true ||
    !Number.isSafeInteger(state.used) ||
    (state.used as number) < 0 ||
    (state.used as number) > cap
  )
    return null;
  return state as VectorizeState;
}

function isPreviousVectorizePeriod(value: unknown, monthKey: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<VectorizeState>;
  return (
    typeof state.monthKey === 'string' &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(state.monthKey) &&
    state.monthKey < monthKey &&
    state.baselineVerified === true &&
    Number.isSafeInteger(state.used) &&
    (state.used as number) >= 0 &&
    (state.used as number) <= MONTHLY_VECTORIZE_CAP
  );
}

function isValidBudgetState(state: Partial<BudgetState>, today: string): state is BudgetState {
  return (
    typeof state.dayKey === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(state.dayKey) &&
    Number.isSafeInteger(Date.parse(state.dayKey)) &&
    new Date(state.dayKey).toISOString().slice(0, 10) === state.dayKey &&
    Number.isSafeInteger(state.used) &&
    (state.used as number) >= 0 &&
    (state.used as number) <= DAILY_NEURON_CAP &&
    state.dayKey <= today &&
    (state.dailyBaselineApplied === undefined || state.dailyBaselineApplied === true)
  );
}

export class NeuronBudgetDO {
  constructor(private readonly ctx: DurableObjectState) {}

  private readState(stored: unknown, now: number): BudgetState | null {
    const today = utcDayKey(now);
    const baseline = VERIFIED_DAILY_BASELINES[today] ?? 0;
    if (stored === undefined) return { dayKey: today, used: baseline, dailyBaselineApplied: true };
    if (!stored || typeof stored !== 'object') return null;
    const state = stored as Partial<BudgetState>;
    if (!isValidBudgetState(state, today)) return null;

    const sameDay = state.dayKey === today;
    const alreadyApplied = sameDay && state.dailyBaselineApplied === true;
    const used = (sameDay ? (state.used as number) : 0) + (alreadyApplied ? 0 : baseline);
    if (used > DAILY_NEURON_CAP) return null;
    return {
      dayKey: today,
      used,
      dailyBaselineApplied: true,
    };
  }

  private async queryState(
    txn: DurableObjectTransaction,
    monthKey: string
  ): Promise<VectorizeState | null> {
    const stored = await txn.get<unknown>(VECTORIZE_STORAGE_KEY);
    let state = readVectorizeState(stored, monthKey);
    const baseline = VERIFIED_VECTORIZE_BASELINES[monthKey];
    if (
      !state &&
      (stored === undefined || isPreviousVectorizePeriod(stored, monthKey)) &&
      Number.isSafeInteger(baseline)
    ) {
      state = { monthKey, used: baseline, baselineVerified: true };
    } else if (state && Number.isSafeInteger(baseline) && baseline > state.used) {
      state = { ...state, used: baseline };
    }
    if (state) await txn.put(VECTORIZE_STORAGE_KEY, state);
    return state;
  }

  private async storageState(
    txn: DurableObjectTransaction,
    monthKey: string
  ): Promise<VectorizeState | null> {
    const baseline = VERIFIED_STORAGE_BASELINES[monthKey];
    if (!Number.isSafeInteger(baseline)) return null;
    const stored = await txn.get<unknown>(VECTORIZE_GROWTH_KEY);
    const state =
      stored === undefined
        ? { monthKey, used: baseline, baselineVerified: true as const }
        : readVectorizeState(stored, monthKey, VECTORIZE_STORED_CAP);
    return state ? { ...state, used: Math.max(state.used, baseline) } : null;
  }

  private async reserveVectorize(
    request: Request,
    now: number,
    storageGrowth: boolean
  ): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    let body: { dimensions?: unknown } | null = null;
    try {
      body = (await request.json()) as { dimensions?: unknown };
    } catch {
      return json({ error: 'Invalid Vectorize reservation' }, 400);
    }
    const dimensions = body?.dimensions;
    if (
      typeof dimensions !== 'number' ||
      !Number.isSafeInteger(dimensions) ||
      dimensions < 1 ||
      dimensions > MONTHLY_VECTORIZE_CAP
    ) {
      return json({ error: 'Invalid Vectorize reservation' }, 400);
    }
    const monthKey = utcMonthKey(now);
    return this.ctx.storage.transaction(async (txn) => {
      const state = await this.queryState(txn, monthKey);
      if (!state) return json({ error: 'Verified monthly Vectorize baseline unavailable' }, 503);
      // Stored vectors also add corpus dimensions to queried usage. Both
      // ledgers commit together; retries and upserts never reclaim credit.
      const storage = storageGrowth ? await this.storageState(txn, monthKey) : null;
      if (storageGrowth && !storage)
        return json({ error: 'Verified storage baseline unavailable' }, 503);
      if (
        state.used + dimensions > MONTHLY_VECTORIZE_CAP ||
        (storage && storage.used + dimensions > VECTORIZE_STORED_CAP)
      ) {
        return json({
          allowed: false,
          used: state.used,
          remaining: MONTHLY_VECTORIZE_CAP - state.used,
          retryAfter: secondsUntilUtcMonth(now),
          monthKey,
          baselineVerified: true,
        });
      }
      const updated = { ...state, used: state.used + dimensions };
      await txn.put(VECTORIZE_STORAGE_KEY, updated);
      const storedUsed = storage ? storage.used + dimensions : null;
      if (storedUsed !== null)
        await txn.put(VECTORIZE_GROWTH_KEY, { ...storage, used: storedUsed });
      return json({
        allowed: true,
        used: updated.used,
        remaining: MONTHLY_VECTORIZE_CAP - updated.used,
        retryAfter: 0,
        monthKey,
        baselineVerified: true,
        ...(storedUsed !== null
          ? {
              storedUsed,
              storedRemaining: VECTORIZE_STORED_CAP - storedUsed,
              storedCap: VECTORIZE_STORED_CAP,
            }
          : {}),
      });
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const now = Date.now();

    if (path === '/try-debit') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

      let body: BudgetDebitBody | null = null;
      try {
        body = (await request.json()) as BudgetDebitBody;
      } catch {
        return json({ error: 'Invalid neuron reservation' }, 400);
      }
      const neurons = body?.neurons;
      if (
        typeof neurons !== 'number' ||
        !Number.isSafeInteger(neurons) ||
        neurons <= 0 ||
        neurons > DAILY_NEURON_CAP
      ) {
        return json({ error: 'Invalid neuron reservation' }, 400);
      }

      return this.ctx.storage.transaction(async (txn) => {
        const state = this.readState(await txn.get<unknown>(STORAGE_KEY), now);
        if (!state) return json({ error: 'Budget state unavailable' }, 503);

        if (state.used + neurons > DAILY_NEURON_CAP) {
          await txn.put(STORAGE_KEY, state);
          return json({
            allowed: false,
            used: state.used,
            remaining: Math.max(0, DAILY_NEURON_CAP - state.used),
            retryAfter: secondsUntilUtcMidnight(now),
            dayKey: state.dayKey,
          });
        }

        const updated = { ...state, used: state.used + neurons };
        await txn.put(STORAGE_KEY, updated);
        return json({
          allowed: true,
          used: updated.used,
          remaining: Math.max(0, DAILY_NEURON_CAP - updated.used),
          retryAfter: 0,
          dayKey: updated.dayKey,
        });
      });
    }

    if (path === '/usage') {
      return this.ctx.storage.transaction(async (txn) => {
        const state = this.readState(await txn.get<unknown>(STORAGE_KEY), now);
        if (!state) return json({ error: 'Budget state unavailable' }, 503);
        await txn.put(STORAGE_KEY, state);
        return json({
          used: state.used,
          remaining: Math.max(0, DAILY_NEURON_CAP - state.used),
          dayKey: state.dayKey,
          cap: DAILY_NEURON_CAP,
        });
      });
    }

    if (path === '/try-debit-vectorize' || path === '/try-debit-vectorize-storage') {
      return this.reserveVectorize(request, now, path === '/try-debit-vectorize-storage');
    }

    return json({ error: 'Not found' }, 404);
  }
}
