import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { DASHBOARD_HTML } from '../src/dashboard-html';

const analyticsTotals = {
  total_requests: 140,
  successful_requests: 115,
  failed_requests: 25,
  success_rate: 115 / 140,
  providers: {
    nvidia: { requests: 80, successful: 55, failed: 25 },
    mistral: { requests: 60, successful: 60, failed: 0 },
  },
  models: {
    'meta/llama-4-maverick': { requests: 80, successful: 55, failed: 25 },
    'mistral-small-latest': { requests: 60, successful: 60, failed: 0 },
  },
  projects: {
    'ai-game': { requests: 100, successful: 75, failed: 25 },
    knowledgebase: { requests: 40, successful: 40, failed: 0 },
  },
  daily: [
    {
      date: '2026-08-01',
      requests: 100,
      successful: 75,
      failed: 25,
      failure_rate: 0.25,
    },
    {
      date: '2026-08-03',
      requests: 40,
      successful: 40,
      failed: 0,
      failure_rate: 0,
    },
  ],
};

const dailyBreakdowns = {
  provider: [
    {
      date: '2026-08-01',
      key: 'nvidia',
      requests: 80,
      successful: 55,
      failed: 25,
      failure_rate: 0.3125,
    },
    {
      date: '2026-08-01',
      key: 'mistral',
      requests: 20,
      successful: 20,
      failed: 0,
      failure_rate: 0,
    },
  ],
  model: [
    {
      date: '2026-08-01',
      key: 'meta/llama-4-maverick',
      requests: 80,
      successful: 55,
      failed: 25,
      failure_rate: 0.3125,
    },
  ],
  project: [
    {
      date: '2026-08-01',
      key: 'ai-game',
      requests: 100,
      successful: 75,
      failed: 25,
      failure_rate: 0.25,
    },
  ],
};

function dashboardFixture() {
  return {
    name: 'free-ai-dashboard-fixture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/dashboard-fixture') {
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(DASHBOARD_HTML);
          return;
        }

        if (!req.headers.referer?.includes('/dashboard-fixture')) {
          next();
          return;
        }

        const url = new URL(req.url || '/', 'http://127.0.0.1:4173');
        res.setHeader('content-type', 'application/json');
        if (url.pathname === '/v1/analytics') {
          const groupBy = url.searchParams.get('group_by') || 'provider';
          res.end(
            JSON.stringify({
              ...analyticsTotals,
              group_by: groupBy,
              daily_breakdown: dailyBreakdowns[groupBy] || [],
            })
          );
          return;
        }
        if (url.pathname === '/health') {
          res.end(JSON.stringify({ ok: true, models: [] }));
          return;
        }
        if (url.pathname === '/v1/stats/providers') {
          res.end(JSON.stringify({ stats: [], quotas: {} }));
          return;
        }
        if (url.pathname === '/v1/routing/status') {
          res.end(
            JSON.stringify({
              summary: {
                configured_models: 8,
                available_models: 8,
                degraded_models: 0,
                cooldown_models: 0,
                exhausted_models: 0,
                fallback_ready: true,
                top_provider: 'mistral',
              },
              providers: {},
              fallback_order: [],
            })
          );
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  plugins: [dashboardFixture()],
  build: {
    outDir: resolve(__dirname, '../dist/playground'),
    emptyOutDir: true,
  },
});
