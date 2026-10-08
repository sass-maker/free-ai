import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

const model = 'gemini-3.8-flash';
const keys = 'synthetic-one,synthetic-two,synthetic-three,synthetic-four,synthetic-five';
const request = (signal?: AbortSignal, stream = false) =>
  new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      authorization: 'Bearer test-gateway-key',
      'content-type': 'application/json',
      'x-gateway-force-provider': 'gemini',
      'x-gateway-force-model': model,
    },
    body: JSON.stringify({
      model,
      project_id: 'key-recovery-test',
      reasoning_effort: 'low',
      max_tokens: 800,
      stream,
      messages: [{ role: 'user', content: 'Synthetic request' }],
    }),
  });
const success = () =>
  Response.json({
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: 'Recovered' }, finish_reason: 'stop' },
    ],
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pinned Gemini key recovery through the real SDK', () => {
  it('recovers a streaming handshake without changing models or repeating a key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const auth: Array<string | null> = [];
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const sent = new Request(input, init);
      auth.push(sent.headers.get('authorization'));
      if (auth.length === 1)
        return Response.json({ error: { message: 'Synthetic unavailable' } }, { status: 503 });
      return new Response(
        'data: ' +
          JSON.stringify({ model, choices: [{ index: 0, delta: { content: 'Recovered' } }] }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GEMINI_API_KEY: keys });
    const response = await app.fetch(request(undefined, true), env, makeCtx());
    expect(response.status).toBe(200);
    expect(response.headers.get('x-gateway-model')).toBe(model);
    expect(response.headers.get('x-gateway-attempts')).toBe('2');
    expect(await response.text()).toContain('Recovered');
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(auth[0]).not.toBe(auth[1]);
  });
  it.each([401, 402, 403, 429, 503])(
    'recovers upstream %s with a distinct key within two attempts',
    async (status) => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const logs = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const accepted = vi.spyOn(console, 'info').mockImplementation(() => {});
      const auth: string[] = [];
      const bodies: unknown[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const upstream = new Request(input, init);
          auth.push(upstream.headers.get('authorization') ?? '');
          bodies.push(await upstream.json());
          return auth.length === 1
            ? Response.json({ error: { message: 'Synthetic unavailable' } }, { status })
            : success();
        })
      );
      const { env } = makeTestEnv({ GEMINI_API_KEY: keys });
      const response = await app.fetch(request(), env, makeCtx());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(auth).toEqual(['Bearer synthetic-one', 'Bearer synthetic-two']);
      expect(bodies).toHaveLength(2);
      for (const sent of bodies)
        expect(sent).toMatchObject({ model, reasoning_effort: 'low', max_tokens: 800 });
      expect(body).toMatchObject({
        model,
        degraded: true,
        x_gateway: { attempts: 2, provider: 'gemini' },
      });
      expect(JSON.stringify(body)).not.toContain('synthetic-');
      const logged = logs.mock.calls.map(([entry]) => String(entry)).join('');
      expect(logged).toContain(`"upstream_status":${status}`);
      expect(logged).toContain('"key_slot":1');
      expect(logged).toContain('"key_pool_size":5');
      expect(logged).not.toContain('synthetic-one');
      expect(logged).not.toContain('Synthetic request');
      const positive = accepted.mock.calls.map(([entry]) => String(entry)).join('');
      expect(positive).toContain('"key_slot":2');
      expect(positive).toContain('"stream_handshake":false');
      expect(positive).not.toContain('synthetic-');
    }
  );

  it('stops after two failures even with five keys and exposes the actual upstream status', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upstream = vi.fn(async () =>
      Response.json({ error: { message: 'Synthetic unavailable' } }, { status: 503 })
    );
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GEMINI_API_KEY: keys });
    const response = await app.fetch(request(), env, makeCtx());
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({ error: { upstream_status: 503, attempts: 2 } });
  });

  it.each([400, 404])('does not rotate keys for upstream %s', async (status) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upstream = vi.fn(async () =>
      Response.json({ error: { message: 'Synthetic invalid request' } }, { status })
    );
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GEMINI_API_KEY: keys });
    await app.fetch(request(), env, makeCtx());
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('preserves a safety refusal carried by a 403 without trying another key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upstream = vi.fn(async () =>
      Response.json({ error: { message: 'content filter refusal' } }, { status: 403 })
    );
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GEMINI_API_KEY: keys });
    await app.fetch(request(), env, makeCtx());
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('does not treat duplicate entries as alternate keys', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upstream = vi.fn(async () =>
      Response.json({ error: { message: 'Synthetic unavailable' } }, { status: 503 })
    );
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GEMINI_API_KEY: 'synthetic-one, synthetic-one' });
    await app.fetch(request(), env, makeCtx());
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('does not start an alternate-key request after cancellation', async () => {
    const controller = new AbortController();
    const upstream = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GEMINI_API_KEY: keys });
    await app.fetch(request(controller.signal), env, makeCtx());
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
