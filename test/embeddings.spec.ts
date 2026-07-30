import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({
  gemini: vi.fn(),
  voyage: vi.fn(),
  workersAi: vi.fn(),
}));

vi.mock('../src/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    providerEmbeddingCallers: {
      gemini: mocks.gemini,
      voyage_ai: mocks.voyage,
      workers_ai: mocks.workersAi,
    },
  };
});

function embeddingRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('https://gateway.test/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-gateway-key',
      'x-gateway-project-id': 'embedding-test',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/embeddings', () => {
  beforeEach(() => {
    mocks.gemini.mockReset();
    mocks.voyage.mockReset();
    mocks.workersAi.mockReset();
  });

  it('resolves OpenAI-compatible aliases and returns gateway metadata', async () => {
    mocks.gemini.mockResolvedValueOnce({
      response: {
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
        model: 'gemini-embedding-001',
        usage: { prompt_tokens: 2, total_tokens: 2 },
      },
    });
    const { env } = makeTestEnv({ GEMINI_API_KEY: 'gemini-key' });

    const response = await app.fetch(
      embeddingRequest({ model: 'text-embedding-3-small', input: 'hello' }),
      env,
      makeCtx()
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      model: string;
      data: unknown[];
      x_gateway: { provider: string; model: string; project_id: string };
    };
    expect(body.model).toBe('gemini-embedding-001');
    expect(body.data).toHaveLength(1);
    expect(body.x_gateway).toMatchObject({
      provider: 'gemini',
      model: 'gemini-embedding-001',
      project_id: 'embedding-test',
    });
    expect(mocks.gemini).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-embedding-001',
        input: ['hello'],
      })
    );
  });

  it('requires a valid project_id', async () => {
    const { env } = makeTestEnv({ GEMINI_API_KEY: 'gemini-key' });

    const response = await app.fetch(
      embeddingRequest(
        { model: 'gemini-embedding-001', input: 'hello' },
        { 'x-gateway-project-id': '' }
      ),
      env,
      makeCtx()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_project_id' },
    });
    expect(mocks.gemini).not.toHaveBeenCalled();
  });

  it('rejects the auto model', async () => {
    const { env } = makeTestEnv({ GEMINI_API_KEY: 'gemini-key' });

    const response = await app.fetch(
      embeddingRequest({ model: 'auto', input: 'hello' }),
      env,
      makeCtx()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_embedding_model' },
    });
  });

  it('returns 503 when no matching provider is configured', async () => {
    const { env } = makeTestEnv();

    const response = await app.fetch(
      embeddingRequest({ model: 'gemini-embedding-001', input: 'hello' }),
      env,
      makeCtx()
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'no_embedding_provider' },
    });
  });

  it('does not retry non-retriable provider errors', async () => {
    mocks.gemini.mockRejectedValueOnce(
      Object.assign(new Error('bad embedding input'), { status: 400 })
    );
    const { env } = makeTestEnv({
      GEMINI_API_KEY: 'gemini-key',
      VOYAGE_API_KEY: 'voyage-key',
    });

    const response = await app.fetch(
      embeddingRequest(
        { model: 'gemini-embedding-001', input: 'hello' },
        { 'x-gateway-force-provider': 'gemini' }
      ),
      env,
      makeCtx()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        type: 'input_nonretriable',
        message: expect.stringContaining('bad embedding input'),
      },
    });
    expect(mocks.gemini).toHaveBeenCalledOnce();
    expect(mocks.voyage).not.toHaveBeenCalled();
  });
});
