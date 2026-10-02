import { describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { fetchFleetRequest, runFleetNative } from '../src/fleet-gateway';
import { makeCtx, makeTestEnv } from './helpers/env';

function request(
  body: Record<string, unknown> = {},
  project = 'live',
  path = '/v1/chat/completions'
) {
  return new Request(`https://fleet-gateway.internal${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer service-binding', 'x-gateway-project-id': project },
    body: JSON.stringify({
      model: 'auto',
      messages: [{ role: 'user', content: 'hello' }],
      ...body,
    }),
  });
}

function nativeEnv(allowed = true) {
  const { env } = makeTestEnv({ WORKERS_AI_ENABLED: 'true' });
  let receiver: unknown;
  const run = vi.fn(async function (this: unknown) {
    receiver = this;
    return { data: [Array.from({ length: 768 }, () => 0.1)] };
  });
  const debit = vi.fn(async () =>
    Response.json({
      allowed,
      used: allowed ? 100 : 9500,
      remaining: allowed ? 9400 : 0,
      retryAfter: allowed ? 0 : 60,
      dayKey: new Date().toISOString().slice(0, 10),
    })
  );
  const budget = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => ({ fetch: debit })),
  } as unknown as DurableObjectNamespace;
  return {
    env: { ...env, AI: { run }, NEURON_BUDGET: budget },
    run,
    debit,
    receiver: () => receiver,
  };
}

describe('private Fleet gateway HTTP boundary', () => {
  it('authenticates only the internal dispatch and preserves streaming without buffering', async () => {
    const { env } = makeTestEnv();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: ok\n\n'));
        controller.close();
      },
    });
    const dispatch = vi.fn(async (forwarded: Request) => {
      expect(forwarded.headers.get('authorization')).toBe('Bearer test-gateway-key');
      expect(forwarded.headers.get('cf-connecting-ip')).toBe('fleet:live');
      expect(await forwarded.json()).toMatchObject({
        project_id: 'live',
        stream: true,
        max_tokens: 48,
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    });
    const response = await fetchFleetRequest(
      request({ stream: true, max_tokens: 48 }),
      env,
      dispatch
    );
    expect(response.body).toBe(stream);
    expect(await response.text()).toBe('data: ok\n\n');
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('reuses real public request validation after internal authentication', async () => {
    const { env } = makeTestEnv();
    const response = await fetchFleetRequest(
      request({ max_tokens: 8193 }),
      env,
      async (forwarded) => app.fetch(forwarded, env, makeCtx())
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain('invalid_api_key');
  });

  it('keeps the public endpoint closed to the service-binding placeholder and spoofed internal headers', async () => {
    const { env } = makeTestEnv();
    const req = request();
    req.headers.set('x-gateway-internal', '1');
    expect((await app.fetch(req, env, makeCtx())).status).toBe(401);
  });

  it.each([
    { project: 'unknown', path: '/v1/chat/completions', body: {}, status: 400 },
    { project: 'live', path: '/v1/debug/replay', body: {}, status: 404 },
    { project: 'live', path: '/v1/chat/completions', body: { project_id: 'reader' }, status: 400 },
    {
      project: 'live',
      path: '/v1/chat/completions',
      body: { prompt: 'x'.repeat(524_289) },
      status: 400,
    },
  ])(
    'rejects an invalid private request before dispatch: $project $path',
    async ({ project, path, body, status }) => {
      const { env } = makeTestEnv();
      const dispatch = vi.fn();
      expect((await fetchFleetRequest(request(body, project, path), env, dispatch)).status).toBe(
        status
      );
      expect(dispatch).not.toHaveBeenCalled();
    }
  );

  it('fails closed without the gateway credential without dispatching', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: '' });
    const dispatch = vi.fn();
    expect((await fetchFleetRequest(request(), env, dispatch)).status).toBe(503);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('preserves visitor address and cancellation on the internally authenticated request', async () => {
    const { env } = makeTestEnv();
    const controller = new AbortController();
    const req = new Request(request(), { signal: controller.signal });
    req.headers.set('cf-connecting-ip', '192.0.2.1');
    controller.abort();
    const dispatch = vi.fn(async (forwarded: Request) => {
      expect(forwarded.signal.aborted).toBe(true);
      expect(forwarded.headers.get('cf-connecting-ip')).toBe('192.0.2.1');
      return new Response(null, { status: 499 });
    });
    expect((await fetchFleetRequest(req, env, dispatch)).status).toBe(499);
  });
});

describe('private native embeddings and budget', () => {
  it('reserves once before the exact CLS-pooling payload and preserves the AI receiver', async () => {
    const { env, run, debit, receiver } = nativeEnv();
    const input = { text: ['synthetic comment'], pooling: 'cls' };
    const result = await runFleetNative(env, 'meme-lab', '@cf/baai/bge-base-en-v1.5', input);
    expect(result).toMatchObject({ data: [expect.arrayContaining([0.1])] });
    expect(run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', input);
    expect(receiver()).toBe(env.AI);
    expect(debit).toHaveBeenCalledOnce();
    expect(debit.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
  });

  it('does not add pooling or reorder batched default embeddings', async () => {
    const { env, run } = nativeEnv();
    await runFleetNative(env, 'starboard', '@cf/baai/bge-base-en-v1.5', {
      text: ['first', 'second'],
    });
    expect(run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', { text: ['first', 'second'] });
  });

  it.each([
    { project: 'unknown', model: '@cf/baai/bge-base-en-v1.5', input: { text: ['a'] } },
    { project: 'live', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', input: { prompt: 'a' } },
    {
      project: 'knowledge-base',
      model: '@cf/baai/bge-reranker-base',
      input: { query: 'a', contexts: [] },
    },
    { project: 'starboard', model: '@cf/baai/bge-base-en-v1.5', input: { text: [] } },
    {
      project: 'meme-lab',
      model: '@cf/baai/bge-base-en-v1.5',
      input: { text: ['a'], pooling: 'invalid' },
    },
  ])(
    'rejects invalid/unpriced native requests without a debit or AI: $project $model',
    async ({ project, model, input }) => {
      const { env, run, debit } = nativeEnv();
      await expect(runFleetNative(env, project, model, input)).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
      expect(debit).not.toHaveBeenCalled();
    }
  );

  it('makes zero AI calls when the shared budget denies or is unavailable', async () => {
    const { env, run, debit } = nativeEnv(false);
    await expect(
      runFleetNative(env, 'starboard', '@cf/baai/bge-base-en-v1.5', { text: ['a'] })
    ).rejects.toThrow('neuron_budget_exhausted');
    expect(run).not.toHaveBeenCalled();
    debit.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(
      runFleetNative(env, 'starboard', '@cf/baai/bge-base-en-v1.5', { text: ['a'] })
    ).rejects.toThrow('neuron_budget_unavailable');
    expect(run).not.toHaveBeenCalled();
  });
});
