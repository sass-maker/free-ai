import { readFileSync } from 'node:fs';
import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { runOpenAICompatibleRequest } from '../src/providers/openai-compatible';
import { makeCtx, makeTestEnv } from './helpers/env';

vi.mock('../src/lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/telemetry')>()),
  capture: vi.fn(),
  configurePostHog: vi.fn(),
  flushPostHog: vi.fn(),
}));

const gettingStarted = readFileSync('site/src/content/docs/getting-started.mdx', 'utf8');
const sdkCall = gettingStarted.match(
  /const completion = await client\.chat\.completions\.create\([\s\S]*?\n\}\);/
)?.[0];
const curlBody = gettingStarted.match(/-d '(\{[\s\S]*?\})'/)?.[1];

afterEach(() => vi.unstubAllGlobals());

describe('published quickstart contract', () => {
  it.each([false, true])(
    'makes one upstream request per chat attempt (stream=%s)',
    async (stream) => {
      const upstream = vi.fn(async () =>
        Response.json({ error: { message: 'Unavailable' } }, { status: 503 })
      );
      vi.stubGlobal('fetch', upstream);
      const { env } = makeTestEnv();
      await expect(
        runOpenAICompatibleRequest(
          {
            env,
            provider: 'groq',
            model: 'synthetic-model',
            stream,
            messages: [{ role: 'user', content: 'Synthetic retry limit test' }],
          },
          { provider: 'groq', baseURL: 'https://provider.test/v1', apiKey: 'synthetic-key' }
        )
      ).rejects.toMatchObject({ status: 503 });
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  );
  it('moves to the next gateway model after a real SDK timeout without hidden retries', async () => {
    const models: string[] = [];
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = (await new Request(input, init).json()) as { model: string };
      models.push(body.model);
      if (models.length === 1) throw new DOMException('The operation was aborted', 'AbortError');
      return Response.json({
        id: 'chatcmpl-recovered',
        object: 'chat.completion',
        created: 1,
        model: body.model,
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Recovered' }, finish_reason: 'stop' },
        ],
      });
    });
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GROQ_API_KEY: 'synthetic-provider-key' });
    const response = await app.fetch(
      new Request('https://gateway.test/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-gateway-key',
          'content-type': 'application/json',
          'x-gateway-force-provider': 'groq',
        },
        body: JSON.stringify({
          model: 'auto',
          project_id: 'sdk-timeout-test',
          messages: [{ role: 'user', content: 'Synthetic timeout test' }],
        }),
      }),
      env,
      makeCtx()
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ degraded: true, x_gateway: { attempts: 2 } });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(models[1]).not.toBe(models[0]);
  });
  it('runs the documented JavaScript SDK request through auth, routing and actual provider adapter', async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe('https://api.groq.com/openai/v1/chat/completions');
      const body = (await request.json()) as Record<string, unknown>;
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello! What can you do?' }]);
      expect(body.project_id).toBeUndefined();
      return Response.json({
        id: 'chatcmpl-fixture',
        object: 'chat.completion',
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Synthetic provider response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      });
    });
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GROQ_API_KEY: 'synthetic-provider-key' });
    const client = new OpenAI({
      apiKey: 'test-gateway-key',
      baseURL: 'https://gateway.test/v1',
      maxRetries: 0,
      fetch: async (input, init) => app.fetch(new Request(input, init), env, makeCtx()),
    });
    expect(sdkCall).toBeTruthy();
    const run = new Function('client', `return (async () => { ${sdkCall}; return completion; })()`);
    const completion = await run(client);
    expect(completion.choices[0].message.content).toBe('Synthetic provider response');
    expect(completion.x_gateway.provider).toBe('groq');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable for a valid documented request when the requested provider is not configured', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv();
    expect(curlBody).toBeTruthy();
    const response = await app.fetch(
      new Request('https://gateway.test/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-gateway-key',
          'content-type': 'application/json',
          'x-gateway-force-provider': 'groq',
        },
        body: curlBody,
      }),
      env,
      makeCtx()
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { type: 'configuration_error' } });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated copied request before any provider call', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const { env } = makeTestEnv({ GROQ_API_KEY: 'synthetic-provider-key' });
    const response = await app.fetch(
      new Request('https://gateway.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: curlBody,
      }),
      env,
      makeCtx()
    );
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
