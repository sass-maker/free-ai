import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { getModelRegistry } from '../src/config';
import { selectCandidates } from '../src/router/select-model';
import type { Env, ModelStateSnapshot } from '../src/types';

const registry = getModelRegistry({
  AI: { run: async () => ({}) },
  WORKERS_AI_ENABLED: 'true',
  GROQ_API_KEY: 'benchmark',
  GEMINI_API_KEY: 'benchmark',
  OPENROUTER_API_KEY: 'benchmark',
  CEREBRAS_API_KEY: 'benchmark',
  SAMBANOVA_API_KEY: 'benchmark',
  NVIDIA_API_KEY: 'benchmark',
  GITHUB_TOKEN: 'benchmark',
  COHERE_API_KEY: 'benchmark',
  MISTRAL_API_KEY: 'benchmark',
  ZAI_API_KEY: 'benchmark',
  MODELSCOPE_API_KEY: 'benchmark',
  SILICONFLOW_API_KEY: 'benchmark',
} as unknown as Env);

function stateFor(key: string, index: number): ModelStateSnapshot {
  const latency = 250 + ((index * 197) % 4_500);
  return {
    key,
    attempts: 20,
    successRate: 0.76 + ((index * 17) % 24) / 100,
    avgLatencyMs: latency,
    p90LatencyMs: latency * 1.4,
    p99LatencyMs: latency * 2,
    cooldownUntil: 0,
    headroom: 0.2 + ((index * 13) % 80) / 100,
    dailyUsed: index,
    dailyLimit: 500,
    shortRetriableFailures: 0,
  };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('model selection performance', () => {
  it('model selection scales across the supported registry size', () => {
    expect(registry).toHaveLength(79);
    const metrics: string[] = [];
    const observedHashes: Record<number, string> = {};

    const expectedHashes: Record<number, string> = {
      20: '132325a90ed591e4f3b0c8b987499f765fcbc2dc07ceee047e5f11dd0ba42368',
      50: 'd1590796ce20c4ebab8ab117c4f5e071029e337682e71bd6a80b04a26897fb4c',
      79: '7381636c16b858a36977af2d460b535999a72b842a83f2a7adeb1b8f247db88e',
    };

    for (const size of [20, 50, 79]) {
      const candidates = registry.slice(0, size);
      const states = new Map(
        candidates.map((candidate, index) => {
          const key = `${candidate.provider}:${candidate.model}`;
          return [key, stateFor(key, index)] as const;
        })
      );
      const options = { stream: true, now: 1_800_000_000_000 };
      const iterations = 5_000;

      const selected = selectCandidates(candidates, states, options);
      const outputHash = digest(selected.map((candidate) => candidate.id));
      observedHashes[size] = outputHash;

      const startedAt = performance.now();
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        selectCandidates(candidates, states, options);
      }
      const millisecondsPerOperation = (performance.now() - startedAt) / iterations;
      metrics.push(`size${size}=${millisecondsPerOperation.toFixed(6)}ms/op`);
    }

    console.log(`[benchmark-hashes] ${JSON.stringify(observedHashes)}`);
    for (const [size, outputHash] of Object.entries(observedHashes)) {
      expect(outputHash).toBe(expectedHashes[Number(size)]);
    }
    console.log(`[benchmark] ${metrics.join(' ')} (5000 iterations)`);
    console.log(`[resource] maximum_supported_models=${registry.length}`);
  });
});
