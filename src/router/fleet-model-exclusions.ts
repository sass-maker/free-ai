const exclusions = new WeakMap<Request, string[]>();

/** A bounded request-local hint from an authenticated private Fleet consumer. */
export function attachFleetModelExclusions(request: Request, encoded: string | null): void {
  if (!encoded || encoded.length > 1024) return;
  try {
    const keys: unknown = JSON.parse(encoded);
    if (
      !Array.isArray(keys) ||
      keys.length > 4 ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          key.length > 240 ||
          !/^[a-z_]{1,32}:[A-Za-z0-9_./:@+-]+$/.test(key)
      )
    )
      return;
    exclusions.set(request, [...new Set(keys)]);
  } catch {
    /* Invalid hints leave normal automatic routing intact. */
  }
}

export function fleetModelExclusions(request: Request): Set<string> {
  // Public headers alone cannot populate this map or influence routing.
  return new Set(exclusions.get(request) ?? []);
}
import type { ModelCandidate } from '../types';

export function prioritizeFleetRepairProviders(
  request: Request,
  selected: ModelCandidate[]
): ModelCandidate[] {
  const failedProviders = new Set(
    [...fleetModelExclusions(request)].map((key) => key.split(':')[0])
  );
  if (!failedProviders.size) return selected;
  // Invalid output can recur across sibling models. Try a compatible external
  // provider first, retaining siblings as fallback and Workers AI last.
  return [
    ...selected.filter(
      (candidate) => candidate.provider !== 'workers_ai' && !failedProviders.has(candidate.provider)
    ),
    ...selected.filter(
      (candidate) => candidate.provider !== 'workers_ai' && failedProviders.has(candidate.provider)
    ),
    ...selected.filter((candidate) => candidate.provider === 'workers_ai'),
  ];
}
