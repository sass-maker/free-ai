import { describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

function chatRequest(headers: HeadersInit = {}, bodyOverrides: Record<string, unknown> = {}) {
  return new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      model: 'auto',
      project_id: 'auth-test',
      messages: [{ role: 'user', content: 'hello' }],
      ...bodyOverrides,
    }),
  });
}

describe('/v1 authentication', () => {
  it('requires the gateway key for Vectorize budget status', async () => {
    const configured = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const deniedFetch = vi.fn(async () => Response.json({}));
    Object.assign(configured.env, {
      NEURON_BUDGET: {
        idFromName: () => ({}),
        get: () => ({ fetch: deniedFetch }),
      },
    });
    const unauthorized = await app.fetch(
      new Request('https://gateway.test/v1/budget/vectorize'),
      configured.env,
      makeCtx()
    );

    expect(unauthorized.status).toBe(401);
    expect(deniedFetch).not.toHaveBeenCalled();
    await expect(unauthorized.json()).resolves.toMatchObject({
      error: { code: 'invalid_api_key' },
    });

    const unconfigured = makeTestEnv({ GATEWAY_API_KEY: '' });
    const unavailable = await app.fetch(
      new Request('https://gateway.test/v1/budget/vectorize'),
      unconfigured.env,
      makeCtx()
    );

    expect(unavailable.status).toBe(503);
    expect(deniedFetch).not.toHaveBeenCalled();
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: 'auth_not_configured' },
    });
  });

  it('returns aggregate Vectorize budget status to an authenticated gateway client', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const budgetFetch = vi.fn(async () =>
      Response.json({
        monthKey: '2026-10',
        query: {
          state: 'available',
          initialized: false,
          source: 'verified_monthly_baseline',
          used: 35_000_000,
          cap: 45_000_000,
          remaining: 10_000_000,
          baselineVerified: true,
        },
        storage: {
          state: 'available',
          initialized: false,
          source: 'verified_monthly_baseline',
          used: 30_000_000,
          cap: 200_000_000,
          remaining: 170_000_000,
          baselineVerified: true,
        },
      })
    );
    const authenticatedEnv = Object.assign(env, {
      NEURON_BUDGET: {
        idFromName: () => ({}),
        get: () => ({ fetch: budgetFetch }),
      },
    });
    const response = await app.fetch(
      new Request('https://gateway.test/v1/budget/vectorize', {
        headers: { authorization: 'Bearer secret-key' },
      }),
      authenticatedEnv,
      makeCtx()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      monthKey: '2026-10',
      query: { used: 35_000_000, remaining: 10_000_000, initialized: false },
      storage: { used: 30_000_000, remaining: 170_000_000, initialized: false },
    });
    expect(budgetFetch).toHaveBeenCalledWith('https://internal.local/vectorize-usage');
  });

  it('marks unavailable Vectorize budget status as non-cacheable', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const authenticatedEnv = Object.assign(env, {
      NEURON_BUDGET: {
        idFromName: () => ({}),
        get: () => ({ fetch: vi.fn(async () => new Response('unavailable', { status: 503 })) }),
      },
    });
    const response = await app.fetch(
      new Request('https://gateway.test/v1/budget/vectorize', {
        headers: { authorization: 'Bearer secret-key' },
      }),
      authenticatedEnv,
      makeCtx()
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed on token-spending routes when GATEWAY_API_KEY is missing', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: '' });
    const res = await app.fetch(chatRequest(), env, makeCtx());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'auth_not_configured' },
    });
  });

  it('does not allow public x-gateway-internal to bypass API key auth', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const res = await app.fetch(chatRequest({ 'x-gateway-internal': '1' }), env, makeCtx());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'invalid_api_key' },
    });
  });

  it('accepts x-api-key as an alternative to Bearer auth', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const res = await app.fetch(
      chatRequest({ 'x-api-key': 'secret-key' }, { project_id: '' }),
      env,
      makeCtx()
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.not.toMatchObject({
      error: { code: 'invalid_api_key' },
    });
  });

  it('accepts additional hashed gateway API keys', async () => {
    const { env } = makeTestEnv({
      GATEWAY_API_KEY: 'legacy-key',
      GATEWAY_API_KEY_HASHES:
        'test-secondary:7964817d0f3d4ec2eb13f3671edd285fbef0a9d3e5d8f2bf426f4540e5954c1e',
    });
    const res = await app.fetch(
      chatRequest({ authorization: 'Bearer secondary-key' }, { project_id: '' }),
      env,
      makeCtx()
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.not.toMatchObject({
      error: { code: 'invalid_api_key' },
    });
  });

  it('accepts hash-only auth when the legacy key is absent', async () => {
    const { env } = makeTestEnv({
      GATEWAY_API_KEY: '',
      GATEWAY_API_KEY_HASHES: '7964817d0f3d4ec2eb13f3671edd285fbef0a9d3e5d8f2bf426f4540e5954c1e',
    });
    const res = await app.fetch(
      chatRequest({ authorization: 'Bearer secondary-key' }, { project_id: '' }),
      env,
      makeCtx()
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.not.toMatchObject({
      error: { code: 'auth_not_configured' },
    });
  });

  it('rejects requests when the hash ring does not contain the provided key', async () => {
    const { env } = makeTestEnv({
      GATEWAY_API_KEY: '',
      GATEWAY_API_KEY_HASHES: '7964817d0f3d4ec2eb13f3671edd285fbef0a9d3e5d8f2bf426f4540e5954c1e',
    });
    const res = await app.fetch(chatRequest({ authorization: 'Bearer wrong-key' }), env, makeCtx());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'invalid_api_key' },
    });
  });
});

const TOKEN_SPENDING_ROUTES: Array<{
  method: string;
  path: string;
  body?: Record<string, unknown>;
}> = [
  {
    method: 'POST',
    path: '/v1/chat/completions',
    body: { model: 'auto', project_id: 'p', messages: [{ role: 'user', content: 'hi' }] },
  },
  {
    method: 'POST',
    path: '/v1/responses',
    body: { model: 'auto', project_id: 'p', input: 'hi' },
  },
  {
    method: 'POST',
    path: '/v1/embeddings',
    body: { model: 'gemini-embedding-001', input: 'hi', project_id: 'p' },
  },
  {
    method: 'POST',
    path: '/v1/images/generations',
    body: { model: 'auto', prompt: 'hi', project_id: 'p' },
  },
  {
    method: 'POST',
    path: '/v1/videos/generations',
    body: { model: 'auto', prompt: 'hi', project_id: 'p' },
  },
  { method: 'GET', path: '/v1/videos/generations/job-1' },
  {
    method: 'POST',
    path: '/v1/audio/speech',
    body: { model: 'auto', input: 'hi', project_id: 'p' },
  },
  { method: 'POST', path: '/v1/audio/transcriptions' },
  { method: 'POST', path: '/v1/audio/speech-to-speech' },
  {
    method: 'POST',
    path: '/v1/debug/replay',
    body: { model: 'auto', project_id: 'p', messages: [{ role: 'user', content: 'hi' }] },
  },
];

function routeRequest(
  route: { method: string; path: string; body?: Record<string, unknown> },
  headers: HeadersInit = {}
) {
  return new Request(`https://gateway.test${route.path}`, {
    method: route.method,
    headers: {
      ...(route.body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(route.body ? { body: JSON.stringify(route.body) } : {}),
  });
}

describe('token-spending routes fail closed', () => {
  it.each(TOKEN_SPENDING_ROUTES)(
    '$method $path rejects a wrong key with 401 before any provider work',
    async (route) => {
      const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
      const res = await app.fetch(
        routeRequest(route, { authorization: 'Bearer wrong-key' }),
        env,
        makeCtx()
      );

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: 'invalid_api_key' },
      });
    }
  );

  it.each(TOKEN_SPENDING_ROUTES)(
    '$method $path returns 503 when no gateway key is configured',
    async (route) => {
      const { env } = makeTestEnv({ GATEWAY_API_KEY: '' });
      const res = await app.fetch(
        routeRequest(route, { authorization: 'Bearer test-gateway-key' }),
        env,
        makeCtx()
      );

      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: 'auth_not_configured' },
      });
    }
  );
});

function analyticsRequest(headers: HeadersInit = {}) {
  return new Request('https://gateway.test/v1/analytics?days=7', {
    method: 'GET',
    headers,
  });
}

describe('/v1/analytics authentication', () => {
  it('allows requests without a Bearer token', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const res = await app.fetch(analyticsRequest(), env, makeCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      total_requests: expect.any(Number),
    });
  });

  it('ignores incorrect tokens on the public analytics endpoint', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const res = await app.fetch(
      analyticsRequest({ authorization: 'Bearer wrong-key' }),
      env,
      makeCtx()
    );

    expect(res.status).toBe(200);
  });

  it('stays public when GATEWAY_API_KEY is not configured', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: '' });
    const res = await app.fetch(analyticsRequest(), env, makeCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      total_requests: expect.any(Number),
    });
  });
});
