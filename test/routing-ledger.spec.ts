import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import {
  buildChatLedgerRecord,
  buildFallbackSignature,
  buildQuotaSignature,
  derivePromptClass,
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
  });

  it('builds compact fallback and quota signatures', () => {
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
});
