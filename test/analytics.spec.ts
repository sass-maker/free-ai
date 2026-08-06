import { describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { makeCtx, makeTestEnv } from './helpers/env';

function makeAnalyticsDb() {
  const preparedSql: string[] = [];
  const binds: unknown[][] = [];

  const prepare = vi.fn((sql: string) => {
    preparedSql.push(sql);
    const statement = {
      bind: vi.fn((...args: unknown[]) => {
        binds.push(args);
        return statement;
      }),
      first: vi.fn(async () => ({ total: 100, successful: 75, failed: 25 })),
      all: vi.fn(async () => {
        if (sql.includes('GROUP BY date, provider')) {
          return {
            results: [
              {
                date: '2026-08-01',
                key: 'nvidia',
                requests: 80,
                successful: 55,
                failed: 25,
              },
              {
                date: '2026-08-01',
                key: 'mistral',
                requests: 20,
                successful: 20,
                failed: 0,
              },
            ],
          };
        }
        if (sql.includes('GROUP BY date ORDER BY')) {
          return {
            results: [
              {
                date: '2026-08-01',
                requests: 100,
                successful: 75,
                failed: 25,
              },
            ],
          };
        }
        if (sql.includes('GROUP BY provider')) {
          return {
            results: [
              { provider: 'nvidia', requests: 80, successful: 55, failed: 25 },
              { provider: 'mistral', requests: 20, successful: 20, failed: 0 },
            ],
          };
        }
        if (sql.includes('GROUP BY model')) {
          return {
            results: [{ model: 'model-a', requests: 100, successful: 75, failed: 25 }],
          };
        }
        if (sql.includes('GROUP BY project_id')) {
          return {
            results: [{ project_id: 'ai-game', requests: 100, successful: 75, failed: 25 }],
          };
        }
        return { results: [] };
      }),
    };
    return statement;
  });

  return {
    db: { prepare } as unknown as D1Database,
    preparedSql,
    binds,
  };
}

function analyticsRequest(query: string) {
  return new Request(`https://gateway.test/v1/analytics?${query}`);
}

describe('GET /v1/analytics grouped daily evidence', () => {
  it('preserves aggregate fields and adds explicit daily failure rates', async () => {
    const { env } = makeTestEnv();
    const { db } = makeAnalyticsDb();

    const res = await app.fetch(analyticsRequest('days=7'), { ...env, GATEWAY_DB: db }, makeCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      total_requests: 100,
      successful_requests: 75,
      failed_requests: 25,
      success_rate: 0.75,
      providers: {
        nvidia: { requests: 80, successful: 55, failed: 25 },
      },
      daily: [
        {
          date: '2026-08-01',
          requests: 100,
          successful: 75,
          failed: 25,
          failure_rate: 0.25,
        },
      ],
      group_by: null,
      daily_breakdown: [],
    });
  });

  it('returns an allowlisted provider-by-day breakdown', async () => {
    const { env } = makeTestEnv();
    const { db, preparedSql, binds } = makeAnalyticsDb();

    const res = await app.fetch(
      analyticsRequest('days=14&project_id=ai-game&group_by=provider'),
      { ...env, GATEWAY_DB: db },
      makeCtx()
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      group_by: 'provider',
      daily_breakdown: [
        {
          date: '2026-08-01',
          key: 'nvidia',
          requests: 80,
          failed: 25,
          failure_rate: 0.3125,
        },
        {
          date: '2026-08-01',
          key: 'mistral',
          requests: 20,
          failed: 0,
          failure_rate: 0,
        },
      ],
    });
    expect(preparedSql.some((sql) => sql.includes('GROUP BY date, provider'))).toBe(true);
    expect(preparedSql.every((sql) => !sql.includes('group_by'))).toBe(true);
    expect(binds.every((args) => args[0] === 'ai-game' && args[1] === '-14 days')).toBe(true);
  });

  it('rejects unsupported grouping before preparing analytics SQL', async () => {
    const { env } = makeTestEnv();
    const { db, preparedSql } = makeAnalyticsDb();

    const res = await app.fetch(
      analyticsRequest('days=7&group_by=provider%2C%20failed_requests'),
      { ...env, GATEWAY_DB: db },
      makeCtx()
    );

    expect(res.status).toBe(400);
    expect(preparedSql).toEqual([]);
  });
});
