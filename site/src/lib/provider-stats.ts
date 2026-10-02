export interface ProviderStat {
  provider: string;
  total_models: number | null;
  active_models: number | null;
  total_attempts: number | null;
  success_rate: number | null;
  avg_latency_ms: number | null;
}

function finiteNumber(value: unknown, maximum = Number.POSITIVE_INFINITY): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

export function normalizeProviderStats(value: unknown): ProviderStat[] | null {
  if (!Array.isArray(value)) return null;

  const stats = value.flatMap((item): ProviderStat[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.provider !== 'string' || row.provider.trim().length === 0) return [];
    const attempts = finiteNumber(row.total_attempts);

    return [
      {
        provider: row.provider,
        total_models: finiteNumber(row.total_models),
        active_models: finiteNumber(row.active_models),
        total_attempts: attempts,
        success_rate: attempts !== null && attempts > 0 ? finiteNumber(row.success_rate, 1) : null,
        avg_latency_ms: attempts !== null && attempts > 0 ? finiteNumber(row.avg_latency_ms) : null,
      },
    ];
  });
  return stats.length === 0 && value.length > 0 ? null : stats;
}

export function summarizeProviderStats(value: unknown): {
  totalAttempts: number | null;
  successRate: number | null;
} {
  const stats = normalizeProviderStats(value);
  if (
    !stats ||
    !Array.isArray(value) ||
    stats.length !== value.length ||
    stats.some((row) => row.total_attempts === null)
  ) {
    return { totalAttempts: null, successRate: null };
  }
  const totalAttempts = stats.reduce((total, row) => total + (row.total_attempts ?? 0), 0);
  if (totalAttempts === 0) return { totalAttempts: 0, successRate: null };
  if (stats.some((row) => (row.total_attempts ?? 0) > 0 && row.success_rate === null)) {
    return { totalAttempts, successRate: null };
  }

  const successfulAttempts = stats.reduce(
    (total, row) => total + (row.total_attempts ?? 0) * (row.success_rate ?? 0),
    0
  );
  return { totalAttempts, successRate: successfulAttempts / totalAttempts };
}
