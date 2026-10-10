import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { ModelCandidate } from '../src/types';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({ registry: [] as ModelCandidate[], call: vi.fn() }));
vi.mock('../src/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getModelRegistry: () => mocks.registry,
}));
vi.mock('../src/providers', async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    providerCallers: {
      ...(actual.providerCallers as object),
      groq: mocks.call,
      cohere: mocks.call,
      workers_ai: mocks.call,
    },
  };
});
function candidate(
  model: string,
  provider: 'groq' | 'cohere' | 'workers_ai' = 'groq'
): ModelCandidate {
  return {
    id: model,
    model,
    provider,
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 1,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32000,
      maxOutputTokens: 4096,
    },
  };
}
function health(model: string, successRate = 1, provider = 'groq') {
  return {
    key: `${provider}:${model}`,
    attempts: 10,
    successRate,
    avgLatencyMs: 100,
    p90LatencyMs: 100,
    p99LatencyMs: 100,
    cooldownUntil: 0,
    headroom: 1,
    dailyUsed: 0,
    dailyLimit: 100,
    shortRetriableFailures: 0,
  };
}
async function request(offset: number, snapshots: unknown[], headers: Record<string, string> = {}) {
  const { env } = makeTestEnv({
    GROQ_API_KEY: 'synthetic',
    healthSnapshots: snapshots,
    roundRobinOffset: offset,
  });
  return app.fetch(
    new Request('https://gateway.test/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-gateway-key',
        ...headers,
      },
      body: JSON.stringify({
        model: 'auto',
        project_id: 'rotation-regression',
        stream: false,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: 'Return JSON.' }],
      }),
    }),
    env,
    makeCtx()
  );
}
describe('chat automatic health rotation', () => {
  beforeEach(() => {
    mocks.call.mockReset();
    mocks.call.mockImplementation(async ({ provider, model }) => ({
      provider,
      model,
      stream: false,
      completion: {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"ok":true}' },
            finish_reason: 'stop',
          },
        ],
      },
    }));
  });
  it.each(['tokens per day (TPD)', 'requests per day (RPD)'])(
    'fails over Groq daily %s without spending an attempt on a peer',
    async (quota) => {
      mocks.registry = [
        candidate('first'),
        candidate('same-provider'),
        candidate('alternate', 'cohere'),
      ];
      mocks.call.mockRejectedValueOnce(
        Object.assign(new Error(`Organization rate limit on ${quota}. Try again in 30m0s`), {
          status: 429,
        })
      );
      const response = await request(0, []);
      expect(response.status).toBe(200);
      expect(mocks.call.mock.calls.map(([input]) => input.model)).toEqual(['first', 'alternate']);
    }
  );
  it('skips exhausted snapshots before making any upstream attempt', async () => {
    mocks.registry = [candidate('first'), candidate('alternate', 'cohere')];
    const response = await request(0, [
      { ...health('first'), exhaustedUntil: Date.now() + 3600000 },
    ]);
    expect(response.status).toBe(200);
    expect(mocks.call.mock.calls.map(([input]) => input.model)).toEqual(['alternate']);
  });
  it('fails over empty upstream 400 responses', async () => {
    mocks.registry = [
      candidate('first'),
      candidate('same-provider'),
      candidate('alternate', 'cohere'),
    ];
    mocks.call.mockRejectedValueOnce(
      Object.assign(new Error('400 status code (no body)'), { status: 400 })
    );
    expect((await request(0, [])).status).toBe(200);
    expect(mocks.call.mock.calls.map(([input]) => input.model)).toEqual(['first', 'alternate']);
  });
  it('does not rotate low-success models ahead of healthy peers', async () => {
    mocks.registry = [candidate('healthy-a'), candidate('healthy-b'), candidate('failing')];
    const response = await request(2, [
      health('healthy-a'),
      health('healthy-b'),
      health('failing', 0),
    ]);
    expect(response.status).toBe(200);
    expect(mocks.call.mock.calls[0][0].model).toBe('healthy-a');
  });
  it('still distributes requests between healthy peers', async () => {
    mocks.registry = [candidate('healthy-a'), candidate('healthy-b')];
    await request(1, [health('healthy-a'), health('healthy-b')]);
    expect(mocks.call.mock.calls[0][0].model).toBe('healthy-b');
  });
  it('preserves ordering when no healthy history exists', async () => {
    mocks.registry = [candidate('unmeasured-a'), candidate('unmeasured-b')];
    await request(1, []);
    expect(mocks.call.mock.calls[0][0].model).toBe('unmeasured-a');
  });
  it('does not rotate a temporarily degraded peer ahead of a healthy one', async () => {
    mocks.registry = [candidate('healthy-a'), candidate('slow')];
    await request(1, [health('healthy-a'), { ...health('slow'), avgLatencyMs: 10000 }]);
    expect(mocks.call.mock.calls[0][0].model).toBe('healthy-a');
  });
  it('retains JSON capability filtering before peer rotation', async () => {
    const incompatible = candidate('plain-text');
    incompatible.capabilities.jsonMode = false;
    mocks.registry = [candidate('healthy-a'), incompatible, candidate('failing')];
    await request(1, [health('healthy-a'), health('plain-text'), health('failing', 0)]);
    expect(mocks.call.mock.calls[0][0].model).toBe('healthy-a');
  });
  it('preserves the selected reasoning-tier boundary', async () => {
    const otherTier = candidate('other-tier');
    otherTier.reasoning = 'high';
    mocks.registry = [candidate('healthy-a'), otherTier];
    await request(1, [health('healthy-a'), health('other-tier')]);
    expect(mocks.call.mock.calls[0][0].model).toBe('healthy-a');
  });
  it('continues to the next healthy peer after a retriable failure', async () => {
    mocks.registry = [
      candidate('healthy-a'),
      candidate('healthy-b'),
      candidate('fallback', 'workers_ai'),
    ];
    mocks.call.mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 500 }));
    const response = await request(1, [
      health('healthy-a'),
      health('healthy-b'),
      health('fallback', 1, 'workers_ai'),
    ]);
    expect(response.status).toBe(200);
    expect(mocks.call.mock.calls.map(([input]) => input.model)).toEqual(['healthy-b', 'healthy-a']);
  });
  it('never rotates Workers AI ahead of available external providers', async () => {
    mocks.registry = [candidate('healthy-a'), candidate('fallback', 'workers_ai')];
    const response = await request(1, [health('healthy-a'), health('fallback', 1, 'workers_ai')]);
    expect(response.status).toBe(200);
    expect(mocks.call.mock.calls[0][0].provider).toBe('groq');
  });

  it.each([401, 402, 403])(
    'skips a provider with upstream %i and uses another selected provider',
    async (status) => {
      mocks.registry = [
        candidate('first'),
        candidate('same-provider'),
        candidate('alternate', 'cohere'),
      ];
      mocks.call.mockRejectedValueOnce(
        Object.assign(new Error('upstream account unavailable'), { status })
      );
      const response = await request(0, []);
      expect(response.status).toBe(200);
      expect(mocks.call.mock.calls.map(([input]) => input.model)).toEqual(['first', 'alternate']);
      const body = (await response.json()) as {
        x_gateway: { attempts: number };
        degraded: boolean;
      };
      expect(body.x_gateway.attempts).toBe(2);
      expect(body.degraded).toBe(true);
    }
  );

  it('does not escape a forced provider after upstream authentication fails', async () => {
    mocks.registry = [
      candidate('first'),
      candidate('same-provider'),
      candidate('alternate', 'cohere'),
    ];
    mocks.call.mockRejectedValue(
      Object.assign(new Error('upstream account unavailable'), { status: 401 })
    );
    const response = await request(0, [], { 'x-gateway-force-provider': 'groq' });
    expect(response.status).toBe(502);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });

  it.each([400, 422])(
    'returns input error after cross-provider fallback for upstream %i',
    async (status) => {
      mocks.registry = [candidate('first'), candidate('alternate', 'cohere')];
      mocks.call.mockRejectedValue(Object.assign(new Error('request rejected'), { status }));
      const response = await request(0, []);
      expect(response.status).toBe(400);
      expect(mocks.call).toHaveBeenCalledTimes(2);
      expect(await response.json()).toMatchObject({
        error: { type: 'input_nonretriable', upstream_status: status, attempts: 2 },
      });
    }
  );

  it('preserves safety refusal and the gateway authentication boundary', async () => {
    mocks.registry = [candidate('first'), candidate('alternate', 'cohere')];
    for (const status of [402, 403]) {
      mocks.call.mockClear();
      mocks.call.mockRejectedValue(Object.assign(new Error('content filter refusal'), { status }));
      await request(0, []);
      expect(mocks.call).toHaveBeenCalledTimes(1);
    }
    mocks.call.mockClear();
    const response = await request(0, [], { authorization: 'Bearer invalid' });
    expect(response.status).toBe(401);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('stops after two upstream account failures', async () => {
    mocks.registry = [
      candidate('first'),
      candidate('alternate', 'cohere'),
      candidate('last', 'workers_ai'),
    ];
    mocks.call.mockRejectedValue(
      Object.assign(new Error('upstream account unavailable'), { status: 402 })
    );
    const response = await request(0, []);
    expect(response.status).toBe(502);
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });
});
