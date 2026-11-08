import { afterEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { callOpenAIEmbeddings } from '../src/providers/openai';
import { makeCtx, makeTestEnv } from './helpers/env';

vi.mock('../src/lib/telemetry', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  capture: vi.fn(),
  captureError: vi.fn(),
  flushPostHog: vi.fn(),
}));

const model = 'openai/text-embedding-3-small';
function environment(key: string | undefined = 'synthetic-openai-key') {
  return { ...makeTestEnv().env, OPENAI_API_KEY: key };
}
function request(body: Record<string, unknown> = {}, authorization = 'Bearer test-gateway-key') {
  return new Request('https://gateway.test/v1/embeddings', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ model, project_id: 'openai-embeddings-test', input: 'hello', ...body }),
  });
}
function mockUpstream(dimensions = 1536, count = 1) {
  const upstream = vi.fn(async () =>
    Response.json({
      object: 'list',
      model: 'text-embedding-3-small',
      data: Array.from({ length: count }, (_, index) => ({
        object: 'embedding',
        index,
        embedding: new Array(dimensions).fill(0.01),
      })),
      usage: { prompt_tokens: count, total_tokens: count },
    })
  );
  vi.stubGlobal('fetch', upstream);
  return upstream;
}
afterEach(() => vi.unstubAllGlobals());

describe('OpenAI embeddings', () => {
  it.each([
    ['hello', undefined, 1536, 1],
    [['first', 'second'], 256, 256, 2],
  ] as const)(
    'embeds %s with the selected dimensions',
    async (input, dimensions, length, count) => {
      const upstream = mockUpstream(length, count);
      const response = await app.fetch(request({ input, dimensions }), environment(), makeCtx());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { index: number; embedding: number[] }[];
        x_gateway: unknown;
      };
      expect(body.data.map((row) => [row.index, row.embedding.length])).toEqual(
        Array.from({ length: count }, (_, index) => [index, length])
      );
      expect(body.x_gateway).toMatchObject({ provider: 'openai', model });
      expect(upstream).toHaveBeenCalledTimes(1);
      const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(url)).toBe('https://api.openai.com/v1/embeddings');
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: 'text-embedding-3-small',
        input,
      });
      if (dimensions) expect(JSON.parse(String(init.body)).dimensions).toBe(dimensions);
    }
  );

  it('exposes OpenAI embeddings with accurate catalog metadata', async () => {
    const response = await app.fetch(
      new Request('https://gateway.test/v1/models'),
      environment(),
      makeCtx()
    );
    const body = (await response.json()) as { data: Record<string, unknown>[] };
    expect(body.data.find((row) => row.id === model)).toMatchObject({
      provider: 'openai',
      enabled: true,
      dimensions: 1536,
      supports_dimensions: true,
      automatic_routing: false,
    });
    expect(body.data.some((row) => String(row.model).includes('astra'))).toBe(false);
  });

  it('requires the OpenAI key without changing to another embedding space', async () => {
    const upstream = mockUpstream();
    const env = {
      ...environment(),
      OPENAI_API_KEY: undefined,
      GEMINI_API_KEY: 'synthetic-gemini-key',
    };
    const response = await app.fetch(request(), env, makeCtx());
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    await expect(
      callOpenAIEmbeddings({ env, provider: 'openai', model, input: ['hello'] })
    ).rejects.toThrow('OPENAI_API_KEY is not configured');
  });

  it('does not use OpenAI as fallback for legacy embedding names', async () => {
    const upstream = mockUpstream();
    const response = await app.fetch(
      request({ model: 'text-embedding-3-small' }),
      environment(),
      makeCtx()
    );
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('preserves the legacy Gemini alias when both keys exist', async () => {
    const upstream = mockUpstream(256);
    const response = await app.fetch(
      request({ model: 'text-embedding-3-small', dimensions: 256 }),
      { ...environment(), GEMINI_API_KEY: 'synthetic-gemini-key' },
      makeCtx()
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ x_gateway: { provider: 'gemini' } });
    expect(String((upstream.mock.calls[0] as unknown[])[0])).toContain(
      'generativelanguage.googleapis.com'
    );
  });

  it.each([0, 1537])(
    'rejects invalid dimensions %s before calling the provider',
    async (dimensions) => {
      const upstream = mockUpstream();
      const response = await app.fetch(request({ dimensions }), environment(), makeCtx());
      expect(response.status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
    }
  );

  it.each([429, 401])('does not switch vector spaces after OpenAI returns %s', async (status) => {
    const upstream = vi.fn(async () =>
      Response.json({ error: { message: 'Unavailable', code: 'insufficient_quota' } }, { status })
    );
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(
      request(),
      { ...environment(), GEMINI_API_KEY: 'synthetic-gemini-key' },
      makeCtx()
    );
    expect(response.ok).toBe(false);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('rejects partial batches rather than returning mismatched vectors', async () => {
    const upstream = mockUpstream(256, 1);
    const response = await app.fetch(
      request({ input: ['first', 'second'], dimensions: 256 }),
      environment(),
      makeCtx()
    );
    expect(response.status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('retains gateway authentication', async () => {
    const upstream = mockUpstream();
    const response = await app.fetch(request({}, 'Bearer wrong'), environment(), makeCtx());
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
