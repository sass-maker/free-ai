import { describe, expect, it } from 'vitest';

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
