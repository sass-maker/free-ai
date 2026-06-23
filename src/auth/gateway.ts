import type { Env } from '../types';

export function isGatewayAuthConfigured(env: Env): boolean {
  return Boolean(
    env.GATEWAY_API_KEY || parseGatewayApiKeyHashes(env.GATEWAY_API_KEY_HASHES).length > 0
  );
}

export async function isValidGatewayApiKey(providedKey: string, env: Env): Promise<boolean> {
  if (!providedKey) {
    return false;
  }

  const legacyKey = env.GATEWAY_API_KEY;
  if (
    legacyKey &&
    providedKey.length === legacyKey.length &&
    isConstantTimeEqual(providedKey, legacyKey)
  ) {
    return true;
  }

  const expectedHashes = parseGatewayApiKeyHashes(env.GATEWAY_API_KEY_HASHES);
  if (expectedHashes.length === 0) {
    return false;
  }

  const providedHash = await sha256Hex(providedKey);
  return expectedHashes.some((expectedHash) => isConstantTimeEqual(providedHash, expectedHash));
}

export function parseGatewayApiKeyHashes(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/[,\n]+/)
    .map((entry) => entry.trim())
    .map((entry) => {
      const separatorIndex = entry.lastIndexOf(':');
      return separatorIndex === -1 ? entry : entry.slice(separatorIndex + 1).trim();
    })
    .filter((hash) => /^[a-f0-9]{64}$/i.test(hash))
    .map((hash) => hash.toLowerCase());
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison prevents timing oracle on API key checks. */
function isConstantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
