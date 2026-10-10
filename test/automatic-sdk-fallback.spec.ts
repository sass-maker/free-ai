import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { ModelCandidate } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({ registry: [] as ModelCandidate[] }));
vi.mock('../src/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getModelRegistry: () => mocks.registry,
}));

function candidate(
  model: string,
  provider: 'gemini' | 'groq' | 'nvidia',
  vision = false
): ModelCandidate {
  return {
    id: model,
    model,
    provider,
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 1,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision,
      contextWindow: 32000,
      maxOutputTokens: 4096,
    },
  };
}

function request(signal?: AbortSignal, vision = false, stream = false) {
  return new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      authorization: 'Bearer test-gateway-key',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'auto',
      project_id: 'automatic-sdk-regression',
      max_tokens: 800,
      stream,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: vision
            ? [{ type: 'image_url', image_url: { url: 'https://example.test/meme.png' } }]
            : 'Return caption JSON.',
        },
      ],
    }),
  });
}

function env(
  geminiKeys = 'synthetic-one,synthetic-two,synthetic-three,synthetic-four,synthetic-five'
) {
  return makeTestEnv({
    GEMINI_API_KEY: geminiKeys,
    GROQ_API_KEY: 'synthetic-groq',
    NVIDIA_API_KEY: 'synthetic-nvidia',
  }).env;
}

const success = () =>
  Response.json({
    id: 'chatcmpl-synthetic',
    model: 'groq-alternate',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '{"captions":["Recovered"]}' },
        finish_reason: 'stop',
      },
    ],
  });

describe('automatic cross-provider fallback through the real SDK', () => {
  beforeEach(() => {
    mocks.registry = [
      candidate('gemini-first', 'gemini', true),
      candidate('gemini-sibling', 'gemini', true),
      candidate('groq-alternate', 'groq'),
    ];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { error: { status: 'FAILED_PRECONDITION', message: 'location is not supported' } },
    {
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'API key not valid',
        details: [{ reason: 'API_KEY_INVALID' }],
      },
    },
    { error: { status: 'INVALID_ARGUMENT', message: 'Gemini rejects this parameter' } },
    null,
  ])('recovers Gemini 400 variants through the SDK: %j', async (body) => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const sent = new Request(input, init);
      calls.push(new URL(sent.url).hostname);
      return calls.length === 1
        ? body
          ? Response.json([body], { status: 400 })
          : new Response(null, { status: 400 })
        : success();
    });
    const response = await app.fetch(request(), env('single-synthetic-key'), makeCtx());
    expect(response.status).toBe(200);
    expect(calls).toEqual(['generativelanguage.googleapis.com', 'api.groq.com']);
  });
  it('remembers Gemini RESOURCE_EXHAUSTED per-day details through array unwrapping', async () => {
    const records: unknown[] = [];
    const testEnv = env('single-synthetic-key');
    const stub = testEnv.HEALTH_DO.get(testEnv.HEALTH_DO.idFromName('global-health'));
    testEnv.HEALTH_DO = {
      ...testEnv.HEALTH_DO,
      get: () => ({
        fetch: async (url: string, init?: RequestInit) => {
          if (new URL(url).pathname === '/record') records.push(JSON.parse(String(init?.body)));
          return stub.fetch(url, init);
        },
      }),
    } as unknown as DurableObjectNamespace;
    let calls = 0;
    vi.stubGlobal('fetch', async () =>
      ++calls === 1
        ? Response.json(
            [
              {
                error: {
                  status: 'RESOURCE_EXHAUSTED',
                  details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
                },
              },
            ],
            { status: 429 }
          )
        : success()
    );
    expect((await app.fetch(request(), testEnv, makeCtx())).status).toBe(200);
    expect(calls).toBe(2);
    expect(records).toContainEqual(
      expect.objectContaining({
        key: 'gemini:gemini-first',
        exhaustedUntil: expect.any(Number),
        providerWide: false,
      })
    );
  });
  it.each(['empty', 'nonstandard-json'])('recovers a 403 with a %s error body', async (shape) => {
    const calls: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      if (calls.length === 1) {
        return shape === 'empty'
          ? new Response(null, { status: 403 })
          : Response.json({ message: 'Synthetic permission denied' }, { status: 403 });
      }
      return success();
    });
    const response = await app.fetch(request(), env('synthetic-one'), makeCtx());
    expect(response.status).toBe(200);
    expect(calls.map((sent) => new URL(sent.url).hostname)).toEqual([
      'generativelanguage.googleapis.com',
      'api.groq.com',
    ]);
    for (const sent of calls) {
      expect(await sent.json()).toMatchObject({
        max_tokens: 800,
        response_format: { type: 'json_object' },
      });
    }
    const body = await response.json();
    expect(body).toMatchObject({
      model: 'groq-alternate',
      degraded: true,
      x_gateway: { attempts: 2, provider: 'groq', model: 'groq-alternate' },
      choices: [{ message: { content: '{"captions":["Recovered"]}' } }],
    });
    const entries = vi.mocked(console.warn).mock.calls.map(([entry]) => JSON.parse(String(entry)));
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'gateway.upstream_failed',
        upstream_status: 403,
        key_slot: 1,
        key_pool_size: 1,
        key_retry_pending: false,
      })
    );
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain('synthetic-one');
    expect(logged).not.toContain('Return caption JSON');
    expect(JSON.stringify(body)).not.toContain('synthetic-');
  });

  it('recovers a gone NVIDIA model through a compatible provider within two attempts', async () => {
    mocks.registry = [candidate('nvidia-gone', 'nvidia'), candidate('groq-alternate', 'groq')];
    const calls: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return calls.length === 1 ? new Response(null, { status: 410 }) : success();
    });
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(200);
    expect(calls.map((sent) => new URL(sent.url).hostname)).toEqual([
      'integrate.api.nvidia.com',
      'api.groq.com',
    ]);
    expect(await response.json()).toMatchObject({
      model: 'groq-alternate',
      degraded: true,
      x_gateway: { attempts: 2, provider: 'groq' },
    });
  });

  it('records successful automatic key slots without logging credentials or captions', async () => {
    const accepted = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () =>
      Response.json({
        model: 'gemini-first',
        choices: [{ message: { role: 'assistant', content: '{"captions":["Private caption"]}' } }],
      })
    );
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(200);
    const entries = accepted.mock.calls
      .map(([entry]) => String(entry))
      .filter((entry) => entry.startsWith('{') && entry.includes('gateway.upstream_accepted'))
      .map((entry) => JSON.parse(entry));
    expect(entries).toContainEqual({
      event: 'gateway.upstream_accepted',
      provider: 'gemini',
      model: 'gemini-first',
      attempt: 1,
      key_slot: 1,
      key_pool_size: 5,
      colo: null,
      stream_handshake: false,
    });
    expect(JSON.stringify(entries)).not.toContain('synthetic-one');
    expect(JSON.stringify(entries)).not.toContain('Private caption');
  });

  it('does not send image requests to a text-only fallback', async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(undefined, true), env('synthetic-one'), makeCtx());
    expect(response.status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ error: { upstream_status: 403, attempts: 1 } });
  });

  it('does not fall back after an explicit safety refusal', async () => {
    const upstream = vi.fn(async () =>
      Response.json({ error: { message: 'content filter refusal' } }, { status: 403 })
    );
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(), env(), makeCtx());
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ error: { type: 'safety_refusal' } });
  });

  it('preserves the two-attempt ceiling when the alternate provider also fails', async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(), env('synthetic-one'), makeCtx());
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({ error: { upstream_status: 403, attempts: 2 } });
  });

  it('does not start a fallback when cancelled after the first 403', async () => {
    const controller = new AbortController();
    const upstream = vi.fn(async () => {
      controller.abort();
      return new Response(null, { status: 403 });
    });
    vi.stubGlobal('fetch', upstream);
    await app.fetch(request(controller.signal), env(), makeCtx());
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])('retains automatic model fallback after upstream %i', async (status) => {
    const calls: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return calls.length === 1 ? new Response(null, { status }) : success();
    });
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(200);
    expect(calls.map((sent) => new URL(sent.url).hostname)).toEqual([
      'generativelanguage.googleapis.com',
      'generativelanguage.googleapis.com',
    ]);
    expect(((await calls[1].json()) as { model: string }).model).toBe('gemini-sibling');
    expect(await response.json()).toMatchObject({
      x_gateway: { attempts: 2, model: 'gemini-sibling' },
    });
  });

  it.each([400, 403])(
    'falls back on attempt three after key recovery then upstream %i',
    async (status) => {
      const calls: Request[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Request(input, init));
        if (calls.length === 1) return new Response(null, { status: 403 });
        if (calls.length === 2) return new Response(null, { status });
        return success();
      });
      const response = await app.fetch(request(), env(), makeCtx());
      expect(response.status).toBe(200);
      expect(calls.map((sent) => new URL(sent.url).hostname)).toEqual([
        'generativelanguage.googleapis.com',
        'generativelanguage.googleapis.com',
        'api.groq.com',
      ]);
      expect(calls[0].headers.get('authorization')).not.toBe(calls[1].headers.get('authorization'));
      expect(await response.json()).toMatchObject({ x_gateway: { provider: 'groq', attempts: 3 } });
    }
  );

  it('stops after three attempts even when more providers and keys remain', async () => {
    mocks.registry.push(candidate('nvidia-third', 'nvidia'));
    const upstream = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(await response.json()).toMatchObject({ error: { upstream_status: 403, attempts: 3 } });
  });

  it('does not grant key recovery when Gemini is the second provider attempted', async () => {
    mocks.registry = [
      candidate('nvidia-first', 'nvidia'),
      candidate('gemini-second', 'gemini'),
      candidate('groq-third', 'groq'),
    ];
    const upstream = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({ error: { upstream_status: 403, attempts: 2 } });
  });

  it.each([400, 422])('skips sibling models after upstream input error %i', async (status) => {
    const calls: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return calls.length === 1 ? new Response(null, { status }) : success();
    });
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(200);
    expect(calls.map((sent) => new URL(sent.url).hostname)).toEqual([
      'generativelanguage.googleapis.com',
      'api.groq.com',
    ]);
    expect(await response.json()).toMatchObject({ x_gateway: { provider: 'groq', attempts: 2 } });
  });

  it.each([400, 422])('returns input error after both providers reject with %i', async (status) => {
    mocks.registry.push(candidate('nvidia-third', 'nvidia'));
    const upstream = vi.fn(async () =>
      Response.json({ error: { message: 'Invalid prompt format' } }, { status })
    );
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({
      error: { type: 'input_nonretriable', upstream_status: status, attempts: 2 },
    });
  });

  it('does not retry input errors when only the same provider remains', async () => {
    mocks.registry = [candidate('gemini-first', 'gemini'), candidate('gemini-sibling', 'gemini')];
    const upstream = vi.fn(async () =>
      Response.json({ error: { message: 'Invalid prompt format' } }, { status: 400 })
    );
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      error: { type: 'input_nonretriable', attempts: 1 },
    });
  });

  it.each(['x-gateway-force-model', 'x-gateway-force-provider'])(
    'keeps input errors terminal when pinned with %s',
    async (header) => {
      const upstream = vi.fn(async () =>
        Response.json({ error: { message: 'Invalid prompt format' } }, { status: 400 })
      );
      vi.stubGlobal('fetch', upstream);
      const pinnedRequest = request();
      pinnedRequest.headers.set(header, header.endsWith('model') ? 'gemini-first' : 'gemini');
      const response = await app.fetch(pinnedRequest, env(), makeCtx());
      expect(response.status).toBe(400);
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(await response.json()).toMatchObject({
        error: { type: 'input_nonretriable', upstream_status: 400, attempts: 1 },
      });
    }
  );

  it.each([false, true])(
    'recovers streaming input failure with key retry: %s',
    async (keyRetry) => {
      const calls: Request[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Request(input, init));
        if (keyRetry && calls.length === 1) return new Response(null, { status: 403 });
        if (calls.length === (keyRetry ? 2 : 1)) return new Response(null, { status: 400 });
        return new Response(
          'data: ' +
            JSON.stringify({
              model: 'groq-alternate',
              choices: [{ index: 0, delta: { content: 'Recovered' } }],
            }) +
            '\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } }
        );
      });
      const response = await app.fetch(request(undefined, false, true), env(), makeCtx());
      expect(response.status).toBe(200);
      expect(response.headers.get('x-gateway-attempts')).toBe(keyRetry ? '3' : '2');
      expect(response.headers.get('x-gateway-model')).toBe('groq-alternate');
      expect(await response.text()).toContain('Recovered');
      expect(new URL(calls.at(-1)?.url ?? '').hostname).toBe('api.groq.com');
      expect(calls).toHaveLength(keyRetry ? 3 : 2);
    }
  );

  it('recovers an automatic streaming handshake with a distinct key', async () => {
    const auth: Array<string | null> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      auth.push(new Request(input, init).headers.get('authorization'));
      if (auth.length === 1) return new Response(null, { status: 403 });
      return new Response(
        'data: ' +
          JSON.stringify({
            model: 'gemini-first',
            choices: [{ index: 0, delta: { content: 'Recovered' } }],
          }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    const response = await app.fetch(request(undefined, false, true), env(), makeCtx());
    expect(response.status).toBe(200);
    expect(response.headers.get('x-gateway-attempts')).toBe('2');
    expect(response.headers.get('x-gateway-model')).toBe('gemini-first');
    expect(await response.text()).toContain('Recovered');
    expect(auth).toHaveLength(2);
    expect(auth[0]).not.toBe(auth[1]);
  });
});
