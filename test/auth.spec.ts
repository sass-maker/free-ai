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
