import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

// Mock provider callers BEFORE importing the app so the app captures our stubs.
// `vi.hoisted` runs before `vi.mock` hoist so stubs are available in the factory.
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

const {
  togetherImageMock,
  geminiImageMock,
  workersAiImageMock,
  nvidiaImageMock,
  pollinationsImageMock,
} = mocks;

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

describe('POST /v1/images/generations', () => {
  beforeEach(() => {
    togetherImageMock.mockReset();
    geminiImageMock.mockReset();
    workersAiImageMock.mockReset();
    nvidiaImageMock.mockReset();
    pollinationsImageMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with the provider response on happy path (Together)', async () => {
    togetherImageMock.mockResolvedValueOnce({
      created: 1_700_000_000,
      data: [{ url: 'https://img.example/out.png' }],
    });

    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'test-proj',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'a small cat' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.created).toBe(1_700_000_000);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as Array<{ url: string }>)[0].url).toBe('https://img.example/out.png');
    expect(body.x_gateway).toMatchObject({ provider: 'together', project_id: 'test-proj' });
    expect(togetherImageMock).toHaveBeenCalledOnce();
  });

  it('returns 400 when project_id is missing', async () => {
    togetherImageMock.mockResolvedValueOnce({ created: 1, data: [] });
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-gateway-key' },
      body: JSON.stringify({ model: 'auto', prompt: 'hello' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_project_id');
    expect(togetherImageMock).not.toHaveBeenCalled();
  });

  it('returns 503 when no image provider has a key configured', async () => {
    const { env } = makeTestEnv(); // no keys, no AI binding — pollinations is key-less but filter keeps it
    // To truly force "no provider", we also pass an unknown model that nothing matches.
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'test-proj',
      },
      body: JSON.stringify({ model: 'totally-unknown-model-xyz', prompt: 'hi' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('no_image_provider');
  });

  it('returns 502 when all tried providers fail', async () => {
    togetherImageMock.mockRejectedValue(new Error('upstream 500'));

    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'test-proj',
        'x-gateway-force-provider': 'together',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'p' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe('provider_error');
    expect(body.error.message).toContain('upstream 500');
  });

  it('routes to Gemini when forced via x-gateway-force-provider', async () => {
    geminiImageMock.mockResolvedValueOnce({
      created: 42,
      data: [{ b64_json: 'deadbeef' }],
    });

    const { env } = makeTestEnv({ GEMINI_API_KEY: 'g' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'test-proj',
        'x-gateway-force-provider': 'gemini',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'moon' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { x_gateway: { provider: string } };
    expect(body.x_gateway.provider).toBe('gemini');
    expect(geminiImageMock).toHaveBeenCalledOnce();
    expect(togetherImageMock).not.toHaveBeenCalled();
  });

  it('rejects invalid prompts with a 400 (zod validation)', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'test-proj',
      },
      body: JSON.stringify({ model: 'auto', prompt: '' }), // prompt min(1)
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
  });
});
