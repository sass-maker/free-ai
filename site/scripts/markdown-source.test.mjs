import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredHtmlToMarkdown, renderPublicPage } from './public-page-markdown.mjs';
import { handleAgentEdge } from '../../src/agent-edge.mjs';

test('authored rich content keeps code whitespace, links and meaningful headings', () => {
  const md = authoredHtmlToMarkdown(
    '<h2>Start</h2><p><a href="/docs">Docs</a></p><div class="code-body"><span>if (ready) {</span>\n  run();\n}</div>'
  );
  assert.match(md, /## Start/);
  assert.match(md, /\[Docs\]\(\/docs\)/);
  assert.match(md, /```\nif \(ready\) \{\n {2}run\(\);\n}\n```/);
});
test('homepage contains authored hero, features and usable code examples', async () => {
  const md = await renderPublicPage('index');
  assert.match(md, /```/);
  assert.match(md, /curl/);
  assert.match(md, /https:\/\/ai-gateway.sassmaker.com/);
  assert.doesNotMatch(md, /__ORIGIN__|<span|<script/);
});
const origin = 'https://ai-gateway.sassmaker.com';
const routes = [
  { path: '/', title: 'Home', description: 'Home', url: `${origin}/`, md: `${origin}/index.md` },
  {
    path: '/status/',
    title: 'Status',
    url: `${origin}/status/`,
    md: `${origin}/status.md`,
    full: false,
  },
];
function assets() {
  return {
    async fetch(request) {
      const p = new URL(request.url).pathname;
      if (p === '/api/md/_identity')
        return Response.json({
          name: 'Free AI',
          url: origin,
          summary: 'Gateway',
          trainingAllowed: true,
        });
      if (p === '/api/md/_catalog') return Response.json(routes);
      if (p === '/index.md')
        return new Response('# Home\n\nSource body', {
          headers: { 'Content-Type': 'text/markdown' },
        });
      return new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } });
    },
  };
}
test('worker public suffix/direct/negotiated forms share canonical content and safe headers', async () => {
  const binding = assets();
  let expected;
  for (const p of ['/index.md', '/api/md', '/']) {
    const r = await handleAgentEdge(
      new Request(origin + p, { headers: { Accept: 'text/markdown' } }),
      binding
    );
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Content-Location'), `${origin}/`);
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const body = await r.text();
    expected ??= body;
    assert.equal(body, expected);
  }
  assert.equal(
    await handleAgentEdge(
      new Request(`${origin}/`, { headers: { Accept: 'text/html;q=1,text/markdown;q=.2' } }),
      binding
    ),
    null
  );
  const head = await handleAgentEdge(
    new Request(`${origin}/index.md`, { method: 'HEAD' }),
    binding
  );
  assert.equal(await head.text(), '');
  const unknown = await handleAgentEdge(new Request(`${origin}/api/md/dashboard`), binding);
  assert.equal(unknown.status, 404);
  assert.equal(
    await handleAgentEdge(
      new Request(`${origin}/v1/models`, { headers: { Accept: 'application/json' } }),
      binding
    ),
    null
  );
});
test('live status is rendered only for registered public paths and never cached', async () => {
  const binding = assets();
  let calls = 0;
  const loader = async (path) => {
    calls++;
    assert.equal(path, '/status/');
    return '# Status\n\nCurrent reading';
  };
  const r = await handleAgentEdge(
    new Request(`${origin}/status.md?secret=ignored`, {
      headers: { Authorization: 'secret', Cookie: 'secret' },
    }),
    binding,
    loader
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(await r.text(), /Current reading/);
  await handleAgentEdge(new Request(`${origin}/api/md/private`), binding, loader);
  assert.equal(calls, 1);
});

test('unknown negotiated pages cannot fall through to the SPA HTML fallback', async () => {
  const binding = assets();
  const missing = await handleAgentEdge(
    new Request(`${origin}/unknown-public-route`, { headers: { Accept: 'text/markdown' } }),
    binding
  );
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('Content-Type'), /text\/markdown/);
  assert.equal(
    await handleAgentEdge(
      new Request(`${origin}/v1/models`, { headers: { Accept: 'text/markdown' } }),
      binding
    ),
    null
  );
  assert.equal(
    await handleAgentEdge(
      new Request(`${origin}/auth/login`, { headers: { Accept: 'text/markdown' } }),
      binding
    ),
    null
  );
  assert.equal(
    await handleAgentEdge(
      new Request(`${origin}/app.js`, { headers: { Accept: 'text/markdown' } }),
      binding
    ),
    null
  );
});
