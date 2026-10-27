import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

function sourceFixtureAssets() {
  const origin = 'https://ai-gateway.sassmaker.com';
  const routes = ['/about/', '/status/'].map((path) => ({
    path,
    url: origin + path,
    md: origin + path.replace(/\/$/, '') + '.md',
    title: path === '/about/' ? 'About Free AI' : 'Gateway Status',
    assetPath: path.replace(/\/$/, '') + '.md',
  }));
  const documents = new Map([
    [
      '/api/md/_identity',
      JSON.stringify({ name: 'Free AI', url: origin, summary: 'Public gateway information.' }),
    ],
    ['/api/md/_catalog', JSON.stringify(routes)],
    [
      '/about.md',
      '# About Free AI\n\nCanonical: ' + origin + '/about/\n\nPublic gateway information.\n',
    ],
  ]);
  return {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      const body = documents.get(path);
      return body === undefined
        ? new Response('Not found', { status: 404 })
        : new Response(body, {
            headers: { 'Content-Type': path.endsWith('.md') ? 'text/markdown' : 'text/plain' },
          });
    },
  };
}
describe('worker public Markdown integration', () => {
  it('serves registered public sources and keeps actual protected API behavior', async () => {
    const { env } = makeTestEnv();
    Object.assign(env, { ASSETS: sourceFixtureAssets() });
    const origin = 'https://ai-gateway.sassmaker.com';
    let body: string | undefined;
    for (const path of ['/about.md', '/api/md/about', '/about/']) {
      const response = await app.fetch(
        new Request(origin + path, { headers: { Accept: 'text/markdown' } }),
        env,
        makeCtx()
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Location')).toBe(`${origin}/about/`);
      const text = await response.text();
      body ??= text;
      expect(text).toBe(body);
    }
    const html = await app.fetch(
      new Request(`${origin}/dashboard`, { headers: { Accept: 'text/html' } }),
      env,
      makeCtx()
    );
    expect(html.headers.get('Vary')).toContain('Accept');
    expect(html.headers.get('Link')).toContain('rel="describedby"');
    const privateMd = await app.fetch(new Request(`${origin}/api/md/admin`), env, makeCtx());
    expect(privateMd.status).toBe(404);
    const protectedApi = await app.fetch(
      new Request(`${origin}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'auto', messages: [] }),
      }),
      env,
      makeCtx()
    );
    expect(protectedApi.status).toBe(401);
  });
  it('retains the built-in public catalog when asset metadata is HTML or malformed', async () => {
    for (const body of ['<html>SPA fallback</html>', '{invalid']) {
      const { env } = makeTestEnv();
      Object.assign(env, {
        ASSETS: {
          fetch: async () =>
            new Response(body, {
              headers: { 'Content-Type': body.startsWith('<') ? 'text/html' : 'application/json' },
            }),
        },
      });
      const response = await app.fetch(
        new Request('https://ai-gateway.sassmaker.com/api/ai'),
        env,
        makeCtx()
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as { surfaces: unknown[] }).surfaces.length).toBeGreaterThan(
        0
      );
    }
  });
  it('renders status from the real public API handlers using test bindings', async () => {
    const { env } = makeTestEnv();
    Object.assign(env, { ASSETS: sourceFixtureAssets() });
    const response = await app.fetch(
      new Request('https://ai-gateway.sassmaker.com/status.md'),
      env,
      makeCtx()
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.text();
    expect(body).toContain('# Gateway Status');
    expect(body).toContain('## Model Registry');
    expect(body).toContain('Observed:');
    expect(body).not.toContain('Loading…');
  });
});
