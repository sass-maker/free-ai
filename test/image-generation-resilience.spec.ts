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

const { geminiImageMock, nvidiaImageMock, togetherImageMock } = mocks;

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

describe('image generation resilience', () => {
  beforeEach(() => {
    togetherImageMock.mockReset();
    geminiImageMock.mockReset();
    nvidiaImageMock.mockReset();
    mocks.workersAiImageMock.mockReset();
    mocks.pollinationsImageMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to nvidia when gemini returns 5xx and sets degraded label', async () => {
    // Use GEMINI + NVIDIA (no Together) so the top 3 candidates are:
    //   1. imagen-4 (gemini, 0.86)
    //   2. gemini-flash-image (gemini, 0.82)
    //   3. nvidia-flux-schnell (nvidia, 0.76)
    // Gemini always fails with 500 (retriable), nvidia succeeds on 3rd attempt.
    geminiImageMock.mockRejectedValue(Object.assign(new Error('gemini 500'), { status: 500 }));
    nvidiaImageMock.mockResolvedValueOnce({
      created: 42,
      data: [{ url: 'https://img.example/nvidia.png' }],
    });

    const { env } = makeTestEnv({ GEMINI_API_KEY: 'g', NVIDIA_API_KEY: 'n' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-img',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'a cat' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-degraded-mode')).toBe('true');

    const body = (await res.json()) as {
      degraded: boolean;
      x_gateway: { provider: string; attempts: number };
    };
    expect(body.degraded).toBe(true);
    expect(body.x_gateway.provider).toBe('nvidia');
    expect(body.x_gateway.attempts).toBe(3);
    expect(geminiImageMock.mock.calls.length).toBe(2);
    expect(nvidiaImageMock).toHaveBeenCalledOnce();
  });

  it('does NOT fall back on input_nonretriable (400) error — fails immediately', async () => {
    // First provider throws a 400 — non-retriable.
    geminiImageMock.mockRejectedValueOnce(Object.assign(new Error('bad prompt'), { status: 400 }));

    const { env } = makeTestEnv({ GEMINI_API_KEY: 'g', NVIDIA_API_KEY: 'n' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-img',
        'x-gateway-force-provider': 'gemini',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'bad' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe('input_nonretriable');
    expect(body.error.message).toContain('bad prompt');
    // nvidia should NOT have been called — non-retriable stops the fan-out.
    expect(nvidiaImageMock).not.toHaveBeenCalled();
  });

  it('returns 429 when all providers hit rate limits (usage_retriable)', async () => {
    geminiImageMock.mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 }));
    nvidiaImageMock.mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 }));

    const { env } = makeTestEnv({ GEMINI_API_KEY: 'g', NVIDIA_API_KEY: 'n' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-img',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'test' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(429);
    const body = (await res.json()) as {
      error: { type: string; cost_budget: { attempts: number } };
    };
    expect(body.error.type).toBe('usage_retriable');
    expect(body.error.cost_budget.attempts).toBeGreaterThan(0);
  });

  it('includes cost_budget in error response when all providers fail', async () => {
    togetherImageMock.mockRejectedValue(new Error('upstream down'));

    const { env } = makeTestEnv({ TOGETHER_API_KEY: 'k' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-img',
        'x-gateway-force-provider': 'together',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'test' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      error: { cost_budget: { attempts: number; totalTimeoutMs: number } };
    };
    expect(body.error.cost_budget).toBeDefined();
    expect(body.error.cost_budget.attempts).toBeGreaterThanOrEqual(1);
    expect(body.error.cost_budget.totalTimeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it('does not set degraded label on first-provider success', async () => {
    geminiImageMock.mockResolvedValueOnce({
      created: 1,
      data: [{ url: 'https://img.example/out.png' }],
    });

    const { env } = makeTestEnv({ GEMINI_API_KEY: 'g' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-img',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'a cat' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-degraded-mode')).toBeNull();
    const body = (await res.json()) as { degraded: boolean };
    expect(body.degraded).toBe(false);
  });

  it('does not amplify 5xx into unbounded retry (max 3 attempts)', async () => {
    // All providers return 500 — retriable, but the cost budget caps at 3 attempts.
    geminiImageMock.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));
    nvidiaImageMock.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));

    const { env } = makeTestEnv({ GEMINI_API_KEY: 'g', NVIDIA_API_KEY: 'n' });
    const req = new Request('https://gateway.test/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        'x-gateway-project-id': 'proj-img',
      },
      body: JSON.stringify({ model: 'auto', prompt: 'test' }),
    });

    const res = await app.fetch(req, env, makeCtx());
    // Should terminate, not hang.
    expect([429, 502]).toContain(res.status);
    // Total attempts across all providers should be at most 3.
    const totalCalls = geminiImageMock.mock.calls.length + nvidiaImageMock.mock.calls.length;
    expect(totalCalls).toBeLessThanOrEqual(3);
  });
});
