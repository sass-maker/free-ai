import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { callTogetherImages } from '../src/providers/together-images';
import { imageHttpError } from '../src/providers/image-utils';
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

  function imageRequest(model = 'auto') {
    return new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'test-proj',
      },
      body: JSON.stringify({ model, prompt: 'a small cat', response_format: 'b64_json' }),
    });
  }

  it.each([401, 402, 403])(
    'fails over on Together %s and persists an image-only 24h cooldown',
    async (status) => {
      const snapshots: Array<{ key: string; cooldownUntil: number; successRate: number }> = [];
      const { env } = makeTestEnv({
        TOGETHER_API_KEY: 'k',
        GEMINI_API_KEY: 'g',
        healthSnapshots: snapshots,
      });
      const originalGet = env.HEALTH_DO.get.bind(env.HEALTH_DO);
      const records: Array<Record<string, unknown>> = [];
      vi.spyOn(env.HEALTH_DO, 'get').mockImplementation((id) => {
        const stub = originalGet(id);
        const originalFetch = stub.fetch.bind(stub);
        stub.fetch = vi.fn(async (url, init) => {
          if (String(url).endsWith('/record')) {
            const record = JSON.parse(String(init?.body));
            records.push(record);
            if (record.unavailableUntil)
              snapshots.push({
                key: record.key,
                cooldownUntil: record.unavailableUntil,
                successRate: 0,
              });
          }
          return originalFetch(url, init);
        });
        return stub;
      });
      togetherImageMock.mockRejectedValue(
        Object.assign(new Error('third_party_data_sharing_blocked'), { status })
      );
      geminiImageMock.mockResolvedValue({ created: 1, data: [{ b64_json: 'image' }] });
      const before = Date.now();
      const first = await app.fetch(imageRequest(), env, makeCtx());
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({
        degraded: true,
        x_gateway: { provider: 'gemini', attempts: 2 },
      });
      expect(first.headers.get('x-degraded-mode')).toBe('true');
      expect(first.headers.get('x-gateway-provider')).toBe('gemini');
      expect(togetherImageMock).toHaveBeenCalledOnce();
      expect(snapshots[0].key).toBe('together:images');
      expect(snapshots[0].cooldownUntil).toBeGreaterThanOrEqual(before + 86_400_000);
      expect(snapshots[0].cooldownUntil).toBeLessThanOrEqual(Date.now() + 86_400_000);
      expect(JSON.stringify(records)).not.toContain('third_party_data_sharing_blocked');

      const next = await app.fetch(imageRequest(), env, makeCtx());
      expect(next.status).toBe(200);
      expect(await next.json()).toMatchObject({ degraded: false, x_gateway: { attempts: 1 } });
      expect(togetherImageMock).toHaveBeenCalledOnce();

      togetherImageMock.mockResolvedValueOnce({ created: 1, data: [{ b64_json: 'image' }] });
      const explicitModel = togetherImageMock.mock.calls[0][0].model;
      const explicit = await app.fetch(imageRequest(explicitModel), env, makeCtx());
      expect(explicit.status).toBe(200);
      expect(togetherImageMock).toHaveBeenCalledTimes(2);
      expect(togetherImageMock.mock.calls[1][0].verify).toBe(false);
    }
  );

  it('covers all five providers once and returns each upstream status on exhaustion', async () => {
    const { env } = makeTestEnv({
      TOGETHER_API_KEY: 'k',
      GEMINI_API_KEY: 'g',
      NVIDIA_API_KEY: 'n',
      WORKERS_AI_ENABLED: 'true',
    });
    (env as unknown as { AI: unknown }).AI = { run: vi.fn() };
    for (const mock of [
      togetherImageMock,
      geminiImageMock,
      nvidiaImageMock,
      pollinationsImageMock,
      workersAiImageMock,
    ]) {
      mock.mockRejectedValue(
        Object.assign(new Error('upstream account unavailable'), { status: 403 })
      );
    }
    const res = await app.fetch(imageRequest(), env, makeCtx());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: {
        type: 'provider_fatal',
        cost_budget: { attempts: 5, totalTimeoutMs: 300_000 },
        attempts: [
          { provider: 'together', status: 403 },
          { provider: 'gemini', status: 403 },
          { provider: 'nvidia', status: 403 },
          { provider: 'workers_ai', status: 403 },
          { provider: 'pollinations', status: 403 },
        ],
      },
    });
    for (const mock of [
      togetherImageMock,
      geminiImageMock,
      nvidiaImageMock,
      pollinationsImageMock,
      workersAiImageMock,
    ]) {
      expect(mock).toHaveBeenCalledOnce();
      expect(mock.mock.calls[0][0].verify).toBe(true);
    }
  });

  it.each([
    [400, 'invalid size', 400, 'input_nonretriable'],
    [403, 'safety refusal', 502, 'safety_refusal'],
  ])('stops on upstream %s %s', async (status, message, expectedStatus, type) => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k', GEMINI_API_KEY: 'g' });
    togetherImageMock.mockRejectedValue(Object.assign(new Error(message as string), { status }));
    const res = await app.fetch(imageRequest(), env, makeCtx());
    expect(res.status).toBe(expectedStatus);
    expect(await res.json()).toMatchObject({ error: { type, cost_budget: { attempts: 1 } } });
    expect(geminiImageMock).not.toHaveBeenCalled();
  });

  it('orders auto providers by health before priority', async () => {
    const { env } = makeTestEnv({
      TOGETHER_API_KEY: 'k',
      GEMINI_API_KEY: 'g',
      healthSnapshots: [
        { key: 'together:images', successRate: 0.2, cooldownUntil: 0 },
        { key: 'gemini:images', successRate: 1, cooldownUntil: 0 },
      ],
    });
    geminiImageMock.mockResolvedValue({ created: 1, data: [{ b64_json: 'image' }] });
    expect((await app.fetch(imageRequest(), env, makeCtx())).status).toBe(200);
    expect(togetherImageMock).not.toHaveBeenCalled();
  });

  it('Together adapter preserves HTTP status and only safe diagnostic detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'third_party_data_sharing_blocked',
            message: 'requires third-party data sharing to be enabled for your organization',
            secret: 'private-provider-key',
          },
        }),
        { status: 403 }
      )
    );
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'private-provider-key' });
    await expect(callTogetherImages({ env, model: 'flux', prompt: 'cat' })).rejects.toMatchObject({
      status: 403,
      message:
        'Together image error (403): third_party_data_sharing_blocked, requires third-party data sharing',
    });
  });

  it('preserves safe Gemini region diagnostics', async () => {
    const error = await imageHttpError(
      'Gemini',
      new Response(
        JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'private' } }),
        { status: 400 }
      )
    );
    expect(error).toMatchObject({ status: 400, error: { status: 'FAILED_PRECONDITION' } });
    expect(error.message).not.toContain('private');
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
    expect(res.headers.get('x-gateway-provider')).toBe('together');
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
    expect(body.error.type).toBe('provider_fatal');
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
    expect(geminiImageMock.mock.calls[0][0].verify).toBe(false);
    expect(res.headers.get('x-gateway-provider')).toBe('gemini');
    expect(togetherImageMock).not.toHaveBeenCalled();
  });

  it('attempts Pollinations last after other providers and Workers AI regardless of health', async () => {
    const { env } = makeTestEnv({
      NVIDIA_API_KEY: 'n',
      WORKERS_AI_ENABLED: 'true',
      healthSnapshots: [
        { key: 'nvidia:images', successRate: 0.2, cooldownUntil: 0 },
        { key: 'workers_ai:images', successRate: 0.1, cooldownUntil: 0 },
        { key: 'pollinations:images', successRate: 1, cooldownUntil: 0 },
      ],
    });
    (env as unknown as { AI: unknown }).AI = { run: vi.fn() };
    nvidiaImageMock.mockRejectedValue(new Error('provider unavailable'));
    workersAiImageMock.mockRejectedValue(new Error('provider unavailable'));
    pollinationsImageMock.mockResolvedValue({
      created: 1,
      data: [{ url: 'https://img.example/pollinations.png' }],
    });

    const res = await app.fetch(imageRequest(), env, makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-gateway-provider')).toBe('pollinations');
    expect(res.headers.get('x-degraded-mode')).toBe('true');
    expect(await res.json()).toMatchObject({
      degraded: true,
      x_gateway: { provider: 'pollinations', attempts: 3 },
    });
    expect(nvidiaImageMock).toHaveBeenCalledOnce();
    expect(workersAiImageMock).toHaveBeenCalledOnce();
    expect(pollinationsImageMock).toHaveBeenCalledOnce();
    expect(nvidiaImageMock.mock.invocationCallOrder[0]).toBeLessThan(
      workersAiImageMock.mock.invocationCallOrder[0]
    );
    expect(workersAiImageMock.mock.invocationCallOrder[0]).toBeLessThan(
      pollinationsImageMock.mock.invocationCallOrder[0]
    );
    for (const mock of [nvidiaImageMock, workersAiImageMock, pollinationsImageMock]) {
      expect(mock.mock.calls[0][0].verify).toBe(true);
    }
  });

  it.each([
    [402, 'Pollinations image error (402)'],
    [undefined, 'Pollinations returned unparseable image dimensions'],
  ])(
    'returns the error when Pollinations fails with status %s and no fallback remains',
    async (status, message) => {
      const { env } = makeTestEnv();
      pollinationsImageMock.mockRejectedValue(Object.assign(new Error(message), { status }));
      const res = await app.fetch(imageRequest(), env, makeCtx());
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({
        error: {
          type: 'provider_fatal',
          message: `All image providers failed: ${message}`,
          attempts: [{ provider: 'pollinations', status: status ?? null }],
          cost_budget: { attempts: 1 },
        },
      });
      expect(res.headers.get('x-gateway-provider')).toBeNull();
      expect(pollinationsImageMock).toHaveBeenCalledOnce();
      expect(pollinationsImageMock.mock.calls[0][0].verify).toBe(true);
    }
  );

  it('allows forced Pollinations auto requests without verification', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    pollinationsImageMock.mockResolvedValue({
      created: 1,
      data: [{ url: 'https://img.example/pollinations.png' }],
    });
    const req = imageRequest();
    req.headers.set('x-gateway-force-provider', 'pollinations');
    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-gateway-provider')).toBe('pollinations');
    expect(pollinationsImageMock).toHaveBeenCalledOnce();
    expect(pollinationsImageMock.mock.calls[0][0].verify).toBe(false);
    expect(togetherImageMock).not.toHaveBeenCalled();
  });

  it('allows explicit Pollinations models without verification', async () => {
    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    pollinationsImageMock.mockResolvedValue({
      created: 1,
      data: [{ url: 'https://img.example/pollinations.png' }],
    });
    const res = await app.fetch(imageRequest('pollinations-flux'), env, makeCtx());
    expect(res.status).toBe(200);
    expect(pollinationsImageMock).toHaveBeenCalledOnce();
    expect(pollinationsImageMock.mock.calls[0][0]).toMatchObject({ model: 'flux', verify: false });
    expect(togetherImageMock).not.toHaveBeenCalled();
  });

  it('keeps Workers AI image generation behind other providers for auto routing', async () => {
    nvidiaImageMock.mockResolvedValueOnce({
      created: 84,
      data: [{ url: 'https://img.example/nvidia.png' }],
    });

    const { env } = makeTestEnv({ NVIDIA_API_KEY: 'n', WORKERS_AI_ENABLED: 'true' });
    (env as unknown as { AI: unknown }).AI = { run: vi.fn() };

    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'test-proj',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'moon' }),
    });

    const res = await app.fetch(req, env, makeCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { x_gateway: { provider: string } };
    expect(body.x_gateway.provider).toBe('nvidia');
    expect(nvidiaImageMock).toHaveBeenCalledOnce();
    expect(workersAiImageMock).not.toHaveBeenCalled();
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
