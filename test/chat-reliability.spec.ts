import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import type { ModelCandidate } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({ registry: [] as ModelCandidate[], call: vi.fn() }));

vi.mock('../src/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getModelRegistry: () => mocks.registry,
}));

vi.mock('../src/providers', async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    providerCallers: {
      ...(actual.providerCallers as object),
      groq: mocks.call,
      cohere: mocks.call,
      workers_ai: mocks.call,
    },
  };
});

function candidate(
  model: string,
  provider: 'groq' | 'cohere' | 'workers_ai' = 'groq',
  overrides: Partial<ModelCandidate> = {}
): ModelCandidate {
  return {
    id: model,
    model,
    provider,
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 1,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32000,
      maxOutputTokens: 4096,
    },
    ...overrides,
  };
}

function chatRequest(body: Record<string, unknown> = {}) {
  return new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-gateway-key',
    },
    body: JSON.stringify({
      model: 'auto',
      project_id: 'reliability-test',
      messages: [{ role: 'user', content: 'hello' }],
      ...body,
    }),
  });
}

function okCompletion(provider: string, model: string) {
  return {
    provider,
    model,
    stream: false,
    completion: {
      id: 'chatcmpl-ok',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: `ok from ${model}` },
          finish_reason: 'stop',
        },
      ],
    },
  };
}

function streamResult(provider: string, model: string, token: string) {
  return {
    provider,
    model,
    stream: true,
    streamSource: (async function* () {
      yield {
        id: 'chatcmpl-stream',
        choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
      };
    })(),
  };
}

describe('chat provider reliability contract', () => {
  beforeEach(() => {
    mocks.call.mockReset();
    mocks.call.mockImplementation(async ({ provider, model }) => okCompletion(provider, model));
  });

  it('falls back to the next candidate when a provider resolves malformed output', async () => {
    mocks.registry = [candidate('malformed-a'), candidate('healthy-b')];
    mocks.call.mockReset();
    mocks.call
      .mockResolvedValueOnce({
        provider: 'groq',
        model: 'malformed-a',
        stream: false,
        completion: {},
      })
      .mockResolvedValueOnce(okCompletion('groq', 'healthy-b'));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const res = await app.fetch(chatRequest(), env, makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      degraded: boolean;
      choices: Array<{ message: { content: string } }>;
      x_gateway: { attempts: number; model: string };
    };
    expect(body.x_gateway.attempts).toBe(2);
    expect(body.x_gateway.model).toBe('healthy-b');
    expect(body.degraded).toBe(true);
    expect(body.choices[0].message.content).toBe('ok from healthy-b');
  });

  it.each([
    ['empty choices array', { choices: [] }],
    ['non-object body', 'upstream returned html'],
    ['empty choice', { choices: [{}] }],
    ['null choice', { choices: [null] }],
    ['missing message content', { choices: [{ message: { role: 'assistant' } }] }],
    ['numeric content', { choices: [{ message: { content: 42 } }] }],
    ['invalid tool call', { choices: [{ message: { tool_calls: [{}] } }] }],
  ])('does not return a synthetic 200 when the completion is %s', async (_label, completion) => {
    mocks.registry = [candidate('malformed-a'), candidate('malformed-b')];
    mocks.call.mockReset();
    mocks.call.mockImplementation(async ({ provider, model }) => ({
      provider,
      model,
      stream: false,
      completion,
    }));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const res = await app.fetch(chatRequest(), env, makeCtx());

    expect(res.status).toBe(502);
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['text', { message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
    [
      'tool call',
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    [
      'explicit refusal',
      {
        message: { role: 'assistant', content: null, refusal: 'Cannot comply' },
        finish_reason: 'stop',
      },
    ],
    [
      'content filter',
      { message: { role: 'assistant', content: null }, finish_reason: 'content_filter' },
    ],
  ])('preserves an id-less %s completion without fallback', async (_label, choice) => {
    mocks.registry = [candidate('valid-a'), candidate('never-tried')];
    mocks.call.mockResolvedValueOnce({
      provider: 'groq',
      model: 'valid-a',
      stream: false,
      completion: { choices: [{ index: 0, ...choice }] },
    });
    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const res = await app.fetch(chatRequest(), env, makeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices: unknown[]; x_gateway: { attempts: number } };
    expect(body.choices).toEqual([{ index: 0, ...choice }]);
    expect(body.x_gateway.attempts).toBe(1);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });

  it('falls back when the upstream body cannot be parsed (SyntaxError)', async () => {
    mocks.registry = [candidate('unparseable'), candidate('healthy-b')];
    mocks.call.mockReset();
    mocks.call
      .mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON'))
      .mockResolvedValueOnce(okCompletion('groq', 'healthy-b'));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const res = await app.fetch(chatRequest(), env, makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { x_gateway: { attempts: number; model: string } };
    expect(body.x_gateway.attempts).toBe(2);
    expect(body.x_gateway.model).toBe('healthy-b');
  });

  it('returns a degraded stream when the first candidate fails before streaming starts', async () => {
    mocks.registry = [candidate('flaky-stream'), candidate('steady-stream')];
    mocks.call.mockReset();
    mocks.call
      .mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 500 }))
      .mockResolvedValueOnce(streamResult('groq', 'steady-stream', 'streamed-ok'));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const res = await app.fetch(chatRequest({ stream: true }), env, makeCtx());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-gateway-attempts')).toBe('2');
    expect(res.headers.get('x-degraded-mode')).toBe('true');

    const body = await res.text();
    expect(body).toContain('streamed-ok');
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('does not spend a second attempt after the caller aborts the request', async () => {
    mocks.registry = [candidate('aborted'), candidate('never-tried')];
    mocks.call.mockReset();
    mocks.call.mockRejectedValue(new OpenAI.APIUserAbortError());

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const res = await app.fetch(chatRequest(), env, makeCtx());

    expect(res.status).toBe(502);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.call.mock.calls[0][0].model).toBe('aborted');
  });

  it('does not start provider work for an already cancelled request', async () => {
    mocks.registry = [candidate('never-tried')];
    const request = new Request(chatRequest(), { signal: AbortSignal.abort() });
    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const response = await app.fetch(request, env, makeCtx());
    expect(response.ok).toBe(false);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('does not spend a fallback attempt when cancelled during retry backoff', async () => {
    mocks.registry = [candidate('failed-a'), candidate('never-tried')];
    const controller = new AbortController();
    mocks.call.mockImplementationOnce(async () => {
      setTimeout(() => controller.abort(), 10);
      throw Object.assign(new Error('server error'), { status: 503 });
    });
    const request = new Request(chatRequest(), { signal: controller.signal });
    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const response = await app.fetch(request, env, makeCtx());
    expect(response.ok).toBe(false);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });

  it('only spends fallback attempts on capability-matching candidates', async () => {
    const plainText = candidate('plain-text', 'groq');
    plainText.capabilities.toolCalling = false;
    mocks.registry = [candidate('tools-a'), candidate('tools-b', 'cohere'), plainText];

    mocks.call.mockReset();
    mocks.call
      .mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 500 }))
      .mockImplementation(async ({ provider, model }) => okCompletion(provider, model));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    const res = await app.fetch(
      chatRequest({
        tools: [
          {
            type: 'function',
            function: { name: 'lookup', parameters: { type: 'object', properties: {} } },
          },
        ],
      }),
      env,
      makeCtx()
    );

    expect(res.status).toBe(200);
    const attempted = mocks.call.mock.calls.map(([input]) => input.model);
    expect(attempted).toEqual(['tools-a', 'tools-b']);
    expect(attempted).not.toContain('plain-text');
  });

  it('rejects with 429 and never calls a provider when the IP budget is exhausted', async () => {
    mocks.registry = [candidate('any-model')];
    const { env } = makeTestEnv({ GROQ_API_KEY: 'g', rateLimitDeny: true });

    const res = await app.fetch(chatRequest(), env, makeCtx());

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('correlates a consumer request with provider outcome, attempts and project id', async () => {
    mocks.registry = [candidate('bad-output'), candidate('good-output', 'cohere')];
    mocks.call.mockReset();
    mocks.call
      .mockResolvedValueOnce({
        provider: 'groq',
        model: 'bad-output',
        stream: false,
        completion: {},
      })
      .mockResolvedValueOnce(okCompletion('cohere', 'good-output'));

    const run = vi.fn(async () => ({ success: true }));
    const binds: unknown[][] = [];
    const { env } = makeTestEnv({ GROQ_API_KEY: 'g' });
    env.GATEWAY_DB.prepare = vi.fn((_sql: string) => {
      const statement = {
        bind: vi.fn((...args: unknown[]) => {
          binds.push(args);
          return statement;
        }),
        run,
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
      };
      return statement;
    }) as unknown as D1Database['prepare'];

    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(Promise.resolve(promise));
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const res = await app.fetch(chatRequest(), env, ctx);
    await Promise.all(pending);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      x_gateway: {
        provider: string;
        model: string;
        attempts: number;
        request_id: string;
        project_id: string;
      };
    };
    expect(body.x_gateway).toMatchObject({
      provider: 'cohere',
      model: 'good-output',
      attempts: 2,
      project_id: 'reliability-test',
    });
    expect(body.x_gateway.request_id).toBeTruthy();

    const ledgerArgs = binds.find((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes(':failed>'))
    );
    expect(ledgerArgs).toBeTruthy();
    expect(ledgerArgs).toEqual(
      expect.arrayContaining(['groq/bad-output:failed>cohere/good-output:ok'])
    );
    expect(JSON.stringify(ledgerArgs)).not.toContain('hello');
  });
});
