import { describe, expect, it, vi } from 'vitest';

import {
  buildCompletionEnvelope,
  createRequestId,
  getErrorMessage,
  normalizeMessages,
} from '../src/utils/request';

describe('createRequestId', () => {
  it('returns a UUID', () => {
    expect(createRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

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

describe('getErrorMessage', () => {
  it('reads Error and string messages directly', () => {
    expect(getErrorMessage(new Error('provider failed'))).toBe('provider failed');
    expect(getErrorMessage('gateway failed')).toBe('gateway failed');
  });

  it('serializes structured values', () => {
    expect(getErrorMessage({ provider: 'groq', status: 429 })).toBe(
      '{"provider":"groq","status":429}'
    );
  });

  it('falls back when JSON serialization returns no value or throws', () => {
    expect(getErrorMessage(undefined)).toBe('Unknown error');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(getErrorMessage(circular)).toBe('Unknown error');
  });
});

describe('buildCompletionEnvelope', () => {
  it('builds the OpenAI-compatible default envelope', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_750_000_000_999);

    expect(
      buildCompletionEnvelope({
        model: 'free-model',
        content: 'Hello',
        requestId: 'request-1',
        gatewayMeta: { provider: 'groq' },
      })
    ).toEqual({
      id: 'chatcmpl-request-1',
      object: 'chat.completion',
      created: 1_750_000_000,
      model: 'free-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello' },
          finish_reason: 'stop',
        },
      ],
      usage: undefined,
      x_gateway: { provider: 'groq' },
    });

    vi.restoreAllMocks();
  });

  it('preserves an explicit finish reason and usage', () => {
    const usage = {
      prompt_tokens: 4,
      completion_tokens: 2,
      total_tokens: 6,
    };

    const envelope = buildCompletionEnvelope({
      model: 'free-model',
      content: '',
      requestId: 'request-2',
      finishReason: 'length',
      usage,
      gatewayMeta: null,
    });

    expect(envelope.choices).toEqual([
      {
        index: 0,
        message: { role: 'assistant', content: '' },
        finish_reason: 'length',
      },
    ]);
    expect(envelope.usage).toBe(usage);
  });
});
