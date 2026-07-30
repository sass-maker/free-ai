import type { Provider } from '../types';

export function sortFallbackLast<T extends { provider: Provider; priority: number }>(
  items: T[],
  useFallbackOrder: boolean
): T[] {
  return [...items].sort((a, b) => {
    if (useFallbackOrder) {
      const fallbackDiff =
        Number(a.provider === 'workers_ai') - Number(b.provider === 'workers_ai');
      if (fallbackDiff !== 0) {
        return fallbackDiff;
      }
    }

    return b.priority - a.priority;
  });
}
