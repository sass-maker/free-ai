import type { AttemptRecord, FailureClass, ModelStateSnapshot, ProviderLimitConfig } from '../types';

interface HealthDoEnv {
  HEALTH_KV?: KVNamespace;
}

interface ModelState {
  history: AttemptRecord[];
  cooldownUntil: number;
  dayKey: string;
  dailyUsed: number;
}

type RoundRobinMap = Record<string, number>;

export interface ProviderStats {
  provider: string;
  total_models: number;
  active_models: number;
  total_attempts: number;
  throttle_count: number;
  throttle_rate: number;
  success_rate: number;
  avg_latency_ms: number;
  cooldown_events: number;
  models_in_cooldown: number;
  failure_breakdown: {
    safety_refusal: number;
    usage_retriable: number;
    input_nonretriable: number;
    provider_fatal: number;
  };
  avg_attempts_before_first_throttle: number | null;
  throttle_spacing_p50: number | null;
}

const MODEL_PREFIX = 'm:';
const ROUND_ROBIN_STORAGE_KEY = 'round-robin';
const HISTORY_LIMIT = 100;
const SHORT_WINDOW = 10;
const SHORT_FAILURE_THRESHOLD = 7;
const COOL_DOWN_MS = 120_000;
const RETRIABLE_BASE_COOLDOWN_MS = 45_000;
const SNAPSHOT_DEBOUNCE_MS = 30_000;

const json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

const dayKey = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

function emptyModelState(now: number): ModelState {
  return {
    history: [],
    cooldownUntil: 0,
    dayKey: dayKey(now),
    dailyUsed: 0,
  };
}

function toSnapshot(
  key: string,
  state: ModelState,
  limitConfig: ProviderLimitConfig | undefined,
  now: number,
): ModelStateSnapshot {
  const attempts = state.history.length;
  const successful = state.history.filter((item) => item.success).length;
  const successRate = attempts === 0 ? 0.5 : successful / attempts;
  const avgLatencyMs =
    attempts === 0 ? 1500 : state.history.reduce((sum, item) => sum + item.latencyMs, 0) / attempts;
  const latencies = state.history.map((item) => item.latencyMs).sort((a, b) => a - b);
  const p90LatencyMs = attempts === 0 ? 1500 : percentile(latencies, 0.9);
  const p99LatencyMs = attempts === 0 ? 1500 : percentile(latencies, 0.99);

  const recent = state.history.slice(-SHORT_WINDOW);
  const shortRetriableFailures = recent.filter(
    (item) => !item.success && item.failureClass === 'usage_retriable',
  ).length;

  const dailyLimit = limitConfig?.requestsPerDay ?? null;
  const headroom = dailyLimit === null ? 1 : Math.max(0, 1 - state.dailyUsed / dailyLimit);

  return {
    key,
    attempts,
    successRate,
    avgLatencyMs,
    p90LatencyMs,
    p99LatencyMs,
    cooldownUntil: Math.max(state.cooldownUntil, now > state.cooldownUntil ? 0 : state.cooldownUntil),
    headroom,
    dailyUsed: state.dailyUsed,
    dailyLimit,
    shortRetriableFailures,
  };
}

function storageKey(modelKey: string): string {
  return `${MODEL_PREFIX}${modelKey}`;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted: number[], percentileRank: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileRank) - 1);
  return sorted[index];
}

interface ProviderAccumulator {
  totalModels: number;
  activeModels: number;
  totalAttempts: number;
  successful: number;
  latencySum: number;
  throttleCount: number;
  cooldownEvents: number;
  modelsInCooldown: number;
  failureBreakdown: Record<FailureClass, number>;
  firstThrottleIdxs: number[];
  throttleSpacings: number[];
}

function emptyAccumulator(): ProviderAccumulator {
  return {
    totalModels: 0,
    activeModels: 0,
    totalAttempts: 0,
    successful: 0,
    latencySum: 0,
    throttleCount: 0,
    cooldownEvents: 0,
    modelsInCooldown: 0,
    failureBreakdown: {
      safety_refusal: 0,
      usage_retriable: 0,
      input_nonretriable: 0,
      provider_fatal: 0,
    },
    firstThrottleIdxs: [],
    throttleSpacings: [],
  };
}

function aggregateProviderStats(cache: Map<string, ModelState>, now: number): ProviderStats[] {
  const byProvider = new Map<string, ProviderAccumulator>();

  for (const [key, state] of cache) {
    const provider = key.split(':')[0] ?? 'unknown';
    const acc = byProvider.get(provider) ?? emptyAccumulator();
    acc.totalModels += 1;

    const attempts = state.history.length;
    if (attempts > 0) acc.activeModels += 1;
    acc.totalAttempts += attempts;

    if (state.cooldownUntil > 0) acc.cooldownEvents += 1;
    if (state.cooldownUntil > now) acc.modelsInCooldown += 1;

    let firstThrottleIdx = -1;
    let lastThrottleIdx = -1;
    for (let i = 0; i < state.history.length; i += 1) {
      const item = state.history[i];
      acc.latencySum += item.latencyMs;
      if (item.success) {
        acc.successful += 1;
        continue;
      }
      if (item.failureClass) {
        acc.failureBreakdown[item.failureClass] += 1;
        if (item.failureClass === 'usage_retriable') {
          acc.throttleCount += 1;
          if (firstThrottleIdx === -1) firstThrottleIdx = i;
          if (lastThrottleIdx !== -1) {
            acc.throttleSpacings.push(i - lastThrottleIdx);
          }
          lastThrottleIdx = i;
        }
      }
    }
    if (firstThrottleIdx !== -1) acc.firstThrottleIdxs.push(firstThrottleIdx);

    byProvider.set(provider, acc);
  }

  const result: ProviderStats[] = [];
  for (const [provider, acc] of byProvider) {
    const avgFirst =
      acc.firstThrottleIdxs.length === 0
        ? null
        : acc.firstThrottleIdxs.reduce((s, n) => s + n, 0) / acc.firstThrottleIdxs.length;
    const spacingSorted = acc.throttleSpacings.slice().sort((a, b) => a - b);
    const spacingP50 = spacingSorted.length >= 1 ? median(spacingSorted) : null;

    result.push({
      provider,
      total_models: acc.totalModels,
      active_models: acc.activeModels,
      total_attempts: acc.totalAttempts,
      throttle_count: acc.throttleCount,
      throttle_rate: acc.totalAttempts === 0 ? 0 : acc.throttleCount / acc.totalAttempts,
      success_rate: acc.totalAttempts === 0 ? 0 : acc.successful / acc.totalAttempts,
      avg_latency_ms: acc.totalAttempts === 0 ? 0 : acc.latencySum / acc.totalAttempts,
      cooldown_events: acc.cooldownEvents,
      models_in_cooldown: acc.modelsInCooldown,
      failure_breakdown: acc.failureBreakdown,
      avg_attempts_before_first_throttle: avgFirst,
      throttle_spacing_p50: spacingP50,
    });
  }

  return result.sort((a, b) => a.provider.localeCompare(b.provider));
}

export class HealthStateDO {
  private cache = new Map<string, ModelState>();
  private cacheLoaded = false;
  private roundRobinCache: RoundRobinMap | null = null;
  private snapshotDirty = false;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: HealthDoEnv,
  ) {}

  private async ensureCacheLoaded(): Promise<void> {
    if (this.cacheLoaded) return;
    const entries = await this.ctx.storage.list<ModelState>({ prefix: MODEL_PREFIX });
    for (const [k, v] of entries) {
      this.cache.set(k.slice(MODEL_PREFIX.length), v);
    }
    this.cacheLoaded = true;
  }

  private async loadModel(key: string): Promise<ModelState | undefined> {
    await this.ensureCacheLoaded();
    return this.cache.get(key);
  }

  private async saveModel(key: string, state: ModelState): Promise<void> {
    this.cache.set(key, state);
    await this.ctx.storage.put(storageKey(key), state);
  }

  private async loadRoundRobinState(): Promise<RoundRobinMap> {
    if (this.roundRobinCache !== null) return this.roundRobinCache;
    this.roundRobinCache = (await this.ctx.storage.get<RoundRobinMap>(ROUND_ROBIN_STORAGE_KEY)) ?? {};
    return this.roundRobinCache;
  }

  private async saveRoundRobinState(state: RoundRobinMap): Promise<void> {
    this.roundRobinCache = state;
    await this.ctx.storage.put(ROUND_ROBIN_STORAGE_KEY, state);
  }

  private resetIfNeeded(modelState: ModelState, now: number): boolean {
    const today = dayKey(now);
    if (modelState.dayKey !== today) {
      modelState.dayKey = today;
      modelState.dailyUsed = 0;
      return true;
    }
    return false;
  }

  private scheduleSnapshot(): void {
    if (this.snapshotDirty) return;
    this.snapshotDirty = true;
    this.ctx.storage.setAlarm(Date.now() + SNAPSHOT_DEBOUNCE_MS).catch(() => {});
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.env.HEALTH_KV || typeof this.env.HEALTH_KV.put !== 'function') {
      return;
    }

    await this.ensureCacheLoaded();
    const payload = Array.from(this.cache.entries()).map(([key, modelState]) => ({
      key,
      attempts: modelState.history.length,
      cooldownUntil: modelState.cooldownUntil,
      dayKey: modelState.dayKey,
      dailyUsed: modelState.dailyUsed,
    }));

    await this.env.HEALTH_KV.put('gateway-health-snapshot', JSON.stringify(payload), {
      expirationTtl: 300,
    });
  }

  async alarm(): Promise<void> {
    this.snapshotDirty = false;
    await this.persistSnapshot();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== 'POST' && path !== '/snapshot' && path !== '/providers/stats') {
      return json({ error: 'Method not allowed' }, 405);
    }

    if (path === '/record') {
      const body = (await request.json()) as {
        key: string;
        success: boolean;
        latencyMs: number;
        failureClass?: FailureClass;
        now: number;
      };

      const modelState = (await this.loadModel(body.key)) ?? emptyModelState(body.now);
      this.resetIfNeeded(modelState, body.now);

      modelState.history.push({
        ts: body.now,
        success: body.success,
        latencyMs: body.latencyMs,
        failureClass: body.failureClass,
      });

      if (modelState.history.length > HISTORY_LIMIT) {
        modelState.history = modelState.history.slice(-HISTORY_LIMIT);
      }

      if (body.success) {
        modelState.dailyUsed += 1;
      }

      const recent = modelState.history.slice(-SHORT_WINDOW);
      const shortRetriableFailures = recent.filter(
        (attempt) => !attempt.success && attempt.failureClass === 'usage_retriable',
      ).length;

      if (!body.success && body.failureClass === 'usage_retriable') {
        modelState.cooldownUntil = Math.max(modelState.cooldownUntil, body.now + RETRIABLE_BASE_COOLDOWN_MS);
      }

      if (shortRetriableFailures >= SHORT_FAILURE_THRESHOLD) {
        modelState.cooldownUntil = Math.max(modelState.cooldownUntil, body.now + COOL_DOWN_MS);
      }

      await this.saveModel(body.key, modelState);
      this.scheduleSnapshot();

      return json({ ok: true });
    }

    if (path === '/lookup') {
      const body = (await request.json()) as {
        keys: string[];
        limits: Record<string, ProviderLimitConfig>;
        now: number;
      };

      const snapshots: ModelStateSnapshot[] = [];
      for (const key of body.keys) {
        const modelState = (await this.loadModel(key)) ?? emptyModelState(body.now);
        const didReset = this.resetIfNeeded(modelState, body.now);
        if (didReset) {
          await this.saveModel(key, modelState);
        } else {
          this.cache.set(key, modelState);
        }
        snapshots.push(toSnapshot(key, modelState, body.limits[key], body.now));
      }

      return json({ snapshots });
    }

    if (path === '/snapshot') {
      const now = Date.now();
      await this.ensureCacheLoaded();
      const snapshots = Array.from(this.cache.entries()).map(([key, modelState]) =>
        toSnapshot(key, modelState, undefined, now),
      );
      return json({ snapshots });
    }

    if (path === '/providers/stats') {
      const now = Date.now();
      await this.ensureCacheLoaded();
      const stats = aggregateProviderStats(this.cache, now);
      return json({ stats });
    }

    if (path === '/round-robin-next') {
      const body = (await request.json()) as {
        key?: string;
        size?: number;
      };

      const key = String(body.key ?? '').trim();
      const size = Math.max(1, Math.floor(Number(body.size ?? 0)));
      if (!key || size <= 1) {
        return json({ offset: 0 });
      }

      const roundRobinState = await this.loadRoundRobinState();
      const current = roundRobinState[key] ?? 0;
      const offset = ((current % size) + size) % size;
      roundRobinState[key] = (offset + 1) % size;
      await this.saveRoundRobinState(roundRobinState);

      return json({ offset });
    }

    return json({ error: 'Not found' }, 404);
  }
}
