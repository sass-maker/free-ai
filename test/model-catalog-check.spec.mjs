import { describe, expect, it, vi } from 'vitest';

import {
  buildRegistryReport,
  fetchCatalogs,
  parseConfigModels,
} from '../scripts/check-model-ids.mjs';

describe('model catalog checker', () => {
  it('parses only the text registry', () => {
    const source = `
      const DEFAULT_MODELS: ModelCandidate[] = [
        { id: 'chat', provider: 'groq', model: 'chat-model' },
      ];
      const DEFAULT_LIMITS: Record<string, ProviderLimitConfig> = {};
      const IMAGE_MODELS = [
        { id: 'image', provider: 'workers_ai', model: 'image-model' },
      ];
    `;

    expect(parseConfigModels(source)).toEqual([
      { id: 'chat', provider: 'groq', model: 'chat-model' },
    ]);
  });

  it('never marks models stale when a catalog is unavailable', () => {
    const report = buildRegistryReport(
      [{ id: 'chat', provider: 'groq', model: 'configured-model' }],
      [
        {
          provider: 'groq',
          status: 'missing_key',
          reason: 'GROQ_API_KEY is not configured',
          all: new Set(),
          addable: new Set(),
        },
      ]
    );

    expect(report.stale).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.summary.incompleteCatalogs).toBe(1);
    expect(report.summary.credentialGaps).toBe(1);
    expect(report.summary.catalogErrors).toBe(0);
  });

  it('reports stale and newly discoverable models only from a successful catalog', () => {
    const report = buildRegistryReport(
      [{ id: 'old', provider: 'groq', model: 'old-model' }],
      [
        {
          provider: 'groq',
          status: 'ok',
          reason: null,
          all: new Set(['new-model']),
          addable: new Set(['new-model']),
        },
      ]
    );

    expect(report.stale).toEqual([{ id: 'old', provider: 'groq', model: 'old-model' }]);
    expect(report.new).toEqual([{ provider: 'groq', model: 'new-model' }]);
  });

  it('returns explicit missing-key and malformed-response states', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ unexpected: [] }));
    const catalogs = await fetchCatalogs({}, fetchImpl);

    expect(catalogs.find((catalog) => catalog.provider === 'groq')?.status).toBe('missing_key');
    expect(catalogs.find((catalog) => catalog.provider === 'workers_ai')?.status).toBe(
      'unsupported'
    );
    expect(catalogs.find((catalog) => catalog.provider === 'openrouter')).toMatchObject({
      status: 'error',
      reason: 'catalog response did not contain a model array',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('separates attempted catalog failures from credential coverage gaps', () => {
    const report = buildRegistryReport(
      [],
      [
        {
          provider: 'groq',
          status: 'missing_key',
          reason: 'GROQ_API_KEY is not configured',
          all: new Set(),
          addable: new Set(),
        },
        {
          provider: 'gemini',
          status: 'error',
          reason: 'catalog returned HTTP 400',
          all: new Set(),
          addable: new Set(),
        },
      ]
    );

    expect(report.summary).toMatchObject({
      incompleteCatalogs: 2,
      credentialGaps: 1,
      catalogErrors: 1,
    });
  });
});
