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
    const res = await app.fetch(chatRequest({ 'x-api-key': 'secret-key' }, { project_id: '' }), env, makeCtx());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.not.toMatchObject({
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
  it('rejects requests without a Bearer token', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const res = await app.fetch(analyticsRequest(), env, makeCtx());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'invalid_api_key' },
    });
  });

  it('rejects requests with an incorrect token', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const res = await app.fetch(
      analyticsRequest({ authorization: 'Bearer wrong-key' }),
      env,
      makeCtx(),
    );

    expect(res.status).toBe(401);
  });

  it('allows requests with the correct Bearer token', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: 'secret-key' });
    const res = await app.fetch(
      analyticsRequest({ authorization: 'Bearer secret-key' }),
      env,
      makeCtx(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      total_requests: expect.any(Number),
    });
  });

  it('fails closed (503) when GATEWAY_API_KEY is not configured', async () => {
    const { env } = makeTestEnv({ GATEWAY_API_KEY: '' });
    const res = await app.fetch(analyticsRequest(), env, makeCtx());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'auth_not_configured' },
    });
  });
});
