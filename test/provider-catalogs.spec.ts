import { afterEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

vi.mock('../src/lib/telemetry', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  capture: vi.fn(),
}));

const request = (authorization = 'Bearer test-gateway-key') =>
  new Request('https://gateway.test/v1/provider-catalogs/mistral', {
    headers: { authorization },
  });

function environment(options: { key?: string; gatewayKey?: string; deny?: boolean } = {}) {
  const { env } = makeTestEnv({
    GATEWAY_API_KEY: options.gatewayKey,
    rateLimitDeny: options.deny,
  });
  return { ...env, MISTRAL_API_KEY: options.key ?? 'worker-provider-key' };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Worker-backed Mistral catalog', () => {
  it.each([
    ['no bearer', '', undefined, 401],
    ['invalid bearer', 'Bearer wrong', undefined, 401],
    ['unconfigured auth', 'Bearer test-gateway-key', '', 503],
  ])(
    'rejects %s before contacting the provider',
    async (_name, authorization, gatewayKey, status) => {
      const upstream = vi.fn();
      vi.stubGlobal('fetch', upstream);
      const response = await app.fetch(
        request(authorization),
        environment({ gatewayKey }),
        makeCtx()
      );
      expect(response.status).toBe(status);
      expect(upstream).not.toHaveBeenCalled();
    }
  );

  it('retains the normal rate limit', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(), environment({ deny: true }), makeCtx());
    expect(response.status).toBe(429);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('reports a missing Worker binding without contacting the provider', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(request(), environment({ key: ' , ' }), makeCtx());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'provider_not_configured' } });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('fetches the complete upstream catalog with the Worker key and returns IDs only', async () => {
    const upstream = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          {
            id: 'codestral-latest',
            description: 'private metadata',
            api_key: 'worker-provider-key',
          },
          { id: 'mistral-small-latest' },
          { id: 'codestral-latest' },
        ],
        api_key: 'worker-provider-key',
      })
    );
    vi.stubGlobal('fetch', upstream);
    const response = await app.fetch(
      request(),
      environment({ key: '  worker-provider-key, second-key  ' }),
      makeCtx()
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      data: [{ id: 'codestral-latest' }, { id: 'mistral-small-latest' }],
    });
    expect(upstream).toHaveBeenCalledExactlyOnceWith('https://api.mistral.ai/v1/models', {
      headers: { Authorization: 'Bearer worker-provider-key' },
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([302, 401, 429, 503])(
    'fails closed on upstream HTTP %s without forwarding bodies or redirects',
    async (status) => {
      const upstream = vi.fn().mockResolvedValue(
        new Response('worker-provider-key', {
          status,
          headers: { location: 'https://other.test/steal' },
        })
      );
      vi.stubGlobal('fetch', upstream);
      const response = await app.fetch(request(), environment(), makeCtx());
      expect(response.status).toBe(502);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.json()).toEqual({
        error: { code: 'catalog_upstream_error', upstream_status: status },
      });
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    { unexpected: [] },
    { data: [] },
    { data: [{ id: 'valid' }, {}] },
    { data: [{ id: 'invalid model' }] },
    { data: Array.from({ length: 5001 }, () => ({ id: 'valid' })) },
  ])('rejects incomplete or malformed catalogs instead of returning partial IDs', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    const response = await app.fetch(request(), environment(), makeCtx());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'catalog_unavailable' } });
  });

  it('bounds the streamed body even without a content-length header', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024 + 1));
      },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const response = await app.fetch(request(), environment(), makeCtx());
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: { code: 'catalog_unavailable' } });
  });

  it('does not expose fetch exception messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('worker-provider-key')));
    const response = await app.fetch(request(), environment(), makeCtx());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'catalog_unavailable' } });
  });

  it('sets a bounded upstream deadline', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          })
      )
    );
    const pending = app.fetch(request(), environment(), makeCtx());
    // Allow authentication and rate-limit middleware to finish before advancing.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled(), { interval: 1 });
    expect(timeout).toHaveBeenCalledWith(8000);
    deadline.abort();
    const response = await pending;
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'catalog_unavailable' } });
  });
});
