import { describe, expect, it } from 'vitest';

import { getModelRegistry } from '../src/config';
import type { Env } from '../src/types';

describe('reviewed model registry sync', () => {
  it('keeps newly discovered OpenRouter candidates out of default routing until smoke-tested', () => {
    const registry = getModelRegistry({ OPENROUTER_API_KEY: 'test' } as Env);
    const models = registry.map((candidate) => candidate.model);

    expect(models).not.toContain('inclusionai/ling-3.0-tiny:free');
    expect(models).not.toContain('poolside/laguna-s-2.1:free');
  });

  it('does not retain OpenRouter models removed by the public upstream catalog', () => {
    const registry = getModelRegistry({ OPENROUTER_API_KEY: 'test' } as Env);
    const models = registry.map((candidate) => candidate.model);

    expect(models).not.toContain('nousresearch/hermes-3-llama-3.1-405b:free');
    expect(models).not.toContain('qwen/qwen3-coder:free');
    expect(models).not.toContain('poolside/laguna-m.1:free');
  });
});
