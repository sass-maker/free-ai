import { describe, expect, it, vi } from 'vitest';

import {
  buildRegistryReport,
  fetchCatalogs,
  parseConfigModels,
} from '../scripts/check-model-ids.mjs';

describe('model catalog checker', () => {
  it('checks every Gemini page before declaring a configured model stale', async () => {
    const requests = [];
    const fetchImpl = async (input, options) => {
      const url = new URL(input);
      if (url.hostname === 'openrouter.ai') return Response.json({ data: [] });
      requests.push(url);
      expect(url.origin).toBe('https://generativelanguage.googleapis.com');
      expect(options.headers).toEqual({ 'x-goog-api-key': 'synthetic-test-key' });
      expect(url.searchParams.has('key')).toBe(false);
      return Response.json(
        url.searchParams.has('pageToken')
          ? { models: [{ name: 'models/gemini-later-page' }] }
          : { models: [{ name: 'models/gemini-first-page' }], nextPageToken: 'next+/=&page' }
      );
    };
    const catalogs = await fetchCatalogs({ GEMINI_API_KEY: 'synthetic-test-key' }, fetchImpl);
    const report = buildRegistryReport(
      [{ id: 'later', provider: 'gemini', model: 'gemini-later-page' }],
      catalogs
    );
    expect(report.stale).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(requests[1].searchParams.get('pageToken')).toBe('next+/=&page');
    expect(catalogs.find((catalog) => catalog.provider === 'gemini').all).toEqual(
      new Set(['gemini-first-page', 'gemini-later-page'])
    );
  });

  it.each([
    ['HTTP failure', () => new Response(null, { status: 503 }), 'catalog returned HTTP 503'],
    [
      'malformed page',
      () => Response.json({ unexpected: [] }),
      'catalog response did not contain a model array',
    ],
    [
      'repeated token',
      () => Response.json({ models: [], nextPageToken: 'next' }),
      'catalog pagination token was invalid or repeated',
    ],
    [
      'invalid token',
      () => Response.json({ models: [], nextPageToken: { next: 'page' } }),
      'catalog pagination token was invalid or repeated',
    ],
    [
      'timeout',
      () => {
        throw new Error('Synthetic timeout');
      },
      'Synthetic timeout',
    ],
  ])('discards partial Gemini results after %s', async (_name, secondPage, reason) => {
    const signals = [];
    const catalogs = await fetchCatalogs(
      { GEMINI_API_KEY: 'synthetic-test-key' },
      async (input, options) => {
        const url = new URL(input);
        if (url.hostname === 'openrouter.ai') return Response.json({ data: [] });
        signals.push(options.signal);
        if (url.searchParams.has('pageToken')) return secondPage();
        return Response.json({
          models: [{ name: 'models/gemini-first-page' }],
          nextPageToken: 'next',
        });
      }
    );
    const gemini = catalogs.find((catalog) => catalog.provider === 'gemini');
    expect(gemini).toMatchObject({ status: 'error', reason, all: new Set(), addable: new Set() });
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    const report = buildRegistryReport(
      [{ id: 'later', provider: 'gemini', model: 'gemini-later-page' }],
      catalogs
    );
    expect(report.stale).toEqual([]);
    expect(report.new).toEqual([]);
    expect(report.skipped).toHaveLength(1);
  });

  it('bounds unique pagination tokens and never treats a capped catalog as complete', async () => {
    let pages = 0;
    const catalogs = await fetchCatalogs(
      { GEMINI_API_KEY: 'synthetic-test-key' },
      async (input) => {
        if (new URL(input).hostname === 'openrouter.ai') return Response.json({ data: [] });
        pages += 1;
        return Response.json({
          models: [{ name: `models/gemini-page-${pages}` }],
          nextPageToken: `page-${pages}`,
        });
      }
    );
    expect(pages).toBe(20);
    expect(catalogs.find((catalog) => catalog.provider === 'gemini')).toMatchObject({
      status: 'error',
      reason: 'catalog pagination exceeded the 20-page safety limit',
      all: new Set(),
      addable: new Set(),
    });
  });

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

  it('surfaces a bounded provider excerpt on catalog HTTP failures', async () => {
    const catalogs = await fetchCatalogs(
      { GEMINI_API_KEY: 'synthetic-test-key' },
      async (input) => {
        if (new URL(input).hostname === 'openrouter.ai') return Response.json({ data: [] });
        return new Response(
          '{"error":{"code":400,"message":"API key not valid.   Please pass a valid API key."}}',
          { status: 400 }
        );
      }
    );
    const gemini = catalogs.find((catalog) => catalog.provider === 'gemini');
    expect(gemini.status).toBe('error');
    expect(gemini.reason).toBe(
      'catalog returned HTTP 400: {"error":{"code":400,"message":"API key not valid. Please pass a valid API key."}}'
    );
  });

  it('scrubs the credential and bounds long error excerpts', async () => {
    const catalogs = await fetchCatalogs(
      { GEMINI_API_KEY: 'synthetic-test-key' },
      async (input) => {
        if (new URL(input).hostname === 'openrouter.ai') return Response.json({ data: [] });
        return new Response(`denied synthetic-test-key ${'x'.repeat(500)}`, { status: 403 });
      }
    );
    const gemini = catalogs.find((catalog) => catalog.provider === 'gemini');
    expect(gemini.reason).not.toContain('synthetic-test-key');
    expect(gemini.reason).toContain('denied ***');
    expect(gemini.reason.length).toBeLessThanOrEqual(275);
  });

  it('treats whitespace-only and padded secrets consistently', async () => {
    const seen = [];
    const fetchImpl = async (input, options) => {
      const url = new URL(input);
      if (url.hostname === 'openrouter.ai') return Response.json({ data: [] });
      if (url.hostname === 'generativelanguage.googleapis.com') {
        seen.push(options.headers['x-goog-api-key']);
        return Response.json({ models: [{ name: 'models/gemini-1' }] });
      }
      return Response.json({ data: [] });
    };
    const padded = await fetchCatalogs({ GEMINI_API_KEY: '  padded-key\n' }, fetchImpl);
    expect(padded.find((catalog) => catalog.provider === 'gemini').status).toBe('ok');
    expect(seen).toEqual(['padded-key']);

    const blank = await fetchCatalogs({ GEMINI_API_KEY: '   ' }, fetchImpl);
    expect(blank.find((catalog) => catalog.provider === 'gemini').status).toBe('missing_key');
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
