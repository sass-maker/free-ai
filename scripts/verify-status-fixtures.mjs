import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import ts from 'typescript';

// Root-only rendered acceptance command; no server, credentials or real HTTP.
// This source fixture checks layout/script behavior, not Astro build/deployment.
const source = readFileSync('site/src/pages/status.astro', 'utf8');
const view = source.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const helpers = readFileSync('site/src/lib/provider-stats.ts', 'utf8');
const script = ts.transpileModule(
  helpers.replace(/^export /gm, '') + view.replace(/import .*?from .*?;/, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
).outputText;
const html = source
  .replace(/^---[\s\S]*?---/, '')
  .replace(/<script\b[^>]*\/>/g, '')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace('</body>', `<script>${script}</script></body>`);
const output = 'artifacts/status-fixtures';
mkdirSync(output, { recursive: true });
const measured = {
  provider: 'fixture',
  total_models: 3,
  active_models: 2,
  total_attempts: 100,
  success_rate: 0.9,
  avg_latency_ms: 320,
};
const cases = {
  populated: { stats: [measured], quotas: {} },
  empty: { stats: [] },
  unknown: {},
  malformed: { stats: [null, { provider: '' }] },
  partial: { stats: [measured, null] },
  zero: { stats: [{ ...measured, total_attempts: 4, success_rate: 0, avg_latency_ms: 0 }] },
};
const results = [];
async function createFixtureContext(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    serviceWorkers: 'block',
  });
  let state = 'populated';
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let hold = true;
  const blocked = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== 'http://fixture.invalid') {
      blocked.push({ method: request.method(), url: request.url() });
      return route.abort();
    }
    if (url.pathname === '/status/') return route.fulfill({ contentType: 'text/html', body: html });
    if (!['/v1/models', '/v1/stats/providers'].includes(url.pathname)) return route.abort();
    if (hold) await pending;
    if (state === 'failure') return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: url.pathname === '/v1/models' ? { data: [] } : cases[state] });
  });
  const page = await context.newPage();
  return {
    context,
    page,
    blocked,
    setState(next) {
      state = next;
    },
    releaseRequests() {
      hold = false;
      release();
    },
  };
}

async function measureGeometry(page) {
  return page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    links: [...document.querySelectorAll('.nav a')].map((link) => {
      const rect = link.getBoundingClientRect();
      return { text: link.textContent.trim(), left: rect.left, right: rect.right };
    }),
  }));
}

test('network-isolated status fixtures at mobile, tablet and desktop widths', async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.STATUS_FIXTURE_BROWSER_CHANNEL || undefined,
  });
  try {
    for (const width of [390, 768, 1440]) {
      const fixture = await createFixtureContext(browser, width);
      const { context, page, blocked } = fixture;
      await page.goto('http://fixture.invalid/status/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.querySelector('#status-text').textContent === 'Fetching…'
      );
      await page.screenshot({ path: `${output}/loading-${width}.png` });
      fixture.releaseRequests();
      for (const next of [
        'populated',
        'empty',
        'unknown',
        'malformed',
        'partial',
        'zero',
        'failure',
        'populated',
      ]) {
        fixture.setState(next);
        if (results.some((result) => result.width === width))
          await page.locator('#refresh-btn').click();
        const expected =
          next === 'failure'
            ? 'Error:'
            : ['unknown', 'malformed'].includes(next)
              ? 'Provider stats unavailable'
              : next === 'partial'
                ? 'Partial provider stats'
                : 'Live';
        await page.waitForFunction(
          (text) => document.querySelector('#status-text').textContent.startsWith(text),
          expected
        );
        const table = await page.locator('#providers-tbody').innerText();
        if (next === 'empty') assert.match(table, /No provider stats yet/);
        if (['unknown', 'malformed'].includes(next)) {
          assert.match(table, /response missing or invalid/);
          assert.doesNotMatch(table, /No provider stats yet/);
        }
        if (next === 'populated') {
          assert.match(table, /fixture/);
          assert.match(table, /90.0%/);
        }
        if (next === 'partial') assert.match(table, /totals are unavailable/);
        if (next === 'zero') {
          assert.match(table, /0.0%/);
          assert.match(table, /0 ms/);
        }
        if (next === 'failure') assert.match(table, /fixture/);
        const geometry = await measureGeometry(page);
        assert.equal(geometry.scrollWidth, width);
        assert(geometry.links.every((link) => link.left >= 0 && link.right <= width));
        const capture = `${output}/${results.length}-${next}-${width}.png`;
        await page.screenshot({ path: capture });
        results.push({ width, state: next, table, geometry, capture });
      }
      assert.deepEqual(blocked, [], 'Unexpected outbound requests were blocked');
      await context.close();
    }
    writeFileSync(
      `${output}/results.json`,
      `${JSON.stringify({ mode: 'source-fixture', externalNetworkAllowed: false, results }, null, 2)}\n`
    );
    console.log(`PASS: ${results.length} fixture states at 390/768/1440; evidence in ${output}`);
  } finally {
    await browser.close();
  }
});
