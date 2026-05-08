import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  groqMock: vi.fn(),
}));

vi.mock('../src/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    providerCallers: {
      ...(actual.providerCallers as Record<string, unknown>),
      groq: mocks.groqMock,
    },
  };
});

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

function replayRequest(body: Record<string, unknown>, headers: HeadersInit = {}) {
  return new Request('https://gateway.test/v1/debug/replay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-gateway-key',
      ...headers,
    },
    body: JSON.stringify({
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      project_id: 'debug-lab',
      messages: [{ role: 'user', content: 'hello' }],
      ...body,
    }),
  });
}

describe('POST /v1/debug/replay', () => {
  beforeEach(() => {
    mocks.groqMock.mockReset();
  });

  it('replays a request directly against a configured provider', async () => {
    mocks.groqMock.mockResolvedValueOnce({
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      stream: false,
      completion: {
        id: 'chatcmpl-replay',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      },
    });

    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({}), env, makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      provider: string;
      model: string;
      selected: { provider: string; model: string };
      completion?: { id?: string };
    };
    expect(body).toMatchObject({
      ok: true,
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      selected: { provider: 'groq', model: 'llama-3.1-8b-instant' },
      completion: { id: 'chatcmpl-replay' },
    });
    expect(mocks.groqMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      stream: false,
    }));
  });

  it('requires API key auth because replay spends provider quota', async () => {
    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({}, { authorization: '' }), env, makeCtx());

    expect(res.status).toBe(401);
    expect(mocks.groqMock).not.toHaveBeenCalled();
  });

  it('requires an explicit provider for provider debugging', async () => {
    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({ provider: undefined }), env, makeCtx());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'missing_provider' },
    });
    expect(mocks.groqMock).not.toHaveBeenCalled();
  });

  it('returns classified provider failure details without retrying another provider', async () => {
    mocks.groqMock.mockRejectedValueOnce(new Error('upstream 429 rate limit'));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({}), env, makeCtx());

    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error?: { message: string; type: string } };
    expect(body.ok).toBe(false);
    expect(body.error).toMatchObject({
      message: 'upstream 429 rate limit',
      type: 'usage_retriable',
    });
    expect(mocks.groqMock).toHaveBeenCalledOnce();
  });
});
