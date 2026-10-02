import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Execute the page's actual script with a minimal DOM and synthetic GET data.
// Browser layout and deployed-site acceptance are separate checks.
it('renders measured and unknown metrics and recovers after a failed refresh', async () => {
  const source = readFileSync('site/src/pages/status.astro', 'utf8');
  const view = source.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const helpers = readFileSync('site/src/lib/provider-stats.ts', 'utf8');
  const script = ts.transpileModule(
    helpers.replace(/^export /gm, '') + view.replace(/import .*?from .*?;/, ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText;
  let state = 'populated';
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id))
        elements.set(id, {
          innerHTML: '',
          textContent: '',
          addEventListener(_type, fn) {
            this.click = fn;
          },
        });
      return elements.get(id);
    },
  };
  runInNewContext(script, {
    document,
    Intl,
    Date,
    console: { error() {} },
    setInterval() {},
    async fetch(url) {
      expect(['/v1/models', '/v1/stats/providers']).toContain(url);
      return {
        ok: state !== 'error',
        status: state === 'error' ? 503 : 200,
        async json() {
          if (url === '/v1/models') return { data: [] };
          if (state === 'unknown') return undefined;
          if (state === 'malformed') return { stats: [null, { provider: '' }] };
          if (state === 'partial')
            return { stats: [{ provider: 'fixture', total_attempts: 3, success_rate: 0 }, null] };
          return {
            stats:
              state === 'empty'
                ? []
                : [
                    {
                      provider: 'fixture',
                      total_models: 3,
                      active_models: 2,
                      total_attempts: 100,
                      success_rate: 0.9,
                      avg_latency_ms: 320,
                    },
                    {
                      provider: 'unused',
                      total_models: 1,
                      active_models: 0,
                      total_attempts: 0,
                      success_rate: 0,
                      avg_latency_ms: 0,
                    },
                    { provider: 'unknown', total_attempts: 5 },
                  ],
            quotas: {},
          };
        },
      };
    },
  });
  const status = () => elements.get('status-text').textContent;
  const table = () => elements.get('providers-tbody').innerHTML;
  expect(status()).toBe('Fetching…');
  await expect.poll(status).toBe('Live');
  const cells = (name) =>
    table().match(new RegExp(`<tr>\\s*<td[^>]*>${name}</td>([\\s\\S]*?)</tr>`))[1];
  expect(cells('fixture')).toContain('2 / 3');
  expect(cells('fixture')).toContain('90.0%');
  expect(cells('fixture')).toContain('320 ms');
  expect(cells('unknown')).toContain('— / —');
  expect(cells('unknown')).not.toContain('0.0%');
  expect(cells('unknown')).not.toContain('0 ms');
  expect(cells('unused')).toContain('0 / 1');
  expect(cells('unused')).not.toContain('0.0%');
  expect(elements.get('stats-grid').innerHTML).toContain(
    'Overall success</div>\n            <div class="value">—'
  );
  const retained = table();
  state = 'error';
  elements.get('refresh-btn').click();
  await expect.poll(status).toContain('Error:');
  expect(table()).toBe(retained);
  state = 'empty';
  elements.get('refresh-btn').click();
  await expect.poll(status).toBe('Live');
  expect(table()).toContain('No provider stats yet');
  for (const value of ['unknown', 'malformed']) {
    state = value;
    elements.get('refresh-btn').click();
    await expect.poll(status).toBe('Provider stats unavailable');
    expect(table()).toContain('response missing or invalid');
    expect(table()).not.toContain('No provider stats yet');
    expect(elements.get('stats-grid').innerHTML).toContain('<div class="value">—');
  }
  state = 'partial';
  elements.get('refresh-btn').click();
  await expect.poll(status).toBe('Partial provider stats');
  expect(table()).toContain('fixture');
  expect(table()).toContain('0.0%');
  expect(table()).toContain('totals are unavailable');
  state = 'populated';
  elements.get('refresh-btn').click();
  await expect.poll(status).toBe('Live');
  await expect.poll(table).toContain('fixture');
  expect(status()).toBe('Live');
});
