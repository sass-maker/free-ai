import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { ModelCandidate } from '../src/types';
import { fetchFleetRequest } from '../src/fleet-gateway';
import { makeCtx, makeTestEnv } from './helpers/env';
import contract from '../fixtures/decision-gateway-contract.json';

const mocks = vi.hoisted(() => ({ registry: [] as ModelCandidate[], call: vi.fn() }));
vi.mock('../src/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getModelRegistry: () => mocks.registry,
}));
vi.mock('../src/providers', async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    providerCallers: { ...(actual.providerCallers as object), groq: mocks.call },
  };
});

const questions = [
  { id: 'tool', type: 'choice', prompt: 'Which tool fits?', options: ['a', 'b'] },
  { id: 'fit', type: 'score', prompt: 'Fit score', min: 0, max: 10 },
  { id: 'need', type: 'bool', prompt: 'Is the gap proven?' },
];
const answers = [
  { id: 'tool', status: 'answered', value: 'a', reason: 'Supports the supplied need.' },
  { id: 'fit', status: 'answered', value: 8, reason: 'Matches supplied requirements.' },
  { id: 'need', status: 'abstained', value: null, reason: 'Insufficient evidence.' },
];
function request(
  extra: Record<string, unknown> = {},
  compare = false,
  headers: Record<string, string> = {},
  signal?: AbortSignal
) {
  return new Request(`https://gateway.test/v1/${compare ? 'compare' : 'decide'}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-gateway-key',
      ...headers,
    },
    signal,
    body: JSON.stringify({
      project_id: 'starboard',
      state: { need: 'cache', nested: { b: 2, a: 1 } },
      questions,
      ...extra,
    }),
  });
}
function completion(content = JSON.stringify({ answers }), model = 'free-a') {
  return {
    provider: 'groq',
    model,
    stream: false,
    completion: {
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    },
  };
}
async function run(req = request()) {
  const { env } = makeTestEnv({ GROQ_API_KEY: 'test' });
  const response = await app.fetch(req, env, makeCtx());
  return { response, body: (await response.json()) as Record<string, any> };
}

describe('typed decision routes', () => {
  beforeEach(() => {
    mocks.registry = ['free-a', 'free-b'].map((model) => ({
      id: model,
      model,
      provider: 'groq',
      reasoning: 'medium',
      supportsStreaming: true,
      enabled: true,
      priority: 1,
      capabilities: {
        jsonMode: true,
        toolCalling: true,
        vision: false,
        contextWindow: 32000,
        maxOutputTokens: 4096,
      },
    }));
    mocks.call.mockReset().mockImplementation(async ({ model }) => completion(undefined, model));
  });

  it('publishes both endpoints in the existing OpenAPI document', async () => {
    const { env } = makeTestEnv();
    const response = await app.fetch(
      new Request('https://gateway.test/openapi.json'),
      env,
      makeCtx()
    );
    const body = (await response.json()) as { paths: Record<string, unknown> };
    expect(body.paths['/v1/decide']).toBeDefined();
    expect(body.paths['/v1/compare']).toBeDefined();
  });

  it('uses real authenticated routing with attribution, typed answers and abstention', async () => {
    const { response, body } = await run();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'ok',
      engine: 'free_ai',
      requested_model: 'auto',
      model: 'free-a',
      provider: 'groq',
      project_id: 'starboard',
      answers,
      usage: { total_tokens: 30 },
    });
    expect(body.input_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.call).toHaveBeenCalledOnce();
    expect(mocks.call.mock.calls[0][0]).toMatchObject({
      stream: false,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    });
  });

  it('compares identical frozen inputs and reports disabled Jev without a call', async () => {
    const { body } = await run(
      request({ engines: [{ engine: 'free_ai' }, { engine: 'jev' }] }, true)
    );
    expect(body.results[0]).toMatchObject({
      status: 'ok',
      engine: 'free_ai',
      input_hash: body.input_hash,
    });
    expect(body.results[1]).toMatchObject({
      status: 'unavailable',
      engine: 'jev',
      requested_model: 'typesafe/jev',
      input_hash: body.input_hash,
      model: null,
      provider: null,
      answers: [],
      error: { code: 'provider_disabled' },
    });
    expect(mocks.call).toHaveBeenCalledOnce();
  });

  it.each([
    { request: contract.request, hash: contract.input_hash },
    { request: contract.numeric_request, hash: contract.numeric_input_hash },
  ])('accepts the same Knowledgebase HTTP fixture and canonical hash', async (fixture) => {
    mocks.call.mockResolvedValue(completion(JSON.stringify({ answers: contract.answers })));
    const { body } = await run(request(fixture.request, true));
    expect(body.input_hash).toBe(fixture.hash);
    expect(body.project_id).toBe('knowledge-base');
    expect(body.results[0]).toMatchObject({
      status: 'ok',
      input_hash: fixture.hash,
      answers: contract.answers,
    });
    expect(body.results[1]).toMatchObject({
      status: 'unavailable',
      engine: 'jev',
      input_hash: fixture.hash,
      error: { code: 'provider_disabled' },
    });
    expect(JSON.parse(mocks.call.mock.calls[0][0].messages[1].content)).toEqual({
      state: fixture.request.state,
      questions: fixture.request.questions,
    });
    expect(mocks.call).toHaveBeenCalledOnce();
  });

  it('compares two registered models with the same frozen message and hash', async () => {
    const { body } = await run(
      request(
        {
          engines: [
            { engine: 'free_ai', model: 'free-a' },
            { engine: 'free_ai', model: 'free-b' },
          ],
        },
        true
      )
    );
    expect(body.results.map((r: Record<string, unknown>) => r.input_hash)).toEqual([
      body.input_hash,
      body.input_hash,
    ]);
    expect(mocks.call.mock.calls[0][0].messages).toEqual(mocks.call.mock.calls[1][0].messages);
    expect(mocks.call.mock.calls.map(([input]) => input.model)).toEqual(['free-a', 'free-b']);
    expect(body.results.map((result: Record<string, unknown>) => result.model)).toEqual([
      'free-a',
      'free-b',
    ]);
  });

  it('hashes sorted object keys consistently across requests and changed evidence differently', async () => {
    const first = await run();
    const reordered = await run(request({ state: { nested: { a: 1, b: 2 }, need: 'cache' } }));
    const changed = await run(request({ state: { need: 'different' } }));
    expect(first.body.input_hash).toBe(reordered.body.input_hash);
    expect(first.body.input_hash).not.toBe(changed.body.input_hash);
  });

  it.each([
    { project_id: '' },
    { questions: [questions[0], questions[0]] },
    { questions: [{ ...questions[0], options: ['a', 'a'] }] },
    { questions: [{ ...questions[1], max: -1 }] },
    { limits: { max_cost_usd: 1 } },
    { limits: { deadline_ms: 60001 } },
    { state: { content: 'x'.repeat(32768) } },
    { state: { content: 'x'.repeat(66000) } },
    { arbitrary_forwarding: true },
  ])('rejects invalid input without inference: %j', async (extra) => {
    expect((await run(request(extra))).response.status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('rejects duplicate compare selections and attribution mismatch', async () => {
    expect(
      (
        await run(
          request({ engines: [{ engine: 'free_ai' }, { engine: 'free_ai', model: 'auto' }] }, true)
        )
      ).response.status
    ).toBe(400);
    expect(
      (await run(request({}, false, { 'x-gateway-project-id': 'reader' }))).response.status
    ).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('rejects aliases of the same model before any comparison inference', async () => {
    mocks.registry[0]!.id = 'alias-a';
    expect(
      (
        await run(
          request(
            {
              engines: [
                { engine: 'free_ai', model: 'free-a' },
                { engine: 'free_ai', model: 'alias-a' },
              ],
            },
            true
          )
        )
      ).response.status
    ).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('rejects nonfinite nested JSON state instead of hashing it as null', async () => {
    const req = new Request('https://gateway.test/v1/decide', {
      method: 'POST',
      headers: { authorization: 'Bearer test-gateway-key', 'content-type': 'application/json' },
      body: '{"project_id":"starboard","state":{"nested":{"value":1e400}},"questions":[{"id":"q","type":"bool","prompt":"Is this valid?"}]}',
    });
    expect((await run(req)).response.status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('rejects unregistered models and never invokes Jev', async () => {
    expect((await run(request({ model: 'paid-or-unknown' }))).body.error.code).toBe(
      'unknown_model'
    );
    expect((await run(request({ engine: 'jev' }))).body.error.code).toBe('provider_disabled');
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it.each([
    { output: [{ ...answers[0], value: 'invented' }, answers[1], answers[2]] },
    { output: [answers[0], { ...answers[1], value: 11 }, answers[2]] },
    { output: [answers[0], answers[1], { ...answers[2], value: true }] },
    { output: [answers[0], answers[0], answers[2]] },
    { output: [answers[0]] },
    { output: [answers[0], answers[1], { ...answers[2], status: 'answered', value: 'true' }] },
  ])('fails closed on invalid typed outputs', async ({ output }) => {
    mocks.call.mockResolvedValue(completion(JSON.stringify({ answers: output })));
    expect((await run()).body).toMatchObject({
      status: 'error',
      answers: [],
      error: { code: 'invalid_decision_output' },
    });
  });

  it('supports sixty questions and genuine bool answers without dropping IDs', async () => {
    const sixty = Array.from({ length: 60 }, (_value, index) => ({
      id: `q${index}`,
      type: 'bool',
      prompt: 'Does evidence support it?',
    }));
    const output = sixty.map((q) => ({
      id: q.id,
      status: 'answered',
      value: true,
      reason: 'Supplied state supports it.',
    }));
    mocks.call.mockResolvedValue(completion(JSON.stringify({ answers: output })));
    expect((await run(request({ questions: sixty }))).body.answers).toEqual(output);
  });

  it('accepts a sole explicit none option and preserves abstention', async () => {
    const single = [
      {
        id: 'evidence',
        type: 'choice',
        prompt: 'Which evidence supports this?',
        options: ['none'],
      },
    ];
    const output = [
      { id: 'evidence', status: 'abstained', value: null, reason: 'Insufficient evidence.' },
    ];
    mocks.call.mockResolvedValue(completion(JSON.stringify({ answers: output })));
    expect((await run(request({ questions: single }))).body.answers).toEqual(output);
  });

  it('rejects deep state and extra output metadata without exposing it', async () => {
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 35; index++) deep = { nested: deep };
    expect((await run(request({ state: deep }))).response.status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
    const result = completion();
    Object.assign(result.completion.usage, { secret: 'do not forward' });
    mocks.call.mockResolvedValue(result);
    expect(JSON.stringify((await run()).body)).not.toContain('do not forward');
  });

  it('bounds responses and sanitizes failures', async () => {
    mocks.call.mockResolvedValue(completion('secret upstream payload'.repeat(4000)));
    const { body } = await run();
    expect(body.status).toBe('error');
    expect(JSON.stringify(body)).not.toContain('secret upstream payload');
  });

  it('aborts active inference at the deadline and starts no fallback', async () => {
    let aborted = false;
    mocks.call.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('aborted secret'));
            },
            { once: true }
          );
        })
    );
    const { body } = await run(request({ limits: { deadline_ms: 1000 } }));
    expect(body.error.code).toBe('deadline_exceeded');
    expect(aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.call).toHaveBeenCalledOnce();
  });

  it('does not start inference for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await run(request({}, false, {}, controller.signal))).body.status).toBe('error');
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('propagates caller cancellation to active inference without fallback', async () => {
    const controller = new AbortController();
    let began: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    mocks.call.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          began?.();
          signal.addEventListener('abort', () => reject(new Error('caller cancelled')), {
            once: true,
          });
        })
    );
    const pending = run(request({}, false, {}, controller.signal));
    await started;
    controller.abort();
    expect((await pending).body.status).toBe('error');
    expect(mocks.call.mock.calls[0][0].signal.aborted).toBe(true);
    expect(mocks.call).toHaveBeenCalledOnce();
  });

  it('reports underlying gateway unavailability without exposing errors or inference', async () => {
    mocks.registry = [];
    const { env } = makeTestEnv();
    const response = await app.fetch(request(), env, makeCtx());
    expect(await response.json()).toMatchObject({
      status: 'error',
      answers: [],
      error: { code: 'gateway_503' },
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('keeps public auth and rate limits closed', async () => {
    expect((await run(request({}, false, { authorization: 'Bearer bad' }))).response.status).toBe(
      401
    );
    const { env } = makeTestEnv({ rateLimitDeny: true });
    expect((await app.fetch(request(), env, makeCtx())).status).toBe(429);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('supports private Fleet service binding with real route attribution', async () => {
    const { env } = makeTestEnv({ GROQ_API_KEY: 'test' });
    const response = await fetchFleetRequest(
      request({}, false, { 'x-gateway-project-id': 'starboard' }),
      env,
      async (forwarded) => app.fetch(forwarded, env, makeCtx())
    );
    expect(await response.json()).toMatchObject({ status: 'ok', project_id: 'starboard' });
  });
});
