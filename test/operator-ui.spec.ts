import { describe, expect, it } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

async function fetchRoute(path: string, headers: HeadersInit = {}) {
  const { env } = makeTestEnv();
  return app.fetch(new Request(`https://gateway.test${path}`, { headers }), env, makeCtx());
}

async function fetchRouteWithEnv(
  path: string,
  overrides: Parameters<typeof makeTestEnv>[0],
  headers: HeadersInit = {}
) {
  const { env } = makeTestEnv(overrides);
  return app.fetch(new Request(`https://gateway.test${path}`, { headers }), env, makeCtx());
}

describe('Operator browser UI routes', () => {
  it('keeps /health JSON as the default API response', async () => {
    const res = await fetchRoute('/health');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body = (await res.json()) as { ok: boolean; models: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.models)).toBe(true);
  });

  it('serves the health dashboard for browser document requests', async () => {
    const res = await fetchRoute('/health', {
      accept: 'text/html,application/xhtml+xml',
      'sec-fetch-dest': 'document',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    expect(res.headers.get('cache-control') ?? '').toContain('no-store');
    const html = await res.text();
    expect(html).toContain('<title>AI Gateway - Health</title>');
    expect(html).toContain('Gateway Health');
    expect(html).toContain("readJson('/health')");
    expect(html).toContain('/v1/routing/status');
    expect(html).toContain('/v1/routing/ledger?days=7');
    expect(html).toContain('href="/benchmark"');
  });

  it('keeps /v1/models JSON as the default API response', async () => {
    const res = await fetchRoute('/v1/models');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body = (await res.json()) as {
      data: Array<{ id: string; provider: string; type: string }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('id');
    expect(body.data[0]).toHaveProperty('provider');
    expect(body.data[0]).toHaveProperty('type');
  });

  it('includes embedding models with dimensions and provider availability', async () => {
    const res = await fetchRouteWithEnv('/v1/models', {
      GEMINI_API_KEY: 'gemini-test-key',
      VOYAGE_API_KEY: 'voyage-test-key',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_WORKERS_AI_API_KEY: 'workers-ai-key',
      WORKERS_AI_ENABLED: 'true',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        type: string;
        provider: string;
        dimensions?: number;
        aliases?: string[];
        supports_dimensions?: boolean;
        enabled: boolean;
      }>;
    };
    const embeddings = body.data.filter((model) => model.type === 'embedding');

    expect(embeddings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gemini-embedding-001',
          provider: 'gemini',
          dimensions: 1536,
          supports_dimensions: true,
          enabled: true,
          aliases: expect.arrayContaining(['text-embedding-3-small']),
        }),
        expect.objectContaining({
          id: '@cf/baai/bge-small-en-v1.5',
          provider: 'workers_ai',
          dimensions: 384,
          enabled: true,
        }),
        expect.objectContaining({
          id: 'voyage-3.5-lite',
          provider: 'voyage_ai',
          dimensions: 1024,
          enabled: true,
        }),
      ])
    );
  });

  it.each([
    ['/v1/models'],
    ['/models'],
  ])('%s serves the searchable catalog for browser document requests', async (path) => {
    const res = await fetchRoute(path, {
      accept: 'text/html,application/xhtml+xml',
      'sec-fetch-dest': 'document',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<title>AI Gateway - Model Catalog</title>');
    expect(html).toContain('Model Catalog');
    expect(html).toContain('Search model, provider, capability');
    expect(html).toContain("fetch('/v1/models'");
  });

  it('serves /models as JSON for non-browser clients', async () => {
    const res = await fetchRoute('/models', { accept: 'application/json' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);
  });
});
