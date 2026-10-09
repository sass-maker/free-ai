import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { geminiFetch } from '../src/providers/gemini';
import type { ModelCandidate } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({ registry: [] as ModelCandidate[] }));
vi.mock('../src/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getModelRegistry: () => mocks.registry,
}));

function candidate(model: string, provider: 'gemini' | 'groq', priority: number): ModelCandidate {
  return {
    id: model,
    model,
    provider,
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32000,
      maxOutputTokens: 4096,
    },
  };
}

// Gemini's OpenAI-compatible endpoint wraps errors in a one-element array.
function geminiError(code: number, status: string, message: string, reason?: string): Response {
  const details = reason
    ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }]
    : undefined;
  return Response.json([{ error: { code, message, status, ...(details && { details }) } }], {
    status: code,
  });
}

function completion(model: string, content: string): Response {
  return Response.json({
    model,
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
}

interface Harness {
  calls: Request[];
  healthRecords: unknown[];
  logs: string[];
  send: () => Response | Promise<Response>;
}

function harness(
  gemini: (sent: Request) => Response,
  geminiKeys = 'synthetic-1,synthetic-2'
): Harness {
  mocks.registry = [candidate('gemini-first', 'gemini', 1), candidate('groq-second', 'groq', 0.9)];
  const calls: Request[] = [];
  const healthRecords: unknown[] = [];
  const logs: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((entry) => logs.push(String(entry)));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const sent = new Request(input, init);
    calls.push(sent);
    if (new URL(sent.url).hostname === 'api.groq.com') return completion('groq-second', '{"ok":1}');
    return gemini(sent);
  });
  const { env } = makeTestEnv({ GEMINI_API_KEY: geminiKeys, GROQ_API_KEY: 'synthetic-groq' });
  const healthDo = env.HEALTH_DO as unknown as { get: (id: unknown) => { fetch: typeof fetch } };
  const originalGet = healthDo.get;
  healthDo.get = (id) => {
    const stub = originalGet(id);
    return {
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        if (new URL(String(url instanceof Request ? url.url : url)).pathname === '/record') {
          healthRecords.push(JSON.parse(String(init?.body ?? '{}')));
        }
        return stub.fetch(url, init);
      },
    };
  };
  const send = () =>
    app.fetch(
      new Request('https://gateway.test/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer test-gateway-key', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'auto',
          project_id: 'open-historia',
          max_tokens: 256,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You output JSON.' },
            { role: 'user', content: 'Private synthetic campaign prompt' },
          ],
        }),
      }),
      env,
      makeCtx()
    );
  return { calls, healthRecords, logs, send };
}

const hosts = (calls: Request[]) => calls.map((sent) => new URL(sent.url).hostname);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('geminiFetch', () => {
  it('unwraps array error bodies and leaves successes untouched', async () => {
    vi.stubGlobal('fetch', async () =>
      geminiError(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.')
    );
    const failed = await geminiFetch('https://generativelanguage.googleapis.com/x');
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'Request contains an invalid argument.',
      },
    });

    vi.stubGlobal('fetch', async () => new Response('upstream text', { status: 502 }));
    expect(await (await geminiFetch('https://generativelanguage.googleapis.com/x')).text()).toBe(
      'upstream text'
    );

    vi.stubGlobal('fetch', async () => Response.json([{ id: 'ok' }]));
    expect(await (await geminiFetch('https://generativelanguage.googleapis.com/x')).json()).toEqual(
      [{ id: 'ok' }]
    );
  });
});

describe('Gemini upstream 400 handling', () => {
  it('falls back to another provider when Gemini rejects the egress location', async () => {
    const h = harness(() =>
      geminiError(400, 'FAILED_PRECONDITION', 'User location is not supported for the API use.')
    );
    const response = await h.send();
    expect(response.status).toBe(200);
    // One Gemini attempt only: another key cannot fix a colo-bound rejection.
    expect(hosts(h.calls)).toEqual(['generativelanguage.googleapis.com', 'api.groq.com']);
    const body = (await response.json()) as { x_gateway: { provider: string; attempts: number } };
    expect(body.x_gateway).toMatchObject({ provider: 'groq', attempts: 2 });
    expect(h.healthRecords).not.toContainEqual(expect.objectContaining({ success: false }));
    const entry = JSON.parse(h.logs.find((line) => line.includes('upstream_failed')) ?? '{}');
    expect(entry).toMatchObject({
      upstream_status: 400,
      upstream_error_status: 'FAILED_PRECONDITION',
      upstream_error_reason: 'unsupported_location',
      failure_class: 'provider_fatal',
    });
    expect(h.logs.join('')).not.toContain('User location');
    expect(h.logs.join('')).not.toContain('Private synthetic');
  });

  it('retries another key when Gemini reports a rejected API key as 400', async () => {
    const h = harness((sent) =>
      sent.headers.get('authorization') === 'Bearer synthetic-1'
        ? geminiError(
            400,
            'INVALID_ARGUMENT',
            'API key expired. Please renew the API key.',
            'API_KEY_INVALID'
          )
        : completion('gemini-first', '{"ok":1}')
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const response = await h.send();
    expect(response.status).toBe(200);
    expect(hosts(h.calls)).toEqual([
      'generativelanguage.googleapis.com',
      'generativelanguage.googleapis.com',
    ]);
    expect(h.calls[0].headers.get('authorization')).not.toBe(
      h.calls[1].headers.get('authorization')
    );
    expect(h.logs.join('')).toContain('"upstream_error_reason":"api_key_rejected"');
    expect(h.logs.join('')).not.toContain('synthetic-1');
  });

  it('falls back from input 400s without recording failed model health', async () => {
    const h = harness(() =>
      geminiError(400, 'INVALID_ARGUMENT', 'Requests ending with a model turn are not supported.')
    );
    const response = await h.send();
    expect(response.status).toBe(200);
    expect(hosts(h.calls)).toEqual(['generativelanguage.googleapis.com', 'api.groq.com']);
    expect(await response.json()).toMatchObject({ x_gateway: { provider: 'groq', attempts: 2 } });
    expect(h.healthRecords).not.toContainEqual(expect.objectContaining({ success: false }));
    expect(h.logs.join('')).not.toContain('Requests ending');
    expect(h.logs.join('')).toContain('"upstream_error_status":"INVALID_ARGUMENT"');
  });
});
