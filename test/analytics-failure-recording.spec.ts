import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { makeTestEnv } from './helpers/env';

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
      'x-gateway-force-provider': 'groq',
    },
    body: JSON.stringify({
      model: 'auto',
      project_id: 'failure-test',
      messages: [{ role: 'user', content: 'hello' }],
      ...body,
    }),
  });
}

describe('analytics failure recording', () => {
  beforeEach(() => {
    mocks.groqMock.mockReset();
  });

  it('records a failed_requests row in project_analytics when all providers fail', async () => {
    // Simulate a rate-limit (429) — retriable, so the retry loop will try
    // multiple candidates before giving up. Before the fix, chosenMeta was
    // undefined on the error path and recordAnalytics early-returned,
    // silently dropping the failure.
    mocks.groqMock.mockRejectedValue(
      Object.assign(new Error('rate limit exceeded'), { status: 429 })
    );

    const run = vi.fn(async () => ({ success: true }));
    const bindArgs: unknown[] = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(function (this: unknown, ...args: unknown[]) {
        if (String(sql).includes('project_analytics')) {
          bindArgs.push(...args);
        }
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

    // Request should fail with 429 (usage_retriable exhausted)
    expect(res.status).toBe(429);

    // Verify project_analytics INSERT was executed
    const analyticsCall = prepare.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO project_analytics')
    );
    expect(analyticsCall).toBeTruthy();
    expect(run).toHaveBeenCalled();

    // bindArgs: [projectId, date, provider, model, isOk, isError]
    // isOk should be 0 and isError should be 1 (failure recorded)
    expect(bindArgs[0]).toBe('failure-test'); // projectId
    expect(bindArgs[4]).toBe(0); // isOk
    expect(bindArgs[5]).toBe(1); // isError

    // provider and model should be non-empty (the last-attempted candidate,
    // not undefined as before the fix)
    expect(bindArgs[2]).toBeTruthy(); // provider
    expect(bindArgs[3]).toBeTruthy(); // model
  });
});
