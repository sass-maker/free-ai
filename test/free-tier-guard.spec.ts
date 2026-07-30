import { describe, expect, it, vi } from 'vitest';

import { getModelRegistry, getTtsRegistry, isWorkersAiEnabled } from '../src/config';
import { callWorkersAi } from '../src/providers/workers-ai';
import { classifyError, isRetriableFailure } from '../src/router/classify-error';
import {
  buildBudgetExhaustedResponse,
  estimateChatInputChars,
  estimateNeuronCost,
  getNeuronUsage,
  tryDebitNeurons,
} from '../src/state/neuron-budget';
import type { Env } from '../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATEWAY_DB: {} as D1Database,
    HEALTH_DO: {} as DurableObjectNamespace,
    RATE_LIMIT_DO: {} as DurableObjectNamespace,
    HEALTH_KV: {} as KVNamespace,
    ...overrides,
  };
}

function budgetNamespace(fetchMock: ReturnType<typeof vi.fn>): DurableObjectNamespace {
  return {
    idFromName: vi.fn(() => ({ toString: () => 'budget-id' })),
    get: vi.fn(() => ({ fetch: fetchMock })),
  } as unknown as DurableObjectNamespace;
}

describe('Workers AI free-tier guard', () => {
  it('keeps Workers AI disabled unless explicitly opted in', () => {
    const ai = { run: vi.fn() };
    const disabledEnv = makeEnv({ AI: ai });
    const enabledEnv = makeEnv({ AI: ai, WORKERS_AI_ENABLED: 'true' });

    expect(isWorkersAiEnabled(disabledEnv)).toBe(false);
    expect(
      getModelRegistry(disabledEnv).some((candidate) => candidate.provider === 'workers_ai')
    ).toBe(false);
    expect(
      getTtsRegistry(disabledEnv).some((candidate) => candidate.provider === 'workers_ai')
    ).toBe(false);

    expect(isWorkersAiEnabled(enabledEnv)).toBe(true);
    expect(
      getModelRegistry(enabledEnv).some((candidate) => candidate.provider === 'workers_ai')
    ).toBe(true);
    expect(
      getTtsRegistry(enabledEnv).some((candidate) => candidate.provider === 'workers_ai')
    ).toBe(true);
  });

  it('fails closed when the neuron budget binding is unavailable', async () => {
    await expect(tryDebitNeurons(makeEnv(), 1)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('estimates Workers AI text neurons from approximate input and output tokens', () => {
    const short = estimateNeuronCost('@cf/meta/llama-3.2-1b-instruct', {
      inputChars: 400,
      outputTokens: 100,
    });
    const long = estimateNeuronCost('@cf/meta/llama-3.2-1b-instruct', {
      inputChars: 4_000,
      outputTokens: 1_000,
    });

    expect(short).toBeGreaterThanOrEqual(2);
    expect(long).toBeGreaterThan(short);
  });

  it('covers text defaults, embeddings, fixed prices, and the conservative fallback', () => {
    expect(estimateNeuronCost('@cf/meta/llama-3.2-1b-instruct')).toBeGreaterThanOrEqual(1);
    expect(
      estimateNeuronCost('@cf/meta/llama-3.2-1b-instruct', {
        inputChars: 0,
        outputTokens: 0,
      })
    ).toBe(1);

    const shortEmbedding = estimateNeuronCost('@cf/baai/bge-small-en-v1.5');
    const longEmbedding = estimateNeuronCost('@cf/baai/bge-small-en-v1.5', {
      inputChars: 40_000,
    });
    expect(shortEmbedding).toBe(1);
    expect(longEmbedding).toBeGreaterThan(shortEmbedding);

    expect(estimateNeuronCost('@cf/black-forest-labs/flux-1-schnell')).toBe(200);
    expect(estimateNeuronCost('@cf/unknown/model')).toBe(80);
  });

  it('adds image parts to chat input estimates', () => {
    const chars = estimateChatInputChars([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
        ],
      },
    ]);

    expect(chars).toBeGreaterThan(1_000);
    expect(
      estimateChatInputChars([
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '' },
      ])
    ).toBe('system prompt'.length);
  });

  it('debits through the global budget durable object', async () => {
    const result = {
      allowed: true,
      used: 120,
      remaining: 9_380,
      retryAfter: 0,
      dayKey: '2026-07-31',
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(result));
    const env = makeEnv({ NEURON_BUDGET: budgetNamespace(fetchMock) });

    await expect(tryDebitNeurons(env, 12)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://internal.local/try-debit',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ neurons: 12 }),
      })
    );
  });

  it('fails closed when the budget durable object throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('DO unavailable'));
    const env = makeEnv({ NEURON_BUDGET: budgetNamespace(fetchMock) });

    await expect(tryDebitNeurons(env, 12)).resolves.toEqual({
      allowed: false,
      used: 0,
      remaining: 0,
      retryAfter: 60,
      dayKey: '',
    });
  });

  it('reads usage and degrades to null when usage is unavailable', async () => {
    await expect(getNeuronUsage(makeEnv())).resolves.toBeNull();

    const usage = {
      used: 320,
      remaining: 9_180,
      cap: 9_500,
      dayKey: '2026-07-31',
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(usage));
    const env = makeEnv({ NEURON_BUDGET: budgetNamespace(fetchMock) });
    await expect(getNeuronUsage(env)).resolves.toEqual(usage);
    expect(fetchMock).toHaveBeenCalledWith('https://internal.local/usage');

    fetchMock.mockRejectedValueOnce(new Error('DO unavailable'));
    await expect(getNeuronUsage(env)).resolves.toBeNull();
  });

  it('builds a non-cacheable, retryable budget-exhausted response', async () => {
    const response = buildBudgetExhaustedResponse({
      allowed: false,
      used: 9_500,
      remaining: 0,
      retryAfter: 0,
      dayKey: '2026-07-31',
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'neuron_budget_exhausted',
        message: 'Daily Workers AI Neuron budget exhausted (9500/9500). Retry after UTC midnight.',
      },
      x_budget: {
        used: 9_500,
        remaining: 0,
        day_key: '2026-07-31',
      },
    });

    expect(
      buildBudgetExhaustedResponse({
        allowed: false,
        used: 9_500,
        remaining: 0,
        retryAfter: 120,
        dayKey: '2026-07-31',
      }).headers.get('retry-after')
    ).toBe('120');
  });

  it('does not call Workers AI when the opt-in flag is absent', async () => {
    const run = vi.fn();
    const env = makeEnv({ AI: { run } });

    await expect(
      callWorkersAi({
        env,
        provider: 'workers_ai',
        model: '@cf/meta/llama-3.2-1b-instruct',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      })
    ).rejects.toThrow('Workers AI is disabled');

    expect(run).not.toHaveBeenCalled();
  });

  it('does not call Workers AI when enabled but the budget guard is unavailable', async () => {
    const run = vi.fn();
    const env = makeEnv({ AI: { run }, WORKERS_AI_ENABLED: 'true' });

    await expect(
      callWorkersAi({
        env,
        provider: 'workers_ai',
        model: '@cf/meta/llama-3.2-1b-instruct',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      })
    ).rejects.toThrow('Daily Workers AI Neuron budget exhausted');

    expect(run).not.toHaveBeenCalled();
  });

  it('classifies budget exhaustion as retriable so routing falls back to other providers', async () => {
    const run = vi.fn();
    const env = makeEnv({ AI: { run }, WORKERS_AI_ENABLED: 'true' });

    const error = await callWorkersAi({
      env,
      provider: 'workers_ai',
      model: '@cf/meta/llama-3.2-1b-instruct',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    }).then(
      () => null,
      (err: unknown) => err
    );

    expect(error).toBeInstanceOf(Error);
    expect(isRetriableFailure(classifyError(error))).toBe(true);
  });
});
