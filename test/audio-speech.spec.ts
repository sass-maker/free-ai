import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { TtsInputError, WORKERS_AI_TTS_MODEL } from '../src/providers/workers-ai-tts';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({
  togetherImageMock: vi.fn(),
  geminiImageMock: vi.fn(),
  workersAiImageMock: vi.fn(),
  nvidiaImageMock: vi.fn(),
  pollinationsImageMock: vi.fn(),
  togetherVideoSubmit: vi.fn(),
  togetherVideoPoll: vi.fn(),
  workersAiTtsMock: vi.fn(),
  groqTtsMock: vi.fn(),
}));

vi.mock('../src/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    imageProviderCallers: {
      together: mocks.togetherImageMock,
      gemini: mocks.geminiImageMock,
      workers_ai: mocks.workersAiImageMock,
      nvidia: mocks.nvidiaImageMock,
      pollinations: mocks.pollinationsImageMock,
    },
    videoProviderCallers: {
      together: { submit: mocks.togetherVideoSubmit, poll: mocks.togetherVideoPoll },
    },
    ttsProviderCallers: {
      workers_ai: mocks.workersAiTtsMock,
      groq: mocks.groqTtsMock,
    },
  };
});

function makeAi() {
  return { run: vi.fn(async () => new Uint8Array([1, 2, 3])) };
}

describe('POST /v1/audio/speech', () => {
  beforeEach(() => {
    mocks.workersAiTtsMock.mockReset();
    mocks.groqTtsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns audio bytes on happy path (Workers AI Aura 2)', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x44]).buffer;
    mocks.workersAiTtsMock.mockResolvedValueOnce({ audio, contentType: 'audio/mpeg' });

    const { env } = makeTestEnv({ WORKERS_AI_ENABLED: 'true' });
    // Workers AI key/binding:
    (env as unknown as { AI: unknown }).AI = makeAi();

    const req = new Request('https://gateway.test/v1/audio/speech', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-tts',
      },
      body: JSON.stringify({ model: 'auto', input: 'hello world' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('x-gateway-provider')).toBe('workers_ai');
    expect(res.headers.get('x-gateway-project-id')).toBe('proj-tts');
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBe(4);
    expect(mocks.workersAiTtsMock).toHaveBeenCalledOnce();
  });

  it('returns 400 when project_id is missing', async () => {
    const { env } = makeTestEnv({ WORKERS_AI_ENABLED: 'true' });
    (env as unknown as { AI: unknown }).AI = makeAi();
    const req = new Request('https://gateway.test/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-gateway-key' },
      body: JSON.stringify({ model: 'auto', input: 'hi' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_project_id');
    expect(mocks.workersAiTtsMock).not.toHaveBeenCalled();
  });

  it('returns 503 when no TTS provider is configured', async () => {
    const { env } = makeTestEnv(); // no GROQ, no AI binding
    const req = new Request('https://gateway.test/v1/audio/speech', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-tts',
      },
      body: JSON.stringify({ model: 'auto', input: 'hi' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('no_tts_provider');
  });

  it('returns 502 when all TTS providers fail', async () => {
    mocks.workersAiTtsMock.mockRejectedValueOnce(new Error('ai busy'));
    const { env } = makeTestEnv({ WORKERS_AI_ENABLED: 'true' });
    (env as unknown as { AI: unknown }).AI = makeAi();

    const req = new Request('https://gateway.test/v1/audio/speech', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-tts',
        'x-gateway-force-provider': 'workers_ai',
      },
      body: JSON.stringify({ model: 'auto', input: 'hi' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe('provider_error');
    expect(body.error.message).toContain('ai busy');
  });

  it('rejects empty input with a 400 (zod validation)', async () => {
    const { env } = makeTestEnv();
    (env as unknown as { AI: unknown }).AI = makeAi();
    const req = new Request('https://gateway.test/v1/audio/speech', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-tts',
      },
      body: JSON.stringify({ model: 'auto', input: '' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
  });

  it.each([false, true])(
    'preserves provider failure after a fallback rejects its options (input-only=%s)',
    async (inputOnly) => {
      const config = await import('../src/config');
      vi.spyOn(config, 'getTtsRegistry').mockReturnValueOnce([
        { id: 'groq-tts', provider: 'groq', model: 'groq-tts', enabled: true, priority: 1 },
        {
          id: 'cf-aura-2-en',
          provider: 'workers_ai',
          model: WORKERS_AI_TTS_MODEL,
          enabled: true,
          priority: 0.7,
        },
      ]);
      mocks.groqTtsMock.mockRejectedValueOnce(
        inputOnly ? new TtsInputError('Unsupported Groq options') : new Error('groq unavailable')
      );
      mocks.workersAiTtsMock.mockRejectedValueOnce(new TtsInputError('Aura supports only mp3'));
      const { env } = makeTestEnv({ WORKERS_AI_ENABLED: 'true', GROQ_API_KEY: 'test-key' });
      (env as unknown as { AI: unknown }).AI = makeAi();
      const response = await app.fetch(
        new Request('https://gateway.test/v1/audio/speech', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer test-gateway-key',
            'x-gateway-project-id': 'proj-tts-fallback',
          },
          body: JSON.stringify({ input: 'hello', response_format: 'wav' }),
        }),
        env,
        makeCtx()
      );
      expect(response.status).toBe(inputOnly ? 400 : 502);
      expect(await response.json()).toMatchObject({
        error: {
          type: inputOnly ? 'invalid_request_error' : 'provider_error',
          message: expect.stringContaining(inputOnly ? 'only mp3' : 'groq unavailable'),
        },
      });
      expect(mocks.groqTtsMock).toHaveBeenCalledOnce();
      expect(mocks.workersAiTtsMock).toHaveBeenCalledOnce();
    }
  );
});
