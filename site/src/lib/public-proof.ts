/** Keep the homepage's existing estimate and formatting consistent across formats. */
export function publicProof(data: unknown) {
  if (!data || typeof data !== 'object' || !('stats' in data) || !Array.isArray(data.stats))
    return null;
  const total = data.stats.reduce(
    (sum, row) =>
      sum +
      (typeof row?.total_attempts === 'number' && Number.isFinite(row.total_attempts)
        ? row.total_attempts
        : 0),
    0
  );
  if (total < 1) return null;
  const dollars = total * 0.0003;
  const savings =
    dollars < 0.01
      ? '$0'
      : dollars < 1
        ? `${Math.round(dollars * 100)}¢`
        : `$${dollars.toFixed(2)}`;
  return { requests: total.toLocaleString(), savings: `${savings} saved` };
}
