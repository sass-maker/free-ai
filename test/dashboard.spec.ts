import { describe, expect, it } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

async function fetchRoute(path: string) {
  const { env } = makeTestEnv();
  const req = new Request(`https://gateway.test${path}`, { method: 'GET' });
  return app.fetch(req, env, makeCtx());
}

describe('Dashboard HTML routes', () => {
  it.each([['/dashboard'], ['/live'], ['/v1/dashboard']])(
    '%s returns 200 with the dashboard HTML',
    async (path) => {
      const res = await fetchRoute(path);
      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('<title>Free AI Gateway — Live</title>');
    },
  );

  it.each([['/dashboard'], ['/live'], ['/v1/dashboard']])(
    '%s sets no-store cache headers so dashboards do not get CDN-cached',
    async (path) => {
      const res = await fetchRoute(path);
      expect(res.headers.get('cache-control') ?? '').toContain('no-store');
      expect(res.headers.get('cdn-cache-control')).toBe('no-store');
      expect(res.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
    },
  );

  it('redirects /dashboard/ to /dashboard', async () => {
    const res = await fetchRoute('/dashboard/');
    expect([301, 302, 307, 308]).toContain(res.status);
    expect(res.headers.get('location')).toBe('/dashboard');
  });

  it('includes unauthenticated dashboard guidance and public endpoint fetches', async () => {
    const res = await fetchRoute('/dashboard');
    const html = await res.text();

    expect(html).toContain('Usage analytics require credentials');
    expect(html).toContain('GATEWAY_API_KEY');
    expect(html).toContain('/v1/routing/status');
    expect(html).toContain('authRequired');
    expect(html).toContain('Routing fallback order');
    expect(html).toContain('Analytics locked');
  });
});
