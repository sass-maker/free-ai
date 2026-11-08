import { afterEach, describe, expect, it, vi } from 'vitest';

import { getModelRegistry } from '../src/config';
import app from '../src/index';
import { callOpenAI } from '../src/providers/openai';
import { dailyQuotaReset } from '../src/router/classify-error';
import { selectCandidates } from '../src/router/select-model';
import { makeCtx, makeTestEnv } from './helpers/env';

vi.mock('../src/lib/telemetry', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  capture: vi.fn(),
  captureError: vi.fn(),
  flushPostHog: vi.fn(),
}));

function environment(key?: string) {
  return { ...makeTestEnv().env, OPENAI_API_KEY: key };
}

const input = {
  provider: 'openai' as const,
  model: 'gpt-6-luna',
  messages: [{ role: 'user' as const, content: 'Reply OK.' }],
  max_tokens: 128,
  temperature: 0.2,
  reasoning_effort: 'low' as const,
  stream: false,
};

function chatRequest(model: string, stream = false, authorization = 'Bearer test-gateway-key') {
  return new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, model, stream, project_id: 'openai-test' }),
  });
}

function mockUpstream(stream = false) {
  const upstream = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (stream) {
      return new Response(
        'data: {"id":"chatcmpl-test","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\n' +
          'data: {"id":"chatcmpl-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      );
    }
    return Response.json({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: JSON.parse(String(init?.body)).model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    });
  });
  vi.stubGlobal('fetch', upstream);
  return upstream;
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI provider', () => {
  it('requires a provider key', async () => {
    expect(
      getModelRegistry(environment()).some((candidate) => candidate.provider === 'openai')
    ).toBe(false);
    await expect(callOpenAI({ ...input, env: environment() })).rejects.toThrow(
      'OPENAI_API_KEY is not configured'
    );
  });

  it('includes configured OpenAI models in automatic routing', () => {
    const registry = getModelRegistry(environment('synthetic-openai-key'));
    const selected = selectCandidates(registry, new Map(), { now: Date.now(), stream: false });
    expect(
      selected
        .filter((candidate) => candidate.provider === 'openai')
        .map((candidate) => candidate.model)
        .sort()
    ).toEqual(['gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol']);
  });

  it.each(['gpt-6.1-sol', 'openai-gpt-6-luna'])(
    'routes explicit %s through the SDK and returns its completion',
    async (model) => {
      const upstream = mockUpstream();
      const response = await app.fetch(
        chatRequest(model),
        environment('synthetic-openai-key'),
        makeCtx()
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        choices: [{ message: { content: 'OK' } }],
        x_gateway: { provider: 'openai' },
      });
      expect(upstream).toHaveBeenCalledTimes(1);
      const [url, init] = upstream.mock.calls[0];
      expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-openai-key');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ max_completion_tokens: 128, reasoning_effort: 'low' });
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('temperature');
    }
  );

  it('streams content through the gateway with the same OpenAI parameter mapping', async () => {
    const upstream = mockUpstream(true);
    const response = await app.fetch(
      chatRequest('gpt-6-luna', true),
      environment('synthetic-openai-key'),
      makeCtx()
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"content":"OK"');
    expect(text).toContain('[DONE]');
    const body = JSON.parse(String(upstream.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      stream: true,
      max_completion_tokens: 128,
      reasoning_effort: 'low',
    });
    expect(body).not.toHaveProperty('temperature');
  });

  it('serves auto requests with OpenAI when it is the configured provider', async () => {
    const upstream = mockUpstream();
    const env = environment('synthetic-openai-key');
    const models = getModelRegistry(env).filter((candidate) => candidate.provider === 'openai');
    const response = await app.fetch(
      chatRequest('auto'),
      { ...env, MODEL_REGISTRY_JSON: JSON.stringify(models) },
      makeCtx()
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ x_gateway: { provider: 'openai' } });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('does not contact OpenAI for unauthorized requests', async () => {
    const upstream = mockUpstream();
    const response = await app.fetch(
      chatRequest('gpt-6-luna', false, 'Bearer wrong'),
      environment('synthetic-openai-key'),
      makeCtx()
    );
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('falls back to another provider after one exhausted-credit response', async () => {
    const upstream = vi.fn(async (url: unknown) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        return Response.json(
          {
            error: {
              message: 'No prepaid credits remain.',
              type: 'insufficient_quota',
              code: 'credit_balance_exhausted',
            },
          },
          { status: 429 }
        );
      }
      return Response.json({
        id: 'fallback',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Fallback OK' },
            finish_reason: 'stop',
          },
        ],
      });
    });
    vi.stubGlobal('fetch', upstream);
    const env = environment('synthetic-openai-key');
    const models = getModelRegistry(env)
      .filter(
        (candidate) => candidate.provider === 'openai' || candidate.provider === 'pollinations'
      )
      .map((candidate) => ({
        ...candidate,
        reasoning: 'medium',
        priority: candidate.provider === 'openai' ? 1 : 0,
      }));
    const response = await app.fetch(
      chatRequest('auto'),
      { ...env, MODEL_REGISTRY_JSON: JSON.stringify(models) },
      makeCtx()
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ x_gateway: { provider: 'pollinations' } });
    expect(
      upstream.mock.calls.filter(([url]) => String(url).startsWith('https://api.openai.com/'))
    ).toHaveLength(1);
    expect(
      dailyQuotaReset({ status: 429, code: 'credit_balance_exhausted' }, 'openai', 1000)
    ).toEqual({ until: 3601000, providerWide: true });
    expect(
      dailyQuotaReset({ status: 429, code: 'rate_limit_exceeded' }, 'openai', 1000)
    ).toBeUndefined();
  });

  it('filters tool calls and supports schema output when explicitly selected', () => {
    const registry = getModelRegistry(environment('synthetic-openai-key'));
    const options = { now: Date.now(), stream: false, modelOverride: 'gpt-6-luna' };
    expect(
      selectCandidates(registry, new Map(), {
        ...options,
        requiredCapabilities: { toolCalling: true },
      })
    ).toEqual([]);
    expect(
      selectCandidates(registry, new Map(), {
        ...options,
        requiredCapabilities: { jsonSchema: true },
      })
    ).toHaveLength(1);
  });
});
