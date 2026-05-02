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

describe('POST /v1/videos/generations (submit)', () => {
  beforeEach(() => {
    mocks.togetherVideoSubmit.mockReset();
    mocks.togetherVideoPoll.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 202 with poll_url when the provider accepts the job asynchronously', async () => {
    mocks.togetherVideoSubmit.mockResolvedValueOnce({
      id: 'job-abc123',
      status: 'processing',
    });

    const { env, kv } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj1',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'clouds rolling by' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      id: string;
      status: string;
      poll_url: string;
      x_gateway: { provider: string; project_id: string };
    };
    expect(body.id).toBe('job-abc123');
    expect(body.status).toBe('processing');
    expect(body.poll_url).toBe('/v1/videos/generations/job-abc123');
    expect(body.x_gateway.provider).toBe('together');
    expect(body.x_gateway.project_id).toBe('proj1');

    // KV should contain the job mapping so that poll can later look it up.
    expect(kv.get('video_job:job-abc123')).toBeDefined();
    const meta = JSON.parse(kv.get('video_job:job-abc123')!);
    expect(meta).toMatchObject({ provider: 'together', project_id: 'proj1' });
  });

  it('returns 200 when the provider completes synchronously', async () => {
    mocks.togetherVideoSubmit.mockResolvedValueOnce({
      id: 'job-sync',
      status: 'completed',
      video_url: 'https://cdn.example/v.mp4',
    });

    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj1',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'hi' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; video_url: string };
    expect(body.status).toBe('completed');
    expect(body.video_url).toBe('https://cdn.example/v.mp4');
  });

  it('returns 400 when project_id is missing', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-gateway-key' },
      body: JSON.stringify({ model: 'auto', prompt: 'hi' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_project_id');
    expect(mocks.togetherVideoSubmit).not.toHaveBeenCalled();
  });

  it('returns 503 when TOGETHER_API_KEY is not configured', async () => {
    const { env } = makeTestEnv(); // no key
    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj1',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'hi' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('no_video_provider');
  });

  it('returns 502 when provider submit throws', async () => {
    mocks.togetherVideoSubmit.mockRejectedValueOnce(new Error('together down'));
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/videos/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj1',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'hi' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe('provider_error');
    expect(body.error.message).toContain('together down');
  });
});

describe('GET /v1/videos/generations/{id} (poll)', () => {
  beforeEach(() => {
    mocks.togetherVideoPoll.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with status/video_url from the poller on success', async () => {
    mocks.togetherVideoPoll.mockResolvedValueOnce({
      id: 'job-known',
      status: 'completed',
      video_url: 'https://cdn.example/out.mp4',
    });
    const kv = new Map<string, string>();
    kv.set(
      'video_job:job-known',
      JSON.stringify({ provider: 'together', model: 'google/veo-2.0', project_id: 'proj-p' }),
    );

    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k', kv });
    const req = new Request('https://gateway.test/v1/videos/generations/job-known', {
      method: 'GET',
      headers: { authorization: 'Bearer test-gateway-key' },
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      video_url: string;
      x_gateway: { provider: string; model: string; project_id: string };
    };
    expect(body.id).toBe('job-known');
    expect(body.status).toBe('completed');
    expect(body.video_url).toBe('https://cdn.example/out.mp4');
    expect(body.x_gateway.provider).toBe('together');
    expect(body.x_gateway.model).toBe('google/veo-2.0');
    expect(body.x_gateway.project_id).toBe('proj-p');
  });

  it('still returns 200 when the KV lookup misses (falls back to together default)', async () => {
    // The handler doesn't 404 on missing KV — it just uses the default provider
    // and still asks the poller. Upstream Together poll is currently flaky, so
    // we simulate the poller returning a stub "processing" status.
    mocks.togetherVideoPoll.mockResolvedValueOnce({ id: 'unknown-id', status: 'processing' });

    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' }); // empty KV
    const req = new Request('https://gateway.test/v1/videos/generations/unknown-id', {
      method: 'GET',
      headers: { authorization: 'Bearer test-gateway-key' },
    });
    const res = await app.fetch(req, env, makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toBe('unknown-id');
    expect(body.status).toBe('processing');
  });

  it('returns 503 when the provider key is missing', async () => {
    const { env } = makeTestEnv(); // no TOGETHER_API_KEY
    const req = new Request('https://gateway.test/v1/videos/generations/any', {
      method: 'GET',
      headers: { authorization: 'Bearer test-gateway-key' },
    });
    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('no_video_provider');
    expect(mocks.togetherVideoPoll).not.toHaveBeenCalled();
  });

  it('returns 501 when the poller throws (upstream poll is undocumented)', async () => {
    // Together's video poll endpoint is currently unreliable upstream, so the
    // handler surfaces poller errors as 501 "not implemented" rather than 502.
    mocks.togetherVideoPoll.mockRejectedValueOnce(new Error('poll upstream failed'));
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/videos/generations/job-fail', {
      method: 'GET',
      headers: { authorization: 'Bearer test-gateway-key' },
    });
    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { message: string; type: string; code: string } };
    expect(body.error.type).toBe('not_implemented');
    expect(body.error.code).toBe('video_poll_pending_upstream');
    expect(body.error.message).toContain('poll upstream failed');
  });
});
