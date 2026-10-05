import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { deriveRequiredCapabilities, selectCandidates } from '../src/router/select-model';
import { logUpstreamFailure } from '../src/router/gemini-key-recovery';
import type { ModelCandidate, ResponseFormat } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({ registry: [] as ModelCandidate[] }));
vi.mock('../src/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getModelRegistry: () => mocks.registry,
}));
const format: ResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'classifier',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['results'],
      properties: {
        results: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
      },
    },
  },
};
function candidate(provider: 'gemini' | 'groq', model: string): ModelCandidate {
  return {
    id: model,
    model,
    provider,
    reasoning: 'low',
    enabled: true,
    priority: 1,
    supportsStreaming: true,
    capabilities: {
      jsonMode: true,
      toolCalling: false,
      vision: false,
      contextWindow: 32000,
      maxOutputTokens: 4096,
    },
  };
}
function request(extra: Record<string, unknown> = {}) {
  return new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer test-gateway-key', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'auto',
      project_id: 'schema-regression',
      max_tokens: 2000,
      response_format: format,
      messages: [{ role: 'user', content: 'Return classifier JSON.' }],
      ...extra,
    }),
  });
}
const success = () =>
  Response.json({
    choices: [
      { message: { role: 'assistant', content: '{"results":[[1]]}' }, finish_reason: 'stop' },
    ],
  });
const env = () =>
  makeTestEnv({ GEMINI_API_KEY: 'synthetic-key', GROQ_API_KEY: 'synthetic-key' }).env;

describe('automatic schema output', () => {
  beforeEach(() => {
    mocks.registry = [
      candidate('groq', 'llama-3.3-70b-versatile'),
      candidate('gemini', 'gemini-3.5-flash-lite'),
      candidate('groq', 'openai/gpt-oss-120b'),
    ];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('excludes JSON-only models but preserves automatic ordering among schema models', () => {
    const caps = deriveRequiredCapabilities({ response_format: format });
    expect(caps.jsonMode).toBe(true);
    expect(caps.jsonSchema).toBe(true);
    const selected = selectCandidates(mocks.registry, new Map(), {
      now: Date.now(),
      stream: false,
      requiredCapabilities: caps,
    });
    expect(selected.map((c) => c.model)).toEqual(['gemini-3.5-flash-lite', 'openai/gpt-oss-120b']);
    expect(
      deriveRequiredCapabilities({ response_format: { type: 'json_object' } }).jsonSchema
    ).toBeUndefined();
  });

  it('forwards the complete schema through the real SDK and recovers a Gemini usage failure automatically', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1)
        return Response.json({ error: { message: 'Unavailable' } }, { status: 503 });
      return success();
    });
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(200);
    expect(bodies.map((b) => b.model)).toEqual(['gemini-3.5-flash-lite', 'openai/gpt-oss-120b']);
    for (const body of bodies) {
      expect(body.response_format).toEqual(format);
      expect(body.max_tokens).toBe(2000);
    }
    expect(await response.json()).toMatchObject({ x_gateway: { attempts: 2, provider: 'groq' } });
  });

  it('falls back from generated JSON validation within two attempts but never retries caller errors', async () => {
    mocks.registry = [
      candidate('groq', 'openai/gpt-oss-120b'),
      candidate('groq', 'openai/gpt-oss-20b'),
    ];
    let calls = 0;
    const fetcher = vi.fn(async () =>
      ++calls === 1
        ? Response.json(
            { error: { code: 'json_validate_failed', message: 'Invalid generated JSON' } },
            { status: 400 }
          )
        : success()
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await app.fetch(request(), env(), makeCtx());
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher
      .mockReset()
      .mockImplementation(async () =>
        Response.json(
          { error: { code: 'invalid_request_error', message: 'Invalid request' } },
          { status: 400 }
        )
      );
    const invalid = await app.fetch(request(), env(), makeCtx());
    expect(invalid.status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { stream: true },
    { tools: [{ type: 'function', function: { name: 'tool' } }] },
    { response_format: { type: 'json_schema' } },
    { response_format: { ...format, json_schema: { ...format.json_schema, strict: false } } },
  ])('rejects unsupported schema combinations before spending tokens: %j', async (extra) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect((await app.fetch(request(extra), env(), makeCtx())).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('logs SDK timeout separately from quota without logging error messages', () => {
    logUpstreamFailure(
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        attempt: 1,
        key_slot: 1,
        key_pool_size: 5,
      },
      new OpenAI.APIConnectionTimeoutError(),
      false
    );
    const logs = vi.mocked(console.warn).mock.calls.map(([entry]) => JSON.parse(String(entry)));
    expect(logs).toContainEqual(
      expect.objectContaining({ upstream_failure_kind: 'timeout', upstream_status: null })
    );
    expect(JSON.stringify(logs)).not.toContain('Request timed out');
  });
});
