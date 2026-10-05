import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { ModelCandidate } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({ registry: [] as ModelCandidate[] }));
vi.mock('../src/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getModelRegistry: () => mocks.registry,
}));

function candidate(model: string, provider: 'gemini' | 'groq', vision = false): ModelCandidate {
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

function request(signal?: AbortSignal, vision = false) {
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
      stream: false,
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

function env() {
  return makeTestEnv({
    GEMINI_API_KEY: 'synthetic-one,synthetic-two,synthetic-three,synthetic-four,synthetic-five',
    GROQ_API_KEY: 'synthetic-groq',
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
    const response = await app.fetch(request(), env(), makeCtx());
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
        key_pool_size: 5,
        key_retry_pending: false,
      })
    );
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain('synthetic-one');
    expect(logged).not.toContain('Return caption JSON');
    expect(JSON.stringify(body)).not.toContain('synthetic-');
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
      stream_handshake: false,
    });
    expect(JSON.stringify(entries)).not.toContain('synthetic-one');
    expect(JSON.stringify(entries)).not.toContain('Private caption');
  });

  it('does not send image requests to a text-only fallback', async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(undefined, true), env(), makeCtx());
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
    const response = await app.fetch(request(), env(), makeCtx());
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
});
