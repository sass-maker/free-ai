import type { Env } from '../types';

const fleetColos = new WeakMap<Request, string>();

function validColo(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

/** Only the private Fleet entrypoint may attach caller-supplied routing context. */
export function attachFleetColo(request: Request, colo: unknown): void {
  if (validColo(colo)) fleetColos.set(request, colo);
}

export function requestColo(request: Request): string | null {
  const observed = (request as Request & { cf?: { colo?: unknown } }).cf?.colo;
  return validColo(observed) ? observed : (fleetColos.get(request) ?? null);
}

async function regionState(env: Env, colo: string, operation: 'lookup' | 'record') {
  const stub = env.HEALTH_DO.get(env.HEALTH_DO.idFromName('global-health'));
  return stub.fetch('https://internal.local/region', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ colo, operation, now: Date.now() }),
  });
}

export async function geminiAvailableInRegion(env: Env, colo: string | null): Promise<boolean> {
  if (!colo) return true;
  try {
    const response = await regionState(env, colo, 'lookup');
    if (!response.ok) return true;
    const body = (await response.json()) as { unavailableUntil?: number };
    return !(typeof body.unavailableUntil === 'number' && body.unavailableUntil > Date.now());
  } catch {
    // This is a routing hint, never an authorization or spending bypass.
    return true;
  }
}

export async function recordGeminiRegionRejection(env: Env, colo: string | null): Promise<void> {
  if (colo) await regionState(env, colo, 'record').catch(() => {});
}
