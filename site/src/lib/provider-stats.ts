export interface ProviderStat {
  provider: string;
  total_models: number;
  active_models: number;
  total_attempts: number;
  success_rate: number;
  avg_latency_ms: number;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function normalizeProviderStats(value: unknown): ProviderStat[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): ProviderStat[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.provider !== 'string') return [];

    return [
      {
        provider: row.provider,
        total_models: finiteNumber(row.total_models),
        active_models: finiteNumber(row.active_models),
        total_attempts: finiteNumber(row.total_attempts),
        success_rate: finiteNumber(row.success_rate),
        avg_latency_ms: finiteNumber(row.avg_latency_ms),
      },
    ];
  });
}

export function summarizeProviderStats(value: unknown): {
  totalAttempts: number;
  successRate: number | null;
} {
  const stats = normalizeProviderStats(value);
  const totalAttempts = stats.reduce((total, row) => total + row.total_attempts, 0);
  if (totalAttempts === 0) return { totalAttempts: 0, successRate: null };

  const successfulAttempts = stats.reduce(
    (total, row) => total + row.total_attempts * row.success_rate,
    0
  );
  return { totalAttempts, successRate: successfulAttempts / totalAttempts };
}
