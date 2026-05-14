import type { Env, FailureClass, ModelStateSnapshot, ProviderLimitConfig } from '../types';
import type { ProviderStats } from './health-do';

export type { ProviderStats } from './health-do';

const DO_ORIGIN = 'https://internal.local';

export async function healthLookup(
  env: Env,
  keys: string[],
  limits: Record<string, ProviderLimitConfig>,
  now: number,
): Promise<Map<string, ModelStateSnapshot>> {
  const id = env.HEALTH_DO.idFromName('global-health');
  const stub = env.HEALTH_DO.get(id);
  const response = await stub.fetch(`${DO_ORIGIN}/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys, limits, now }),
  });

  if (!response.ok) {
    return new Map();
  }

  const body = (await response.json()) as { snapshots: ModelStateSnapshot[] };
  return new Map(body.snapshots.map((snapshot) => [snapshot.key, snapshot]));
}

export async function healthRecord(
  env: Env,
  params: {
    key: string;
    success: boolean;
    latencyMs: number;
    failureClass?: FailureClass;
    now: number;
  },
): Promise<void> {
  const id = env.HEALTH_DO.idFromName('global-health');
  const stub = env.HEALTH_DO.get(id);

  await stub.fetch(`${DO_ORIGIN}/record`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function healthSnapshot(env: Env): Promise<ModelStateSnapshot[]> {
  const id = env.HEALTH_DO.idFromName('global-health');
  const stub = env.HEALTH_DO.get(id);
  const response = await stub.fetch(`${DO_ORIGIN}/snapshot`);

  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { snapshots: ModelStateSnapshot[] };
  return body.snapshots;
}

export async function providerStats(env: Env): Promise<ProviderStats[]> {
  const id = env.HEALTH_DO.idFromName('global-health');
  const stub = env.HEALTH_DO.get(id);
  const response = await stub.fetch(`${DO_ORIGIN}/providers/stats`);

  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { stats: ProviderStats[] };
  return body.stats;
}

export async function nextRoundRobinOffset(
  env: Env,
  params: {
    key: string;
    size: number;
  },
): Promise<number> {
  if (!params.key || params.size <= 1) {
    return 0;
  }

  const id = env.HEALTH_DO.idFromName('global-health');
  const stub = env.HEALTH_DO.get(id);
  const response = await stub.fetch(`${DO_ORIGIN}/round-robin-next`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: params.key,
      size: params.size,
    }),
  });

  if (!response.ok) {
    return 0;
  }

  const body = (await response.json()) as { offset?: unknown };
  const offset = typeof body.offset === 'number' ? body.offset : 0;
  if (!Number.isFinite(offset) || offset < 0) {
    return 0;
  }

  return Math.floor(offset % params.size);
}

export async function consumeIpRateLimit(
  env: Env,
  params: {
    ipKey: string;
    now: number;
    capacity: number;
    refillPerSecond: number;
    cost?: number;
  },
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const id = env.RATE_LIMIT_DO.idFromName(params.ipKey);
  const stub = env.RATE_LIMIT_DO.get(id);
  const response = await stub.fetch(`${DO_ORIGIN}/consume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      now: params.now,
      cost: params.cost ?? 1,
      capacity: params.capacity,
      refillPerSecond: params.refillPerSecond,
    }),
  });

  const body = (await response.json()) as {
    allowed: boolean;
    remaining: number;
    retryAfter: number;
  };

  return body;
}
