import type { OpenAPIHono } from '@hono/zod-openapi';

import { BENCHMARK_COST_OPTIMIZER_HTML } from '../benchmark-cost-optimizer-html';
import { DASHBOARD_HTML } from '../dashboard-html';
import { MODEL_CATALOG_HTML, OPERATOR_HEALTH_HTML } from '../operator-ui-html';
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
      return context.html(MODEL_CATALOG_HTML);
    }

    await next();
  });

  app.use('/models', async (context, next) => {
    if (context.req.method === 'GET' && wantsBrowserHtml(context)) {
      setDashboardHeaders(context);
      return context.html(MODEL_CATALOG_HTML);
    }

    await next();
  });

  app.get('/models/', (context) => context.redirect('/models'));

  app.get('/dashboard', (context) => {
    setDashboardHeaders(context);
    return context.html(DASHBOARD_HTML);
  });
  app.get('/dashboard/', (context) => context.redirect('/dashboard'));
  app.get('/live', (context) => {
    setDashboardHeaders(context);
    return context.html(DASHBOARD_HTML);
  });
  app.get('/v1/dashboard', (context) => {
    setDashboardHeaders(context);
    return context.html(DASHBOARD_HTML);
  });

  app.get('/benchmark', (context) => {
    setDashboardHeaders(context);
    return context.html(BENCHMARK_COST_OPTIMIZER_HTML);
  });
  app.get('/benchmark/', (context) => context.redirect('/benchmark'));
  app.get('/v1/benchmark', (context) => {
    setDashboardHeaders(context);
    return context.html(BENCHMARK_COST_OPTIMIZER_HTML);
  });

  app.use('/health', async (context, next) => {
    if (context.req.method === 'GET' && wantsBrowserHtml(context)) {
      setDashboardHeaders(context);
      return context.html(OPERATOR_HEALTH_HTML);
    }

    await next();
  });

  app.get('/health/', (context) => {
    if (wantsBrowserHtml(context)) {
      setDashboardHeaders(context);
      return context.html(OPERATOR_HEALTH_HTML);
    }

    return context.redirect('/health');
  });
}
