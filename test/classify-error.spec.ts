import { describe, expect, it } from 'vitest';

import { classifyError, isRetriableFailure } from '../src/router/classify-error';

describe('classifyError', () => {
  it('marks 429 as usage_retriable', () => {
    const failure = classifyError({ status: 429, message: 'Rate limit hit' });
    expect(failure).toBe('usage_retriable');
    expect(isRetriableFailure(failure)).toBe(true);
  });

  it('marks safety text as safety_refusal', () => {
    const failure = classifyError({ status: 400, message: 'Blocked due to safety policy' });
    expect(failure).toBe('safety_refusal');
    expect(isRetriableFailure(failure)).toBe(false);
  });

  it('marks 400 as input_nonretriable', () => {
    const failure = classifyError({ status: 400, message: 'Invalid prompt format' });
    expect(failure).toBe('input_nonretriable');
  });
});
