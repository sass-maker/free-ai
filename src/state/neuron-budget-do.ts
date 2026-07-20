/**
 * NeuronBudgetDO — Fleet-wide daily budget for Cloudflare Workers AI.
 *
 * Tracks Neurons consumed today (UTC day rollover) and refuses requests once
 * the cap is hit. The cap (9500 Neurons/day) sits 500 below the free-tier
 * 10k/day quota so we never trigger paid overage.
 *
 * Endpoints (all POST + JSON unless noted):
 *   /try-debit  { neurons }   → { allowed, used, remaining, retryAfter, dayKey }
 *   /usage      (GET or POST) → { used, remaining, dayKey, cap }
 *   /reset      { dayKey? }   → { ok }   (debug; not wired into prod path)
 */

interface BudgetState {
  dayKey: string;
  used: number;
}

const STORAGE_KEY = 'budget';
/** Daily Neuron cap. 500 buffer below the 10k/day free-tier quota. */
const DAILY_NEURON_CAP = 9500;

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

export class NeuronBudgetDO {
  private cache: BudgetState | null = null;

  constructor(private readonly ctx: DurableObjectState) {}

  private async load(): Promise<BudgetState> {
    if (this.cache) return this.cache;
    const stored = await this.ctx.storage.get<BudgetState>(STORAGE_KEY);
    this.cache = stored ?? { dayKey: utcDayKey(), used: 0 };
    return this.cache;
  }

  private async save(state: BudgetState): Promise<void> {
    this.cache = state;
    await this.ctx.storage.put(STORAGE_KEY, state);
  }

  private rolloverIfNeeded(state: BudgetState, now: number): BudgetState {
    const today = utcDayKey(now);
    if (state.dayKey !== today) {
      return { dayKey: today, used: 0 };
    }
    return state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const now = Date.now();

    if (path === '/try-debit') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

      const body = (await request.json().catch(() => ({}))) as { neurons?: number };
      const neurons = Math.max(0, Math.ceil(Number(body.neurons ?? 0)));

      let state = await this.load();
      state = this.rolloverIfNeeded(state, now);

      if (neurons === 0) {
        await this.save(state);
        return json({
          allowed: true,
          used: state.used,
          remaining: Math.max(0, DAILY_NEURON_CAP - state.used),
          retryAfter: 0,
          dayKey: state.dayKey,
        });
      }

      if (state.used + neurons > DAILY_NEURON_CAP) {
        await this.save(state);
        return json(
          {
            allowed: false,
            used: state.used,
            remaining: Math.max(0, DAILY_NEURON_CAP - state.used),
            retryAfter: secondsUntilUtcMidnight(now),
            dayKey: state.dayKey,
          },
          200
        );
      }

      state.used += neurons;
      await this.save(state);

      return json({
        allowed: true,
        used: state.used,
        remaining: Math.max(0, DAILY_NEURON_CAP - state.used),
        retryAfter: 0,
        dayKey: state.dayKey,
      });
    }

    if (path === '/usage') {
      let state = await this.load();
      state = this.rolloverIfNeeded(state, now);
      await this.save(state);
      return json({
        used: state.used,
        remaining: Math.max(0, DAILY_NEURON_CAP - state.used),
        dayKey: state.dayKey,
        cap: DAILY_NEURON_CAP,
      });
    }

    if (path === '/reset') {
      // Guard: only allow reset from within the same Worker isolate (internal calls).
      // External HTTP callers cannot set this header through the public internet.
      if (request.headers.get('x-gateway-internal') !== '1') {
        return json({ error: 'Forbidden' }, 403);
      }
      const fresh: BudgetState = { dayKey: utcDayKey(now), used: 0 };
      await this.save(fresh);
      return json({ ok: true, ...fresh });
    }

    return json({ error: 'Not found' }, 404);
  }
}
