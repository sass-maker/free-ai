import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

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
      model: 'openai/gpt-oss-20b',
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
      model: 'openai/gpt-oss-20b',
      stream: false,
      completion: {
        id: 'chatcmpl-replay',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
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
      model: 'openai/gpt-oss-20b',
      selected: { provider: 'groq', model: 'openai/gpt-oss-20b' },
      completion: { id: 'chatcmpl-replay' },
    });
    expect(mocks.groqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        stream: false,
      })
    );
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

  it('returns classified provider failure details without retrying or exposing raw error data', async () => {
    mocks.groqMock.mockRejectedValueOnce({
      statusCode: 403,
      message: 'token=secret-token https://provider.example/v1/chat raw-response-secret',
      response: { data: { authorization: 'Bearer secret-token' } },
    });

    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({}), env, makeCtx());

    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      ok: boolean;
      error?: { message: string; type: string; upstream_status: number | null };
    };
    expect(body.ok).toBe(false);
    expect(body.error).toMatchObject({
      message: 'Provider replay failed',
      type: 'provider_fatal',
      upstream_status: 403,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('provider.example');
    expect(serialized).not.toContain('raw-response-secret');
    expect(serialized).not.toContain('authorization');
    expect(mocks.groqMock).toHaveBeenCalledOnce();
  });

  it('preserves existing classification from error messages when upstream status is unavailable', async () => {
    mocks.groqMock.mockRejectedValueOnce(new Error('upstream 429 rate limit'));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({}), env, makeCtx());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: 'Provider replay failed',
        type: 'usage_retriable',
        upstream_status: null,
      },
    });
    expect(mocks.groqMock).toHaveBeenCalledOnce();
  });

  it('extracts an HTTP status from a nested provider response', async () => {
    mocks.groqMock.mockRejectedValueOnce({ response: { status: 503 } });

    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({}), env, makeCtx());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'usage_retriable', upstream_status: 503 },
    });
  });

  it('reports null when the provider error has no status fields', async () => {
    mocks.groqMock.mockRejectedValueOnce({ message: 'private provider diagnostic' });

    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({}), env, makeCtx());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: { upstream_status: null },
    });
  });

  it('reports a null upstream status when the error has no numeric HTTP status', async () => {
    mocks.groqMock.mockRejectedValueOnce({
      statusCode: 700,
      response: { status: '403' },
      message: 'private provider diagnostic token=secret-token https://provider.example',
    });

    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    const res = await app.fetch(replayRequest({}), env, makeCtx());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: {
        message: 'Provider replay failed',
        type: 'provider_fatal',
        upstream_status: null,
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(JSON.stringify(body)).not.toContain('provider.example');
  });
});
