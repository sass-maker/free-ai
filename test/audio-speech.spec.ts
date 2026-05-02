import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

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

  it('returns audio bytes on happy path (Workers AI melotts)', async () => {
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
});
