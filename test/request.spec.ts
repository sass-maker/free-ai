import { describe, expect, it } from 'vitest';

import { normalizeMessages } from '../src/utils/request';

describe('normalizeMessages', () => {
  it('uses messages when provided', () => {
    const result = normalizeMessages([{ role: 'user', content: 'Hello' }], 'ignored');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello');
  });

  it('converts prompt into a single user message', () => {
    const result = normalizeMessages(undefined, 'Prompt text');
    expect(result).toEqual([{ role: 'user', content: 'Prompt text' }]);
  });

  it('returns empty list when both inputs are missing', () => {
    const result = normalizeMessages(undefined, undefined);
    expect(result).toEqual([]);
  });
});
