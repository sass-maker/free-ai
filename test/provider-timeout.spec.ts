import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

// Mock chat providers so we can simulate slow/timeout behavior.
const mocks = vi.hoisted(() => ({
  groqMock: vi.fn(),
  openrouterMock: vi.fn(),
}));

vi.mock('../src/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    providerCallers: {
      ...(actual.providerCallers as Record<string, unknown>),
      groq: mocks.groqMock,
      openrouter: mocks.openrouterMock,
    },
  };
});

function chatRequest(body: Record<string, unknown> = {}) {
  return new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-gateway-key',
      'x-gateway-force-provider': 'groq',
    },
    body: JSON.stringify({
      model: 'auto',
      project_id: 'timeout-test',
      messages: [{ role: 'user', content: 'hello' }],
      ...body,
    }),
  });
}

describe('provider timeout resilience', () => {
  beforeEach(() => {
    mocks.groqMock.mockReset();
    mocks.openrouterMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 429 when provider throws a timeout error (usage_retriable)', async () => {
    // Timeout message → classifyError returns usage_retriable → 429 status
    mocks.groqMock.mockRejectedValue(new Error('request timeout'));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });

    const res = await app.fetch(chatRequest(), env, makeCtx());
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe('usage_retriable');
    expect(body.error.message).toContain('request timeout');
  });

  it('returns 429 when provider returns 5xx (usage_retriable)', async () => {
    mocks.groqMock.mockRejectedValue(
      Object.assign(new Error('internal server error'), { status: 500 })
    );

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });

    const res = await app.fetch(chatRequest(), env, makeCtx());
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('usage_retriable');
  });

  it('returns 502 when provider returns 403 (provider_fatal, no retry)', async () => {
    mocks.groqMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });

    const res = await app.fetch(chatRequest(), env, makeCtx());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('provider_fatal');
  });

  it('returns 400 when provider returns 400 (input_nonretriable, no retry)', async () => {
    mocks.groqMock.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });

    const res = await app.fetch(chatRequest(), env, makeCtx());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('input_nonretriable');
  });

  it('does not amplify 5xx into an infinite retry loop', async () => {
    // Provider always returns 500 — retriable, but the pRetry loop is capped at
    // retries: 1 (max 2 attempts). This should terminate, not loop forever.
    mocks.groqMock.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });

    const res = await app.fetch(chatRequest(), env, makeCtx());
    // Should terminate with a retriable status, not hang.
    expect(res.status).toBe(429);
    // Verify the provider was called at most 2 times (no infinite retry).
    expect(mocks.groqMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('classifies 429 as usage_retriable and returns 429 status', async () => {
    mocks.groqMock.mockRejectedValue(Object.assign(new Error('rate limit hit'), { status: 429 }));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });

    const res = await app.fetch(chatRequest(), env, makeCtx());
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('usage_retriable');
  });

  it('sets degraded label when fallback succeeds (forced provider scenario)', async () => {
    // Use a forced provider to control candidate selection.
    // First groq model fails with timeout, second groq model succeeds.
    mocks.groqMock.mockRejectedValueOnce(new Error('request timeout'));
    mocks.groqMock.mockResolvedValueOnce({
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      stream: false,
      completion: {
        id: 'chatcmpl-fallback',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      },
    });

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });

    const res = await app.fetch(chatRequest(), env, makeCtx());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      degraded: boolean;
      x_gateway: { attempts: number };
    };
    // Fallback happened within groq → degraded mode.
    expect(body.degraded).toBe(true);
    expect(body.x_gateway.attempts).toBe(2);
  });
});
