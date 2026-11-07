import { afterEach, describe, expect, it, vi } from 'vitest';

import { getImageRegistry, getModelRegistry, getSttRegistry, getTtsRegistry } from '../src/config';
import app from '../src/index';
import {
  callWorkersAiTts,
  TtsBudgetError,
  TtsInputError,
  WORKERS_AI_TTS_MODEL,
} from '../src/providers/workers-ai-tts';
import { estimateNeuronCost } from '../src/state/neuron-budget';
import type { Env } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const { groq } = vi.hoisted(() => ({ groq: vi.fn() }));
vi.mock('../src/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers')>();
  return { ...actual, providerCallers: { ...actual.providerCallers, groq } };
});

function setup(allowed = true) {
  const { env: baseEnv } = makeTestEnv({ WORKERS_AI_ENABLED: 'true', GROQ_API_KEY: 'test-key' });
  const env: Env = baseEnv;
  const run = vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x44])).body);
  const debit = vi.fn(async (_url: string, init: RequestInit) => {
    const { neurons } = JSON.parse(init.body as string);
    return Response.json({
      allowed,
      used: allowed ? neurons : 9500,
      remaining: allowed ? 9500 - neurons : 0,
      retryAfter: allowed ? 0 : 60,
      dayKey: new Date().toISOString().slice(0, 10),
    });
  });
  env.AI = { run };
  env.NEURON_BUDGET = {
    idFromName: () => ({}),
    get: () => ({ fetch: debit }),
  } as unknown as DurableObjectNamespace;
  return { env, run, debit };
}

afterEach(() => {
  vi.unstubAllGlobals();
  groq.mockReset();
});

describe('Aura 2 migration', () => {
  it('reserves UTF-8 bytes with a buffer before sending the documented MP3 request', async () => {
    const { env, run, debit } = setup();
    const result = await callWorkersAiTts({
      env,
      model: WORKERS_AI_TTS_MODEL,
      input: 'hé🙂',
      voice: 'nova',
    });
    expect(JSON.parse(debit.mock.calls[0][1].body as string)).toEqual({ neurons: 23 });
    expect(debit.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
    expect(run).toHaveBeenCalledWith(WORKERS_AI_TTS_MODEL, {
      text: 'hé🙂',
      speaker: 'luna',
      encoding: 'mp3',
    });
    expect(result.contentType).toBe('audio/mpeg');
    expect(Array.from(new Uint8Array(result.audio))).toEqual([0xff, 0xfb, 0x90, 0x44]);
    expect(estimateNeuronCost(WORKERS_AI_TTS_MODEL, { inputBytes: 1000 })).toBe(3273);
    expect(estimateNeuronCost(WORKERS_AI_TTS_MODEL)).toBeNull();
  });

  it.each([
    { response_format: 'wav' as const },
    { response_format: 'opus' as const },
    { response_format: 'flac' as const },
    { speed: 1.5 },
    { voice: 'ja' },
    { model: '@cf/myshell-ai/melotts' },
    { input: ' ' },
  ])('rejects unsupported options before reserving or inferring: %j', async (options) => {
    const { env, run, debit } = setup();
    await expect(
      callWorkersAiTts({ env, model: WORKERS_AI_TTS_MODEL, input: 'hello', ...options })
    ).rejects.toBeInstanceOf(TtsInputError);
    expect(debit).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['denied', 'missing', 'too-large', 'disabled'])(
    'never infers when the budget is %s',
    async (condition) => {
      const { env, run } = setup(condition !== 'denied');
      if (condition === 'missing') env.NEURON_BUDGET = undefined;
      if (condition === 'disabled') env.WORKERS_AI_ENABLED = 'false';
      await expect(
        callWorkersAiTts({
          env,
          model: WORKERS_AI_TTS_MODEL,
          input: condition === 'too-large' ? 'a'.repeat(3000) : 'hello',
        })
      ).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    }
  );

  it('rejects malformed or empty output and retains the reservation on upstream failure', async () => {
    const { env, run, debit } = setup();
    run.mockResolvedValueOnce(null);
    await expect(
      callWorkersAiTts({ env, model: WORKERS_AI_TTS_MODEL, input: 'hello' })
    ).rejects.toThrow('no audio stream');
    run.mockResolvedValueOnce(new Response(new Uint8Array()).body);
    await expect(
      callWorkersAiTts({ env, model: WORKERS_AI_TTS_MODEL, input: 'hello' })
    ).rejects.toThrow('empty audio');
    run.mockRejectedValueOnce(new Error('upstream unavailable'));
    await expect(
      callWorkersAiTts({ env, model: WORKERS_AI_TTS_MODEL, input: 'hello' })
    ).rejects.toThrow('upstream unavailable');
    expect(debit).toHaveBeenCalledTimes(3);
  });

  it('exposes a structured budget denial to the voice pipeline', async () => {
    const { env } = setup(false);
    await expect(
      callWorkersAiTts({ env, model: WORKERS_AI_TTS_MODEL, input: 'hello' })
    ).rejects.toBeInstanceOf(TtsBudgetError);
  });

  it.each([true, false])(
    'routes speech-to-speech through the same budgeted adapter (allowed=%s)',
    async (allowed) => {
      const { env, run } = setup(allowed);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ text: 'hello' }))
      );
      groq.mockResolvedValue({ completion: { choices: [{ message: { content: 'Hi there' } }] } });
      const form = new FormData();
      form.append('file', new Blob(['audio'], { type: 'audio/mpeg' }), 'test.mp3');
      const response = await app.fetch(
        new Request('https://gateway.test/v1/audio/speech-to-speech', {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-gateway-key',
            'x-gateway-project-id': 'test-voice',
          },
          body: form,
        }),
        env,
        makeCtx()
      );
      expect(response.status).toBe(allowed ? 200 : 503);
      if (allowed) {
        expect(run).toHaveBeenCalledWith(WORKERS_AI_TTS_MODEL, {
          text: 'Hi there',
          speaker: 'luna',
          encoding: 'mp3',
        });
        expect(response.headers.get('content-type')).toBe('audio/mpeg');
        expect((await response.arrayBuffer()).byteLength).toBe(4);
      } else {
        expect(run).not.toHaveBeenCalled();
        expect(await response.json()).toMatchObject({ error: { code: 'neuron_budget_exhausted' } });
      }
    }
  );

  it.each(['mp3', 'flac'])(
    'uses the real TTS adapter for the speech route (%s)',
    async (format) => {
      const { env, run } = setup();
      const response = await app.fetch(
        new Request('https://gateway.test/v1/audio/speech', {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-gateway-key',
            'content-type': 'application/json',
            'x-gateway-project-id': 'test-tts',
          },
          body: JSON.stringify({ input: 'hello', model: 'auto', response_format: format }),
        }),
        env,
        makeCtx()
      );
      expect(response.status).toBe(format === 'mp3' ? 200 : 400);
      if (format === 'mp3') {
        expect(response.headers.get('x-gateway-model')).toBe(WORKERS_AI_TTS_MODEL);
        expect((await response.arrayBuffer()).byteLength).toBe(4);
        expect(run).toHaveBeenCalledOnce();
      } else {
        expect(run).not.toHaveBeenCalled();
        expect(await response.json()).toMatchObject({
          error: {
            message: expect.stringContaining('only mp3'),
            type: 'invalid_request_error',
            code: 'invalid_tts_options',
          },
        });
      }
    }
  );

  it.each([
    { route: 'speech', encoding: 'ASCII', text: 'a'.repeat(3000) },
    { route: 'speech-to-speech', encoding: 'ASCII', text: 'a'.repeat(3000) },
    { route: 'speech', encoding: 'UTF-8', text: '🙂'.repeat(1000) },
    { route: 'speech-to-speech', encoding: 'UTF-8', text: '🙂'.repeat(1000) },
  ])(
    'rejects an impossible TTS reservation without a retryable error ($route, $encoding)',
    async ({ route, text }) => {
      const { env, run, debit } = setup();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ text: 'hello' }))
      );
      groq.mockResolvedValue({ completion: { choices: [{ message: { content: text } }] } });
      const form = new FormData();
      form.append('file', new Blob(['audio'], { type: 'audio/mpeg' }), 'test.mp3');
      const response = await app.fetch(
        new Request(`https://gateway.test/v1/audio/${route}`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-gateway-key',
            'x-gateway-project-id': 'test-tts-limit',
            ...(route === 'speech' ? { 'content-type': 'application/json' } : {}),
          },
          body: route === 'speech' ? JSON.stringify({ input: text, model: 'auto' }) : form,
        }),
        env,
        makeCtx()
      );
      expect(response.status).toBe(route === 'speech' ? 400 : 502);
      expect(response.headers.has('retry-after')).toBe(false);
      expect(await response.json()).toMatchObject({
        error: {
          type: route === 'speech' ? 'invalid_request_error' : 'provider_error',
          code: route === 'speech' ? 'tts_input_too_large' : 'llm_response_too_long_for_tts',
        },
      });
      expect(debit).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    }
  );

  it.each([{ voice: 'ja' }, { speed: 1.5 }])(
    'returns a client error for unsupported provider options: %j',
    async (options) => {
      const { env, run, debit } = setup();
      const response = await app.fetch(
        new Request('https://gateway.test/v1/audio/speech', {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-gateway-key',
            'content-type': 'application/json',
            'x-gateway-project-id': 'test-tts-options',
          },
          body: JSON.stringify({ input: 'hello', model: 'auto', ...options }),
        }),
        env,
        makeCtx()
      );
      expect(response.status).toBe(400);
      expect(response.headers.has('retry-after')).toBe(false);
      expect(await response.json()).toMatchObject({
        error: { type: 'invalid_request_error', code: 'invalid_tts_options' },
      });
      expect(debit).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    }
  );

  it('preserves structured budget denial on the speech route', async () => {
    const { env, run } = setup(false);
    const response = await app.fetch(
      new Request('https://gateway.test/v1/audio/speech', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-gateway-key',
          'content-type': 'application/json',
          'x-gateway-project-id': 'test-tts-budget',
        },
        body: JSON.stringify({ input: 'hello', model: 'auto' }),
      }),
      env,
      makeCtx()
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toMatchObject({ error: { code: 'neuron_budget_exhausted' } });
    expect(run).not.toHaveBeenCalled();
  });

  it('removes retiring defaults without removing similarly named surviving models', () => {
    const { env } = setup();
    const models = [
      ...getModelRegistry(env),
      ...getImageRegistry(env),
      ...getTtsRegistry(env),
      ...getSttRegistry(env),
    ].map((entry) => entry.model);
    for (const model of [
      '@cf/myshell-ai/melotts',
      '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      '@cf/meta/llama-3.2-1b-instruct',
      '@cf/meta/llama-3.2-3b-instruct',
      '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      '@cf/lykon/dreamshaper-8-lcm',
    ]) {
      expect(models).not.toContain(model);
      expect(estimateNeuronCost(model)).toBeNull();
    }
    expect(models).toContain('@cf/meta/llama-3.1-8b-instruct');
    expect(models).toContain('@cf/openai/whisper');
    expect(models).toContain(WORKERS_AI_TTS_MODEL);
  });
});
