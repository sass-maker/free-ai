import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { callModalEmbeddings, MODAL_EMBEDDING_MODELS } from '../src/providers/modal-embeddings';
import type { Env } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const GEMMA = 'google/embeddinggemma-2';
const SMALL = 'BAAI/bge-small-en-v1.5';
let upstream: ReturnType<typeof vi.fn>;

function modelResponse(model = GEMMA, dimensions = 768, count = 1) {
  return {
    object: 'list',
    model,
    data: Array.from({ length: count }, (_, index) => ({
      object: 'embedding',
      index,
      embedding: Array.from({ length: dimensions }, (_, offset): number => (offset === 0 ? 1 : 0)),
    })),
    usage: { prompt_tokens: count * 10, total_tokens: count * 10 },
  };
}

function configuredEnv() {
  const { env: base } = makeTestEnv({ GEMINI_API_KEY: 'synthetic-gemini' });
  const admission = vi.fn(async () =>
    Response.json({ allowed: true, remaining: 4, retryAfter: 0 })
  );
  const original = base.RATE_LIMIT_DO;
  const idFromName = vi.fn(original.idFromName);
  const env: Env = {
    ...base,
    MODAL_PROXY_KEY: 'synthetic-modal-key',
    MODAL_PROXY_SECRET: 'synthetic-modal-secret',
    RATE_LIMIT_DO: {
      ...original,
      idFromName,
      get: (id: DurableObjectId) =>
        (id as unknown as { name: string }).name === 'modal-embedding-trial-v1'
          ? ({ fetch: admission } as unknown as DurableObjectStub)
          : original.get(id),
    } as unknown as DurableObjectNamespace,
  };
  return { env, admission, idFromName };
}

function request(body: Record<string, unknown>, authorization = 'Bearer test-gateway-key') {
  return new Request('https://gateway.test/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ project_id: 'modal-trial-test', model: GEMMA, input: 'hello', ...body }),
  });
}

describe('Modal embeddings through Free AI', () => {
  beforeEach(() => {
    upstream = vi.fn(async () => Response.json(modelResponse()));
    vi.stubGlobal('fetch', upstream);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(MODAL_EMBEDDING_MODELS)(
    'exposes $model only as an explicit experiment',
    async (model) => {
      const { env, admission, idFromName } = configuredEnv();
      const dimensions = model.dimensions[0];
      upstream.mockResolvedValueOnce(Response.json(modelResponse(model.model, dimensions, 2)));
      const response = await app.fetch(
        request({
          model: model.model,
          input: ['document A', 'document B'],
          dimensions,
          task: 'retrieval_document',
        }),
        env,
        makeCtx()
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        model: model.model,
        data: [{ index: 0 }, { index: 1 }],
        x_gateway: {
          provider: 'modal',
          model: model.model,
          attempts: 1,
          project_id: 'modal-trial-test',
        },
      });
      expect(admission).toHaveBeenCalledOnce();
      expect(idFromName).toHaveBeenCalledWith('modal-embedding-trial-v1');
      const [url, init] = upstream.mock.calls[0];
      expect(url).toBe(model.url);
      expect(init.headers).toMatchObject({
        'Modal-Key': 'synthetic-modal-key',
        'Modal-Secret': 'synthetic-modal-secret',
      });
      expect(JSON.parse(init.body)).toMatchObject({
        model: model.model,
        task: 'retrieval_document',
        dimensions,
      });
      const catalog = await app.fetch(
        new Request('https://gateway.test/v1/models'),
        env,
        makeCtx()
      );
      const body = (await catalog.json()) as { data: Array<Record<string, unknown>> };
      expect(body.data.find((candidate) => candidate.model === model.model)).toMatchObject({
        provider: 'modal',
        enabled: true,
        automatic_routing: false,
      });
    }
  );

  it.each(['MODAL_PROXY_KEY', 'MODAL_PROXY_SECRET'] as const)(
    'fails closed without %s',
    async (field) => {
      const { env, admission } = configuredEnv();
      env[field] = '';
      const response = await app.fetch(request({}), env, makeCtx());
      expect(response.status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
      expect(admission).not.toHaveBeenCalled();
      const catalog = await app.fetch(
        new Request('https://gateway.test/v1/models'),
        env,
        makeCtx()
      );
      const body = (await catalog.json()) as { data: Array<Record<string, unknown>> };
      expect(body.data.find((candidate) => candidate.model === GEMMA)).toMatchObject({
        enabled: false,
      });
    }
  );

  it.each([
    { input: ['valid', '   '] },
    { input: Array.from({ length: 9 }, () => 'text') },
    { input: 'x'.repeat(16001) },
    { dimensions: 384 },
    { model: SMALL, task: 'classification' },
    { model: SMALL, dimensions: 128 },
    { model: 'gemini-embedding-001', task: 'retrieval_query' },
    { project_id: '' },
  ])('rejects unsupported input before admission: %j', async (body) => {
    const { env, admission } = configuredEnv();
    expect((await app.fetch(request(body), env, makeCtx())).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect(admission).not.toHaveBeenCalled();
  });

  it('requires gateway auth before any Modal work', async () => {
    const { env, admission } = configuredEnv();
    expect((await app.fetch(request({}, ''), env, makeCtx())).status).toBe(401);
    expect(upstream.mock.calls.some(([url]) => String(url).includes('modal.run'))).toBe(false);
    expect(admission).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500, 413])(
    'sanitizes upstream %i and never switches models or retries',
    async (status) => {
      const { env, admission } = configuredEnv();
      upstream.mockResolvedValueOnce(
        new Response('private input synthetic-modal-secret', { status })
      );
      const response = await app.fetch(request({ task: 'retrieval_query' }), env, makeCtx());
      expect(response.status).toBe(status === 413 ? 400 : status === 429 ? 429 : 502);
      const text = await response.text();
      expect(text).not.toContain('private input');
      expect(text).not.toContain('synthetic-modal-secret');
      expect(upstream).toHaveBeenCalledOnce();
      expect(admission).toHaveBeenCalledOnce();
      expect(JSON.parse(upstream.mock.calls[0][1].body).task).toBe('retrieval_query');
    }
  );

  it.each([
    { allowed: false, remaining: 0, retryAfter: 1440 },
    { allowed: true, remaining: 50, retryAfter: 0 },
    { allowed: 'true', remaining: 4, retryAfter: 0 },
  ])('fails closed on exhausted or malformed admission: %j', async (result) => {
    const { env, admission } = configuredEnv();
    admission.mockResolvedValueOnce(
      Response.json(result, { status: result.allowed === false ? 429 : 200 })
    );
    const response = await app.fetch(request({}), env, makeCtx());
    expect(response.status).toBe(result.allowed === false ? 429 : 503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('fails closed if the shared admission service throws', async () => {
    const { env, admission } = configuredEnv();
    admission.mockRejectedValueOnce(new Error('internal synthetic secret'));
    const response = await app.fetch(request({}), env, makeCtx());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('synthetic secret');
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...modelResponse(), model: SMALL },
    { ...modelResponse(), data: [] },
    { ...modelResponse(), usage: { prompt_tokens: 9000, total_tokens: 9000 } },
    {
      ...modelResponse(),
      data: [{ object: 'embedding', index: 1, embedding: modelResponse().data[0].embedding }],
    },
    {
      ...modelResponse(),
      data: [{ object: 'embedding', index: 0, embedding: Array.from({ length: 768 }, () => 0) }],
    },
  ])('rejects invalid vectors without fallback', async (body) => {
    const { env } = configuredEnv();
    upstream.mockResolvedValueOnce(Response.json(body));
    expect((await app.fetch(request({}), env, makeCtx())).status).toBe(502);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('does not route existing provider requests into Modal on upstream failure', async () => {
    const { env, admission } = configuredEnv();
    upstream.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const response = await app.fetch(request({ model: 'gemini-embedding-001' }), env, makeCtx());
    expect(response.status).toBe(429);
    expect(admission).not.toHaveBeenCalled();
    expect(upstream.mock.calls.every(([url]) => !String(url).includes('modal.run'))).toBe(true);
  });

  it('does not spend compute when provider restrictions conflict with the model', async () => {
    const { env, admission } = configuredEnv();
    const restricted = request({});
    restricted.headers.set('x-gateway-force-provider', 'gemini');
    expect((await app.fetch(restricted, env, makeCtx())).status).toBe(503);
    expect(admission).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('allows slow cold starts and forwards caller cancellation', async () => {
    const { env, admission } = configuredEnv();
    const controller = new AbortController();
    upstream.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          });
          controller.abort();
        })
    );
    await expect(
      callModalEmbeddings({
        env,
        provider: 'modal',
        model: GEMMA,
        input: ['hello'],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ status: 502 });
    expect(admission).toHaveBeenCalledOnce();
    expect(upstream).toHaveBeenCalledOnce();
    await expect(
      callModalEmbeddings({
        env,
        provider: 'modal',
        model: GEMMA,
        input: ['hello'],
        signal: controller.signal,
      })
    ).rejects.toThrow();
    expect(admission).toHaveBeenCalledOnce();
  });

  it('uses a 150-second cold-start deadline', async () => {
    const { env } = configuredEnv();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      await callModalEmbeddings({ env, provider: 'modal', model: GEMMA, input: ['hello'] });
      expect(timeout).toHaveBeenCalledWith(150000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('rejects nonfinite vectors and non-JSON successes', async () => {
    const { env } = configuredEnv();
    const invalid = modelResponse();
    invalid.data[0].embedding[0] = Number.NaN;
    upstream.mockResolvedValueOnce(Response.json(invalid));
    expect((await app.fetch(request({}), env, makeCtx())).status).toBe(502);
    upstream.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect((await app.fetch(request({}), env, makeCtx())).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
