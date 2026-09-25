// Provider secrets accept a comma-separated list of keys. Each call picks one
// at random so independent free-tier quotas stack without extra state, and a
// retry attempt has a fair chance of landing on a different key.

export function parseApiKeys(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function pickApiKey(raw: string | undefined): string | undefined {
  const keys = parseApiKeys(raw);
  if (keys.length === 0) return undefined;
  return keys[Math.floor(Math.random() * keys.length)];
}
