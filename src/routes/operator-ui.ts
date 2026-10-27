import type { OpenAPIHono } from '@hono/zod-openapi';

import { BENCHMARK_COST_OPTIMIZER_HTML } from '../benchmark-cost-optimizer-html';
import { DASHBOARD_HTML } from '../dashboard-html';
import { MODEL_CATALOG_HTML, OPERATOR_HEALTH_HTML } from '../operator-ui-html';
import { publicRuntimeHtml } from '../public-runtime-html';
import type { Env } from '../types';

type GatewayApp = OpenAPIHono<{ Bindings: Env }>;

const setDashboardHeaders = (context: { header: (key: string, value: string) => void }) => {
  context.header('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  context.header('cdn-cache-control', 'no-store');
  context.header('cloudflare-cdn-cache-control', 'no-store');
};

function wantsBrowserHtml(context: {
  req: { header: (key: string) => string | undefined };
}): boolean {
  const accept = context.req.header('accept') ?? '';
  if (!accept.toLowerCase().includes('text/html')) {
    return false;
  }

  const fetchDest = context.req.header('sec-fetch-dest');
  return fetchDest === undefined || fetchDest === 'document';
}

export function registerOperatorUiRoutes(app: GatewayApp): void {
  app.use('/v1/models', async (context, next) => {
    if (context.req.method === 'GET' && wantsBrowserHtml(context)) {
      setDashboardHeaders(context);
      return context.html(publicRuntimeHtml(MODEL_CATALOG_HTML, '/models', context.req.path));
    }

    await next();
  });

  app.use('/models', async (context, next) => {
    if (context.req.method === 'GET' && wantsBrowserHtml(context)) {
      setDashboardHeaders(context);
      return context.html(publicRuntimeHtml(MODEL_CATALOG_HTML, '/models', context.req.path));
    }

    await next();
  });

  app.get('/models/', (context) => context.redirect('/models'));

  app.get('/dashboard', (context) => {
    setDashboardHeaders(context);
    return context.html(publicRuntimeHtml(DASHBOARD_HTML, '/dashboard', context.req.path));
  });
  app.get('/dashboard/', (context) => context.redirect('/dashboard'));
  app.get('/live', (context) => {
    setDashboardHeaders(context);
    return context.html(publicRuntimeHtml(DASHBOARD_HTML, '/dashboard', context.req.path));
  });
  app.get('/v1/dashboard', (context) => {
    setDashboardHeaders(context);
    return context.html(publicRuntimeHtml(DASHBOARD_HTML, '/dashboard', context.req.path));
  });

  app.get('/benchmark', (context) => {
    setDashboardHeaders(context);
    return context.html(
      publicRuntimeHtml(BENCHMARK_COST_OPTIMIZER_HTML, '/benchmark', context.req.path)
    );
  });
  app.get('/benchmark/', (context) => context.redirect('/benchmark'));
  app.get('/v1/benchmark', (context) => {
    setDashboardHeaders(context);
    return context.html(
      publicRuntimeHtml(BENCHMARK_COST_OPTIMIZER_HTML, '/benchmark', context.req.path)
    );
  });

  app.use('/health', async (context, next) => {
    if (context.req.method === 'GET' && wantsBrowserHtml(context)) {
      setDashboardHeaders(context);
      return context.html(publicRuntimeHtml(OPERATOR_HEALTH_HTML, '/health', context.req.path));
    }

    await next();
  });

  app.get('/health/', (context) => {
    if (wantsBrowserHtml(context)) {
      setDashboardHeaders(context);
      return context.html(publicRuntimeHtml(OPERATOR_HEALTH_HTML, '/health', context.req.path));
    }

    return context.redirect('/health');
  });
}
