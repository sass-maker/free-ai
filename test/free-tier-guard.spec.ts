import { describe, expect, it, vi } from 'vitest';

import { getModelRegistry, getTtsRegistry, isWorkersAiEnabled } from '../src/config';
import { callWorkersAi } from '../src/providers/workers-ai';
import { classifyError, isRetriableFailure } from '../src/router/classify-error';
import {
  estimateChatInputChars,
  estimateNeuronCost,
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

describe('Workers AI free-tier guard', () => {
  it('keeps Command Code catalog models gated behind COMMAND_CODE_API_KEY', () => {
    const withoutKey = getModelRegistry(makeEnv());
    const withKey = getModelRegistry(makeEnv({ COMMAND_CODE_API_KEY: 'test-command-code-key' }));

    const commandCodeModels = withKey.filter((candidate) => candidate.provider === 'command_code');
    const topCommandCodeModel = commandCodeModels.reduce((top, candidate) =>
      candidate.priority > top.priority ? candidate : top
    );

    expect(withoutKey.some((candidate) => candidate.provider === 'command_code')).toBe(false);
    expect(commandCodeModels.length).toBe(29);
    expect(topCommandCodeModel).toMatchObject({
      id: 'command-code-mimo-v2-5',
      provider: 'command_code',
      model: 'xiaomi/mimo-v2.5',
    });
    expect(withKey).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'command-code-mimo-v2-5',
          provider: 'command_code',
          model: 'xiaomi/mimo-v2.5',
        }),
      ])
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
