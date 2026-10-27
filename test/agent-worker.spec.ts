import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

function builtAssets() {
  return {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      try {
        const body = await readFile(new URL(`../site/dist${path}`, import.meta.url));
        return new Response(body, {
          headers: { 'Content-Type': path.endsWith('.md') ? 'text/markdown' : 'text/plain' },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  };
}
describe('worker public Markdown integration', () => {
  it('serves built public sources and keeps actual protected API behavior', async () => {
    const { env } = makeTestEnv();
    Object.assign(env, { ASSETS: builtAssets() });
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
  it('renders status from the real public API handlers using test bindings', async () => {
    const { env } = makeTestEnv();
    Object.assign(env, { ASSETS: builtAssets() });
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
