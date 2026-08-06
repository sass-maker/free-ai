import { describe, expect, it } from 'vitest';

import { getModelRegistry, getProviderLimits } from '../src/config';
import { providerCallers } from '../src/providers';
import { callModelScope } from '../src/providers/modelscope';
import { callSiliconFlow } from '../src/providers/siliconflow';
import type { Env, TextProvider } from '../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATEWAY_DB: {} as D1Database,
    HEALTH_DO: {} as DurableObjectNamespace,
    RATE_LIMIT_DO: {} as DurableObjectNamespace,
    HEALTH_KV: {} as KVNamespace,
    ...overrides,
  };
}

const baseInput = {
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'hello' }],
  stream: false,
};

describe('staged provider integrations', () => {
  it('registers both OpenAI-compatible callers', () => {
    expect(providerCallers.modelscope).toBeTypeOf('function');
    expect(providerCallers.siliconflow).toBeTypeOf('function');
  });

  it('rejects ModelScope calls without a key', async () => {
    await expect(
      callModelScope({ ...baseInput, provider: 'modelscope' as TextProvider, env: makeEnv() })
    ).rejects.toThrow('MODELSCOPE_API_KEY is not configured');
  });

  it('rejects SiliconFlow calls without a key', async () => {
    await expect(
      callSiliconFlow({ ...baseInput, provider: 'siliconflow' as TextProvider, env: makeEnv() })
    ).rejects.toThrow('SILICONFLOW_API_KEY is not configured');
  });

  it('keeps staged candidates out of routing even when keys exist', () => {
    const registry = getModelRegistry(
      makeEnv({ MODELSCOPE_API_KEY: 'modelscope-key', SILICONFLOW_API_KEY: 'siliconflow-key' })
    );

    expect(registry.some((candidate) => candidate.provider === 'modelscope')).toBe(false);
    expect(registry.some((candidate) => candidate.provider === 'siliconflow')).toBe(false);
  });

  it('does not stage the paid SiliconFlow Qwen3-8B model as free capacity', () => {
    const limits = getProviderLimits(makeEnv());

    expect(limits['siliconflow:Qwen/Qwen3-8B']).toBeUndefined();
  });
});
