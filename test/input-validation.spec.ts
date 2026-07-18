import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
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

describe('input validation caps', () => {
  beforeEach(() => {
    mocks.workersAiTtsMock.mockReset();
    mocks.togetherVideoSubmit.mockReset();
    mocks.togetherImageMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects oversized TTS input (>3000 chars) with a 400', async () => {
    const { env } = makeTestEnv({ WORKERS_AI_ENABLED: 'true' });
    (env as unknown as { AI: unknown }).AI = { run: vi.fn() };

    const req = new Request('https://gateway.test/v1/audio/speech', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-tts',
      },
      body: JSON.stringify({ model: 'auto', input: 'x'.repeat(3001) }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    expect(mocks.workersAiTtsMock).not.toHaveBeenCalled();
  });

  it('accepts TTS input at the 3000-char boundary', async () => {
    mocks.workersAiTtsMock.mockResolvedValueOnce({
      audio: new Uint8Array([1]).buffer,
      contentType: 'audio/mpeg',
    });
    const { env } = makeTestEnv({ WORKERS_AI_ENABLED: 'true' });
    (env as unknown as { AI: unknown }).AI = { run: vi.fn() };

    const req = new Request('https://gateway.test/v1/audio/speech', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-tts',
      },
      body: JSON.stringify({ model: 'auto', input: 'x'.repeat(3000) }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    expect(mocks.workersAiTtsMock).toHaveBeenCalledOnce();
  });

  it('rejects oversized image prompt (>2000 chars) with a 400', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });

    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-img',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'x'.repeat(2001) }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    expect(mocks.togetherImageMock).not.toHaveBeenCalled();
  });

  it('rejects invalid video duration_seconds (>60) with a 400', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });

    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-vid',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'hi', duration_seconds: 61 }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    expect(mocks.togetherVideoSubmit).not.toHaveBeenCalled();
  });

  it('rejects invalid video duration_seconds (<1) with a 400', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });

    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-vid',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'hi', duration_seconds: 0 }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    expect(mocks.togetherVideoSubmit).not.toHaveBeenCalled();
  });

  it('rejects invalid video aspect_ratio with a 400', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });

    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-vid',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'hi', aspect_ratio: '4:3' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    expect(mocks.togetherVideoSubmit).not.toHaveBeenCalled();
  });

  it('accepts valid video duration and aspect_ratio', async () => {
    mocks.togetherVideoSubmit.mockResolvedValueOnce({
      id: 'job-ok',
      status: 'processing',
    });
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });

    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-vid',
      },
      body: JSON.stringify({
        model: 'auto',
        prompt: 'sunset',
        duration_seconds: 10,
        aspect_ratio: '16:9',
      }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(202);
    expect(mocks.togetherVideoSubmit).toHaveBeenCalledOnce();
  });

  it('rejects oversized video prompt (>2000 chars) with a 400', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });

    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-vid',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'x'.repeat(2001) }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    expect(mocks.togetherVideoSubmit).not.toHaveBeenCalled();
  });
});
