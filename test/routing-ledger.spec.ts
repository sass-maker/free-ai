import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import {
  buildChatLedgerRecord,
  buildFallbackSignature,
  buildQuotaSignature,
  derivePromptClass,
  queryRoutingLedger,
  recordRoutingLedger,
} from '../src/routing/ledger';
import type { ProviderQuotaStatus, TextProvider } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({
  groqMock: vi.fn(),
}));

vi.mock('../src/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    providerCallers: {
      ...(actual.providerCallers as Record<string, unknown>),
      groq: mocks.groqMock,
    },
  };
});

function chatRequest(body: Record<string, unknown> = {}) {
  return new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-gateway-key',
    },
    body: JSON.stringify({
      model: 'auto',
      project_id: 'ledger-test',
      messages: [{ role: 'user', content: 'hello' }],
      ...body,
    }),
  });
}

function ledgerRequest(query = 'days=7') {
  return new Request(`https://gateway.test/v1/routing/ledger?${query}`);
}

describe('routing ledger helpers', () => {
  it('derives prompt classes without storing message text', () => {
    expect(
      derivePromptClass({
        messages: [{ role: 'user', content: 'secret prompt text' }],
        stream: true,
      })
    ).toBe('stream+text');

    expect(
      derivePromptClass({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
            ],
          },
        ],
        tools: [{ type: 'function', function: { name: 'lookup' } }],
      })
    ).toBe('text+tools+vision');

    expect(
      derivePromptClass({
        messages: [{ role: 'user', content: 'return json' }],
        response_format: { type: 'json_object' },
      })
    ).toBe('json+text');
  });

  it('builds compact fallback and quota signatures', () => {
    expect(buildFallbackSignature([])).toBe('none');
    expect(buildFallbackSignature([{ provider: 'groq', model: 'llama' }])).toBe('groq/llama');
    expect(
      buildFallbackSignature([
        { provider: 'groq', model: 'llama', outcome: 'failed' },
        { provider: 'workers_ai', model: 'mistral', outcome: 'ok', latency_ms: 120 },
      ])
    ).toBe('groq/llama:failed>workers_ai/mistral:ok');

    const quotas = new Map<TextProvider, ProviderQuotaStatus>([
      [
        'openrouter',
        {
          provider: 'openrouter',
          status: 'exhausted',
          source: 'openrouter_key',
          checkedAt: new Date().toISOString(),
        },
      ],
      [
        'groq',
        {
          provider: 'groq',
          status: 'ok',
          source: 'not_supported',
          checkedAt: new Date().toISOString(),
        },
      ],
    ]);

    expect(buildQuotaSignature(quotas)).toBe('openrouter');
    expect(buildQuotaSignature(new Map())).toBe('all_ok');
  });
});

describe('GET /v1/routing/ledger', () => {
  it('is public read-only and returns privacy guarantees', async () => {
    const prepare = vi.fn(() => ({
      bind: vi.fn(function (this: unknown) {
        return this;
      }),
      first: vi.fn(async () => ({
        total_requests: 2,
        successful_requests: 1,
        failed_requests: 1,
        sum_latency_ms: 300,
        sum_attempts: 3,
        with_fallback: 1,
      })),
      all: vi.fn(async () => ({ results: [] })),
    }));

    const { env } = makeTestEnv();
    env.GATEWAY_DB.prepare = prepare as unknown as D1Database['prepare'];

    const res = await app.fetch(ledgerRequest(), env, makeCtx());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      privacy: { stores_prompt_text: boolean; stores_request_ids: boolean };
      summary: { total_requests: number };
    };

    expect(body.ok).toBe(true);
    expect(body.privacy).toEqual({ stores_prompt_text: false, stores_request_ids: false });
    expect(body.summary.total_requests).toBe(2);
    expect(prepare).toHaveBeenCalled();
  });
});

describe('chat completions routing ledger smoke', () => {
  beforeEach(() => {
    mocks.groqMock.mockReset();
  });

  it('records an anonymous ledger rollup after a mocked provider success', async () => {
    mocks.groqMock.mockResolvedValueOnce({
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      stream: false,
      completion: {
        id: 'chatcmpl-ledger',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      },
    });

    const run = vi.fn(async () => ({ success: true }));
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(function (this: unknown, ...args: unknown[]) {
        (this as { args?: unknown[]; sql?: string }).args = args;
        (this as { sql?: string }).sql = sql;
        return this;
      }),
      run,
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
    }));

    const { env } = makeTestEnv({ GROQ_API_KEY: 'groq-key' });
    env.GATEWAY_DB.prepare = prepare as unknown as D1Database['prepare'];

    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(Promise.resolve(promise));
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const res = await app.fetch(chatRequest(), env, ctx);
    await Promise.all(pending);
    expect(res.status).toBe(200);

    const ledgerInsert = prepare.mock.calls.find(([sql]) =>
      String(sql).includes('routing_ledger_rollup')
    );
    expect(ledgerInsert).toBeTruthy();
    expect(mocks.groqMock).toHaveBeenCalledOnce();
  });
});

describe('recordRoutingLedger', () => {
  it('inserts rollup rows without prompt text fields', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const bind = vi.fn(function (this: unknown, ...args: unknown[]) {
      (this as { args?: unknown[] }).args = args;
      return this;
    });
    const prepare = vi.fn(() => ({ bind, run }));

    const db = { prepare } as unknown as D1Database;
    const record = buildChatLedgerRecord({
      endpoint: 'chat.completions',
      projectId: 'ledger-test',
      normalized: {
        model: 'auto',
        messages: [{ role: 'user', content: 'super secret prompt' }],
        stream: false,
        reasoning_effort: 'auto',
      },
      requestedModel: 'auto',
      quotaStatuses: new Map(),
      fallbackHops: [{ provider: 'groq', model: 'llama', outcome: 'ok', latency_ms: 90 }],
      chosenMeta: {
        provider: 'groq',
        model: 'llama',
        attempts: 1,
        reasoning_effort: 'auto',
        request_id: 'req-1',
        project_id: 'ledger-test',
      },
      outcome: 'ok',
      requestStartedAt: Date.now() - 120,
    });

    await recordRoutingLedger(db, record);

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('routing_ledger_rollup'));
    const bound = bind.mock.results[0]?.value as { args?: unknown[] };
    expect(JSON.stringify(bound.args ?? [])).not.toContain('super secret prompt');
    expect(bound.args).toEqual(
      expect.arrayContaining(['text', 'ok', 'groq', 'llama', 'groq/llama:ok', 'all_ok'])
    );
  });

  it('normalizes optional fields, quota state, latency, and attempts', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const bind = vi.fn(function (this: unknown, ...args: unknown[]) {
      (this as { args?: unknown[] }).args = args;
      return this;
    });
    const prepare = vi.fn(() => ({ bind, run }));
    const db = { prepare } as unknown as D1Database;

    const record = buildChatLedgerRecord({
      endpoint: 'chat.completions',
      projectId: 'ledger-test',
      normalized: {
        model: 'auto',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
        reasoning_effort: 'auto',
      },
      requestedModel: 'auto',
      quotaStatuses: new Map<TextProvider, ProviderQuotaStatus>([
        [
          'openrouter',
          {
            provider: 'openrouter',
            status: 'exhausted',
            source: 'openrouter_key',
            checkedAt: '2026-07-31T00:00:00Z',
            limitRemaining: 0,
          },
        ],
        [
          'groq',
          {
            provider: 'groq',
            status: 'ok',
            source: 'not_supported',
            checkedAt: '2026-07-31T00:00:00Z',
          },
        ],
      ]),
      fallbackHops: [],
      outcome: 'quota_exhausted',
      requestStartedAt: Date.now() + 100,
      errorClass: 'quota',
    });

    expect(record).toMatchObject({
      chosen_provider: undefined,
      chosen_model: undefined,
      attempts: 1,
      error_class: 'quota',
      quota_state: {
        openrouter: { status: 'exhausted', limit_remaining: 0 },
        groq: { status: 'ok', limit_remaining: null },
      },
    });

    await recordRoutingLedger(db, { ...record, project_id: undefined, attempts: 0 });

    const bound = bind.mock.results[0]?.value as { args?: unknown[] };
    expect(bound.args).toEqual(
      expect.arrayContaining(['', 'quota_exhausted', 'none', 'openrouter', 0, 1])
    );
  });

  it('does not change routing behavior when persistence fails', async () => {
    const db = {
      prepare: vi.fn(() => {
        throw new Error('D1 unavailable');
      }),
    } as unknown as D1Database;

    await expect(
      recordRoutingLedger(db, {
        endpoint: 'chat.completions',
        prompt_class: 'text',
        requested_model: 'auto',
        fallback_chain: [],
        quota_state: {},
        latency_ms: 10,
        outcome: 'ok',
        attempts: 1,
      })
    ).resolves.toBeUndefined();
  });
});

describe('queryRoutingLedger', () => {
  function makeQueryDb(options: {
    totals: Record<string, number | null> | null;
    rows: Record<string, unknown[] | undefined>;
  }) {
    const binds: unknown[][] = [];
    const prepare = vi.fn((sql: string) => {
      const statement = {
        bind: vi.fn((...args: unknown[]) => {
          binds.push(args);
          return statement;
        }),
        first: vi.fn(async () => options.totals),
        all: vi.fn(async () => {
          if (sql.includes('GROUP BY prompt_class')) {
            return { results: options.rows.prompt };
          }
          if (sql.includes('GROUP BY outcome')) {
            return { results: options.rows.outcome };
          }
          if (sql.includes('GROUP BY chosen_provider')) {
            return { results: options.rows.model };
          }
          if (sql.includes('GROUP BY quota_signature')) {
            return { results: options.rows.quota };
          }
          return { results: options.rows.fallback };
        }),
      };
      return statement;
    });

    return {
      db: { prepare } as unknown as D1Database,
      binds,
    };
  }

  it('maps populated aggregates and applies a project filter', async () => {
    const { db, binds } = makeQueryDb({
      totals: {
        total_requests: 4,
        successful_requests: 3,
        failed_requests: 1,
        sum_latency_ms: 400,
        sum_attempts: 6,
        with_fallback: 2,
      },
      rows: {
        prompt: [
          {
            prompt_class: 'text',
            request_count: 4,
            sum_latency_ms: 400,
            sum_attempts: 6,
            with_fallback: 2,
            successful_requests: 3,
          },
        ],
        outcome: [
          {
            outcome: 'ok',
            request_count: 3,
            sum_latency_ms: 270,
            sum_attempts: 4,
            with_fallback: 1,
          },
          {
            outcome: 'error',
            request_count: 1,
            sum_latency_ms: 130,
            sum_attempts: 2,
            with_fallback: 1,
          },
        ],
        model: [
          {
            chosen_provider: 'groq',
            chosen_model: 'llama',
            request_count: 3,
            sum_latency_ms: 270,
            sum_attempts: 4,
            with_fallback: 1,
            successful_requests: 3,
          },
          {
            chosen_provider: '',
            chosen_model: '',
            request_count: 1,
            sum_latency_ms: 130,
            sum_attempts: 2,
            with_fallback: 1,
            successful_requests: 0,
          },
        ],
        quota: [
          {
            quota_signature: 'all_ok',
            request_count: 4,
            sum_latency_ms: 400,
            sum_attempts: 6,
            with_fallback: 2,
            successful_requests: 3,
          },
        ],
        fallback: [
          {
            fallback_signature: 'groq/llama:ok',
            request_count: 3,
            sum_latency_ms: 300,
            sum_attempts: 4,
            with_fallback: 2,
            successful_requests: 2,
          },
          {
            fallback_signature: 'none',
            request_count: 0,
            sum_latency_ms: 0,
            sum_attempts: 0,
            with_fallback: 0,
            successful_requests: 0,
          },
        ],
      },
    });

    const result = await queryRoutingLedger(db, { days: 14, project_id: 'project-a' });

    expect(result.summary).toEqual({
      total_requests: 4,
      successful_requests: 3,
      failed_requests: 1,
      success_rate: 0.75,
      avg_latency_ms: 100,
      avg_attempts: 1.5,
      fallback_rate: 0.5,
    });
    expect(result.by_prompt_class[0]).toMatchObject({
      key: 'text',
      successful: 3,
      failed: 1,
      success_rate: 0.75,
    });
    expect(result.by_outcome.map((row) => [row.key, row.successful, row.failed])).toEqual([
      ['ok', 3, 0],
      ['error', 0, 1],
    ]);
    expect(result.by_model.map((row) => row.key)).toEqual(['groq:llama', '(none)']);
    expect(result.by_quota_signature[0].key).toBe('all_ok');
    expect(result.top_fallback_signatures).toEqual([
      {
        signature: 'groq/llama:ok',
        requests: 3,
        success_rate: 2 / 3,
        avg_latency_ms: 100,
        fallback_rate: 2 / 3,
      },
      {
        signature: 'none',
        requests: 0,
        success_rate: 0,
        avg_latency_ms: 0,
        fallback_rate: 0,
      },
    ]);
    expect(binds).toHaveLength(6);
    expect(binds.every((args) => args[0] === '-14 days' && args[1] === 'project-a')).toBe(true);
  });

  it('returns zeroed summaries when the rollup has no rows', async () => {
    const { db, binds } = makeQueryDb({
      totals: null,
      rows: {
        prompt: undefined,
        outcome: undefined,
        model: undefined,
        quota: undefined,
        fallback: undefined,
      },
    });

    const result = await queryRoutingLedger(db, { days: 3 });

    expect(result.summary).toEqual({
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      success_rate: 0,
      avg_latency_ms: 0,
      avg_attempts: 0,
      fallback_rate: 0,
    });
    expect(result.by_prompt_class).toEqual([]);
    expect(result.by_outcome).toEqual([]);
    expect(result.by_model).toEqual([]);
    expect(result.by_quota_signature).toEqual([]);
    expect(result.top_fallback_signatures).toEqual([]);
    expect(binds.every((args) => args.length === 1 && args[0] === '-3 days')).toBe(true);
  });
});
