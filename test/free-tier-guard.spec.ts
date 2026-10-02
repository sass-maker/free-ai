import { afterEach, describe, expect, it, vi } from 'vitest';

import { getModelRegistry, getTtsRegistry, isWorkersAiEnabled } from '../src/config';
import { callWorkersAi } from '../src/providers/workers-ai';
import {
  classifyError,
  isRetriableFailure,
  MalformedProviderOutputError,
} from '../src/router/classify-error';
import {
  buildBudgetExhaustedResponse,
  estimateChatInputBytes,
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
  afterEach(() => vi.unstubAllGlobals());

  it.each([undefined, null, {}, 42, { response: 42 }, { output_text: [42] }])(
    'rejects malformed binding output %j instead of manufacturing a completion',
    async (result) => {
      const env = makeEnv({
        WORKERS_AI_ENABLED: 'true',
        AI: { run: vi.fn(async () => result) },
        NEURON_BUDGET: budgetNamespace(
          vi.fn(async () =>
            Response.json({
              allowed: true,
              used: 500,
              remaining: 9000,
              retryAfter: 0,
              dayKey: new Date().toISOString().slice(0, 10),
            })
          )
        ),
      });
      await expect(
        callWorkersAi({
          env,
          provider: 'workers_ai',
          model: '@cf/meta/llama-3.2-1b-instruct',
          messages: [{ role: 'user', content: 'hello' }],
          stream: false,
        })
      ).rejects.toBeInstanceOf(MalformedProviderOutputError);
    }
  );

  it('rejects a REST success without text instead of manufacturing an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, result: {} }))
    );
    const env = makeEnv({
      WORKERS_AI_ENABLED: 'true',
      CLOUDFLARE_ACCOUNT_ID: 'synthetic-account',
      CLOUDFLARE_WORKERS_AI_API_KEY: 'synthetic-key',
      NEURON_BUDGET: budgetNamespace(
        vi.fn(async () =>
          Response.json({
            allowed: true,
            used: 500,
            remaining: 9000,
            retryAfter: 0,
            dayKey: new Date().toISOString().slice(0, 10),
          })
        )
      ),
    });
    await expect(
      callWorkersAi({
        env,
        provider: 'workers_ai',
        model: '@cf/meta/llama-3.2-1b-instruct',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      })
    ).rejects.toBeInstanceOf(MalformedProviderOutputError);
  });

  it('blocks unknown Workers AI models before budget access or inference', async () => {
    const run = vi.fn();
    const budgetFetch = vi.fn();
    const env = makeEnv({
      WORKERS_AI_ENABLED: 'true',
      AI: { run },
      NEURON_BUDGET: budgetNamespace(budgetFetch),
    });
    await expect(
      callWorkersAi({
        env,
        provider: 'workers_ai',
        model: '@cf/unknown/model',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      })
    ).rejects.toMatchObject({ code: 'neuron_budget_exhausted' });
    expect(budgetFetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('blocks unpriced multimodal text inference before budget access or inference', async () => {
    const run = vi.fn();
    const budgetFetch = vi.fn();
    const env = makeEnv({
      WORKERS_AI_ENABLED: 'true',
      AI: { run },
      NEURON_BUDGET: budgetNamespace(budgetFetch),
    });
    await expect(
      callWorkersAi({
        env,
        provider: 'workers_ai',
        model: '@cf/meta/llama-3.2-1b-instruct',
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }],
          },
        ],
        stream: false,
      })
    ).rejects.toMatchObject({ code: 'neuron_budget_exhausted' });
    expect(budgetFetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('sends the conservative default output limit when a caller omits max_tokens', async () => {
    const run = vi.fn(async () => ({ response: 'ok' }));
    const fetchMock = vi.fn(async () =>
      Response.json({
        allowed: true,
        used: 500,
        remaining: 9_000,
        retryAfter: 0,
        dayKey: new Date().toISOString().slice(0, 10),
      })
    );
    const env = makeEnv({
      WORKERS_AI_ENABLED: 'true',
      AI: { run },
      NEURON_BUDGET: budgetNamespace(fetchMock),
    });
    await callWorkersAi({
      env,
      provider: 'workers_ai',
      model: '@cf/meta/llama-3.2-1b-instruct',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    });
    expect(run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.2-1b-instruct',
      expect.objectContaining({ max_tokens: 512 })
    );
  });

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

  it('fails closed when resolving the budget namespace throws', async () => {
    const brokenNamespace = {
      idFromName: vi.fn(() => {
        throw new Error('namespace unavailable');
      }),
    } as unknown as DurableObjectNamespace;
    const env = makeEnv({ NEURON_BUDGET: brokenNamespace });
    await expect(tryDebitNeurons(env, 1)).resolves.toMatchObject({ allowed: false });
    await expect(getNeuronUsage(env)).resolves.toBeNull();
  });

  it('estimates Workers AI text neurons from conservative byte and output-token bounds', () => {
    const short = estimateNeuronCost('@cf/meta/llama-3.2-1b-instruct', {
      inputBytes: 400,
      outputTokens: 100,
    });
    const long = estimateNeuronCost('@cf/meta/llama-3.2-1b-instruct', {
      inputBytes: 4_000,
      outputTokens: 1_000,
    });

    expect(short ?? 0).toBeGreaterThanOrEqual(2);
    expect(long ?? 0).toBeGreaterThan(short ?? 0);
    expect(
      estimateNeuronCost('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        inputBytes: 0,
        outputTokens: 512,
      })
    ).toBe(22);
  });

  it('covers current published text and embedding prices and rejects unknown or unbounded models', () => {
    expect(estimateNeuronCost('@cf/meta/llama-3.2-1b-instruct') ?? 0).toBeGreaterThanOrEqual(1);
    expect(
      estimateNeuronCost('@cf/meta/llama-3.2-1b-instruct', {
        inputBytes: 0,
        outputTokens: 0,
      })
    ).toBeNull();

    const shortEmbedding = estimateNeuronCost('@cf/baai/bge-small-en-v1.5');
    const longEmbedding = estimateNeuronCost('@cf/baai/bge-small-en-v1.5', {
      inputBytes: 40_000,
    });
    expect(shortEmbedding).toBe(1);
    expect(longEmbedding ?? 0).toBeGreaterThan(shortEmbedding ?? 0);

    expect(estimateNeuronCost('@cf/black-forest-labs/flux-1-schnell')).toBeNull();
    expect(estimateNeuronCost('@cf/unknown/model')).toBeNull();
  });

  it('adds image parts to chat input estimates', () => {
    const bytes = estimateChatInputBytes([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
        ],
      },
    ]);

    expect(bytes).toBeNull();
    expect(
      estimateChatInputBytes([
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '' },
      ])
    ).toBe(
      new TextEncoder().encode(
        JSON.stringify([
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: '' },
        ])
      ).byteLength
    );
  });

  it('debits through the global budget durable object', async () => {
    const result = {
      allowed: true,
      used: 120,
      remaining: 9_380,
      retryAfter: 0,
      dayKey: new Date().toISOString().slice(0, 10),
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

  it.each([
    Response.json(
      {
        allowed: true,
        used: 12,
        remaining: 9_488,
        retryAfter: 0,
        dayKey: new Date().toISOString().slice(0, 10),
      },
      { status: 503 }
    ),
    Response.json({
      allowed: true,
      used: 12,
      remaining: 9_488,
      retryAfter: 0,
      dayKey: '2020-01-01',
    }),
    Response.json({
      allowed: 'true',
      used: 12,
      remaining: 9_488,
      retryAfter: 0,
      dayKey: new Date().toISOString().slice(0, 10),
    }),
  ])('rejects untrusted budget response %#', async (response) => {
    const env = makeEnv({ NEURON_BUDGET: budgetNamespace(vi.fn(async () => response)) });
    await expect(tryDebitNeurons(env, 12)).resolves.toMatchObject({ allowed: false, dayKey: '' });
  });

  it('rejects malformed reservations before reaching the durable object', async () => {
    const fetchMock = vi.fn();
    const env = makeEnv({ NEURON_BUDGET: budgetNamespace(fetchMock) });
    await expect(tryDebitNeurons(env, 1.5)).resolves.toMatchObject({ allowed: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads usage and degrades to null when usage is unavailable', async () => {
    await expect(getNeuronUsage(makeEnv())).resolves.toBeNull();

    const usage = {
      used: 320,
      remaining: 9_180,
      cap: 9_500,
      dayKey: new Date().toISOString().slice(0, 10),
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
      dayKey: new Date().toISOString().slice(0, 10),
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
        day_key: new Date().toISOString().slice(0, 10),
      },
    });

    expect(
      buildBudgetExhaustedResponse({
        allowed: false,
        used: 9_500,
        remaining: 0,
        retryAfter: 120,
        dayKey: new Date().toISOString().slice(0, 10),
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
