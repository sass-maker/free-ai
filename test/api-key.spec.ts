import { describe, expect, it } from 'vitest';

import { parseApiKeys, pickApiKey } from '../src/providers/api-key';

describe('parseApiKeys', () => {
  it('returns an empty list for missing or blank secrets', () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys('')).toEqual([]);
    expect(parseApiKeys('   ')).toEqual([]);
    expect(parseApiKeys(',, ,')).toEqual([]);
  });

  it('parses a single key unchanged', () => {
    expect(parseApiKeys('key-one')).toEqual(['key-one']);
  });

  it('parses a comma-separated list and trims entries', () => {
    expect(parseApiKeys('key-one, key-two ,key-three')).toEqual([
      'key-one',
      'key-two',
      'key-three',
    ]);
  });
});

describe('pickApiKey', () => {
  it('returns undefined when no key is configured', () => {
    expect(pickApiKey(undefined)).toBeUndefined();
    expect(pickApiKey('')).toBeUndefined();
  });

  it('returns the single configured key', () => {
    expect(pickApiKey('only-key')).toBe('only-key');
  });

  it('picks from the configured list', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const picked = pickApiKey('k1,k2,k3');
      expect(['k1', 'k2', 'k3']).toContain(picked);
      seen.add(picked as string);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
