import { describe, expect, it, vi } from 'vitest';

import { getModelRegistry, getTtsRegistry, isWorkersAiEnabled } from '../src/config';
import { callWorkersAi } from '../src/providers/workers-ai';
import { tryDebitNeurons } from '../src/state/neuron-budget';
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
  it('keeps Workers AI disabled unless explicitly opted in', () => {
    const ai = { run: vi.fn() };
    const disabledEnv = makeEnv({ AI: ai });
    const enabledEnv = makeEnv({ AI: ai, WORKERS_AI_ENABLED: 'true' });

    expect(isWorkersAiEnabled(disabledEnv)).toBe(false);
    expect(getModelRegistry(disabledEnv).some((candidate) => candidate.provider === 'workers_ai')).toBe(false);
    expect(getTtsRegistry(disabledEnv).some((candidate) => candidate.provider === 'workers_ai')).toBe(false);

    expect(isWorkersAiEnabled(enabledEnv)).toBe(true);
    expect(getModelRegistry(enabledEnv).some((candidate) => candidate.provider === 'workers_ai')).toBe(true);
    expect(getTtsRegistry(enabledEnv).some((candidate) => candidate.provider === 'workers_ai')).toBe(true);
  });

  it('fails closed when the neuron budget binding is unavailable', async () => {
    await expect(tryDebitNeurons(makeEnv(), 1)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
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
      }),
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
      }),
    ).rejects.toThrow('Daily Workers AI Neuron budget exhausted');

    expect(run).not.toHaveBeenCalled();
  });
});
