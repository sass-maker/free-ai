// Provider secrets accept comma-separated keys. Quotas may be shared by keys
// in the same upstream project; multiple keys do not imply multiple quotas.

export function parseApiKeys(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function pickApiKey(
  raw: string | undefined,
  excluded: ReadonlySet<string> = new Set()
): string | undefined {
  const keys = [...new Set(parseApiKeys(raw))].filter((key) => !excluded.has(key));
  if (keys.length === 0) return undefined;
  return keys[Math.floor(Math.random() * keys.length)];
}
