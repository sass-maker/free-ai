import { describe, expect, it } from 'vitest';

import { runEmbeddingModelCatalogSmoke } from '../scripts/smoke-embedding-models.mjs';

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('embedding model catalog smoke', () => {
  it('passes when the required embedding model is enabled', async () => {
    const report = await runEmbeddingModelCatalogSmoke({
      baseUrl: 'https://gateway.test',
      model: 'gemini-embedding-001',
      fetchImpl: async (url: RequestInfo | URL) => {
        expect(String(url)).toBe('https://gateway.test/v1/models');
        return jsonResponse({
          data: [
            {
              id: 'gemini-embedding-001',
              type: 'embedding',
              provider: 'gemini',
              dimensions: 1536,
              supports_dimensions: true,
              enabled: true,
              aliases: ['text-embedding-3-small', 'text-embedding-3-large'],
              priority: 0.95,
            },
          ],
        });
      },
    });

    expect(report).toMatchObject({
      ok: true,
      embedding_model_count: 1,
      selected: {
        id: 'gemini-embedding-001',
        provider: 'gemini',
        dimensions: 1536,
        supports_dimensions: true,
        enabled: true,
        aliases: ['text-embedding-3-small', 'text-embedding-3-large'],
        priority: 0.95,
      },
    });
  });

  it('matches aliases for OpenAI-compatible embedding names', async () => {
    const report = await runEmbeddingModelCatalogSmoke({
      baseUrl: 'https://gateway.test',
      model: 'text-embedding-3-small',
      fetchImpl: async () =>
        jsonResponse({
          data: [
            {
              id: 'gemini-embedding-001',
              type: 'embedding',
              provider: 'gemini',
              dimensions: 1536,
              enabled: true,
              aliases: ['text-embedding-3-small'],
            },
          ],
        }),
    });

    expect(report.ok).toBe(true);
    expect(report.selected?.id).toBe('gemini-embedding-001');
    expect(report.selected?.aliases).toContain('text-embedding-3-small');
  });

  it('fails when the required embedding model is disabled by provider availability', async () => {
    const report = await runEmbeddingModelCatalogSmoke({
      baseUrl: 'https://gateway.test',
      model: 'voyage-3.5-lite',
      fetchImpl: async () =>
        jsonResponse({
          data: [
            {
              id: 'voyage-3.5-lite',
              type: 'embedding',
              provider: 'voyage_ai',
              dimensions: 1024,
              enabled: false,
            },
          ],
        }),
    });

    expect(report).toMatchObject({
      ok: false,
      error: 'embedding model is disabled',
      selected: {
        id: 'voyage-3.5-lite',
        enabled: false,
      },
    });
  });

  it('fails when the deployed catalog has no embedding rows', async () => {
    const report = await runEmbeddingModelCatalogSmoke({
      baseUrl: 'https://gateway.test',
      model: 'gemini-embedding-001',
      fetchImpl: async () =>
        jsonResponse({
          data: [{ id: 'gemini-2.5-flash', type: 'chat', provider: 'gemini' }],
        }),
    });

    expect(report).toMatchObject({
      ok: false,
      embedding_model_count: 0,
      selected: null,
      error: 'no embedding models returned',
    });
  });
});
