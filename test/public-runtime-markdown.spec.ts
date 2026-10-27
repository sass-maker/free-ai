import { createHash } from 'node:crypto';
import baseline from './public-runtime-body-baseline.json';
import { DASHBOARD_HTML } from '../src/dashboard-html';
import { OPERATOR_HEALTH_HTML, MODEL_CATALOG_HTML } from '../src/operator-ui-html';
import { BENCHMARK_COST_OPTIMIZER_HTML } from '../src/benchmark-cost-optimizer-html';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import pages from '../src/public-runtime-pages.json';
import { renderRuntimeMarkdown } from '../src/public-runtime-markdown';
import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

const model = {
  id: 'provider/model',
  model: 'model',
  provider: 'provider',
  enabled: true,
  success_rate: 0.9,
  headroom: 1,
  reasoning: 'high',
  context_window: 8192,
  max_output_tokens: 1024,
  tool_calling: true,
  attempts: 10,
  key: 'provider:model',
  daily_used: 2,
  daily_limit: 100,
};
function reader(payloads: Record<string, unknown>, calls: string[]) {
  return async (path: string) => {
    calls.push(path);
    if (!Object.hasOwn(payloads, path)) throw new Error(`Unexpected public read ${path}`);
    return Response.json(payloads[path]);
  };
}
describe('runtime public view projections', () => {
  it('projects the same model source and capability/status functions without hidden fields', async () => {
    const calls: string[] = [];
    const body = await renderRuntimeMarkdown(
      '/models',
      reader({ '/v1/models': { data: [{ ...model, hiddenSecret: 'not-visible' }] } }, calls)
    );
    expect(calls).toEqual(['/v1/models']);
    expect(body).toContain('provider/model (model)');
    expect(body).toContain('ready');
    expect(body).toContain('tools, high reasoning');
    expect(body).not.toContain('not-visible');
  });
  it('uses default anonymous dashboard sources and preserves its hidden empty-state sections', async () => {
    const calls: string[] = [];
    const body = await renderRuntimeMarkdown(
      '/dashboard',
      reader(
        {
          '/health': { models: [] },
          '/v1/stats/providers': { stats: [] },
          '/v1/routing/status': {},
          '/v1/analytics?days=7&group_by=provider': {
            total_requests: 0,
            projects: { privateHidden: { requests: 1 } },
          },
        },
        calls
      )
    );
    expect(calls.sort()).toEqual([
      '/health',
      '/v1/analytics?days=7&group_by=provider',
      '/v1/routing/status',
      '/v1/stats/providers',
    ]);
    expect(body).toContain('No traffic yet');
    expect(body).not.toContain('privateHidden');
    expect(body).not.toContain('Request replay lab');
  });
  it('renders active dashboard charts and table limits as readable source data', async () => {
    const calls: string[] = [];
    const body = await renderRuntimeMarkdown(
      '/dashboard',
      reader(
        {
          '/health': { models: [model] },
          '/v1/stats/providers': { stats: [] },
          '/v1/routing/status': {},
          '/v1/analytics?days=7&group_by=provider': {
            total_requests: 10,
            successful_requests: 9,
            failed_requests: 1,
            success_rate: 0.9,
            providers: { provider: { requests: 10, successful: 9, failed: 1 } },
            projects: { demo: { requests: 10, successful: 9 } },
          },
        },
        calls
      )
    );
    expect(body).toContain('Daily gateway outcomes');
    expect(body).toContain('Daily failure rate');
    expect(body).toContain('No traffic');
    expect(body).toContain('| provider | 10 | 90.0% |');
    expect(body).toContain('| demo | 10 | 90.0% |');
    expect(body).toContain('No replay run is performed');
  });
  it('uses public benchmark fixtures without reading or mutating experiments', async () => {
    const calls: string[] = [];
    const body = await renderRuntimeMarkdown(
      '/benchmark',
      reader(
        {
          '/v1/benchmark/optimizer': {
            fixture_id: 'fixture',
            source: 'local fixture',
            generated_at: '2026-10-26',
            candidates: [],
            workloads: [],
            routes_by_workload: [],
            experiments: [],
          },
        },
        calls
      )
    );
    expect(calls).toEqual(['/v1/benchmark/optimizer']);
    expect(body).toContain('local fixture');
    expect(body).toContain('Browser-local snapshots are private and excluded');
  });
  it('rejects unregistered paths and never inherits query state', async () => {
    const calls: string[] = [];
    expect(
      await renderRuntimeMarkdown('/dashboard?project=secret', reader({}, calls))
    ).toBeUndefined();
    expect(calls).toEqual([]);
  });
  it('covers every explicit operator HTML path or a proven canonical alias', async () => {
    const source = await readFile(new URL('../src/routes/operator-ui.ts', import.meta.url), 'utf8');
    const known = new Set(pages.flatMap((p) => [p.path, `${p.path}/`, ...p.htmlAliases]));
    for (const match of source.matchAll(/app\.(?:get|use)\('([^']+)'/g))
      expect(known.has(match[1]), match[1]).toBe(true);
  });
  it('canonicalizes identical public HTML aliases while preserving JSON representations', async () => {
    const { env } = makeTestEnv();
    const context = makeCtx();
    const get = (path: string, accept = 'text/html') =>
      app.fetch(
        new Request(`https://ai-gateway.sassmaker.com${path}`, { headers: { Accept: accept } }),
        env,
        context
      );
    const canonical = await get('/dashboard'),
      alias = await get('/live');
    const canonicalHtml = await canonical.text(),
      aliasHtml = await alias.text();
    expect(canonicalHtml).not.toContain('name="robots" content="noindex');
    expect(aliasHtml).toContain('name="robots" content="noindex');
    expect(aliasHtml).toContain(
      'rel="canonical" href="https://ai-gateway.sassmaker.com/dashboard"'
    );
    expect(canonicalHtml.slice(canonicalHtml.indexOf('<body>'))).toBe(
      aliasHtml.slice(aliasHtml.indexOf('<body>'))
    );
    expect((await get('/models', 'application/json')).headers.get('content-type')).toContain(
      'application/json'
    );
    expect(await (await get('/v1/models')).text()).toContain('name="robots" content="noindex');
  });
});

it('preserves every authored runtime HTML body while sharing its data code', () => {
  const fixtures = [
    ['src/dashboard-html.ts', { DASHBOARD_HTML }],
    ['src/operator-ui-html.ts', { OPERATOR_HEALTH_HTML, MODEL_CATALOG_HTML }],
    ['src/benchmark-cost-optimizer-html.ts', { BENCHMARK_COST_OPTIMIZER_HTML }],
  ] as const;
  const visible = (html: string) =>
    html.slice(html.indexOf('<body>')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const [, current] of fixtures) {
    for (const [name, html] of Object.entries(current))
      expect(createHash('sha256').update(visible(html)).digest('hex'), name).toBe(
        baseline.hashes[name as keyof typeof baseline.hashes]
      );
  }
});
