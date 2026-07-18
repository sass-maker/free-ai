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

  it('marks 500 as usage_retriable', () => {
    const failure = classifyError({ status: 500, message: 'Internal server error' });
    expect(failure).toBe('usage_retriable');
    expect(isRetriableFailure(failure)).toBe(true);
  });

  it('marks 503 as usage_retriable', () => {
    const failure = classifyError({ status: 503, message: 'Service unavailable' });
    expect(failure).toBe('usage_retriable');
  });

  it('marks 401 as provider_fatal', () => {
    const failure = classifyError({ status: 401, message: 'Unauthorized' });
    expect(failure).toBe('provider_fatal');
    expect(isRetriableFailure(failure)).toBe(false);
  });

  it('marks 403 as provider_fatal', () => {
    const failure = classifyError({ status: 403, message: 'Forbidden' });
    expect(failure).toBe('provider_fatal');
    expect(isRetriableFailure(failure)).toBe(false);
  });

  it('marks timeout message as usage_retriable even without status', () => {
    const failure = classifyError(new Error('request timeout'));
    expect(failure).toBe('usage_retriable');
    expect(isRetriableFailure(failure)).toBe(true);
  });

  it('marks rate limit message as usage_retriable even without status', () => {
    const failure = classifyError(new Error('rate limit exceeded'));
    expect(failure).toBe('usage_retriable');
  });

  it('marks overload message as usage_retriable', () => {
    const failure = classifyError(new Error('model is overloaded'));
    expect(failure).toBe('usage_retriable');
  });

  it('marks quota message as usage_retriable', () => {
    const failure = classifyError(new Error('quota exceeded'));
    expect(failure).toBe('usage_retriable');
  });

  it('marks unknown errors as provider_fatal', () => {
    const failure = classifyError(new Error('something went wrong'));
    expect(failure).toBe('provider_fatal');
    expect(isRetriableFailure(failure)).toBe(false);
  });

  it('extracts status from response property', () => {
    const failure = classifyError({ response: { status: 502 }, message: 'bad gateway' });
    expect(failure).toBe('usage_retriable');
  });

  it('marks 404 as input_nonretriable', () => {
    const failure = classifyError({ status: 404, message: 'model not found' });
    expect(failure).toBe('input_nonretriable');
  });

  it('marks 422 as input_nonretriable', () => {
    const failure = classifyError({ status: 422, message: 'validation error' });
    expect(failure).toBe('input_nonretriable');
  });
});
