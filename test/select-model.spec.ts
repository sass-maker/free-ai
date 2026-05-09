import { describe, expect, it } from 'vitest';

import { getModelRegistry } from '../src/config';
import { computeScore, deriveRequiredCapabilities, selectCandidates } from '../src/router/select-model';
import type { Env, ModelCandidate, ModelStateSnapshot } from '../src/types';

const defaultCaps = { toolCalling: false, jsonMode: false, vision: false, contextWindow: 8192, maxOutputTokens: 4096 };
const agentCaps = { toolCalling: true, jsonMode: true, vision: false, contextWindow: 131072, maxOutputTokens: 8192 };
const visionCaps = { toolCalling: true, jsonMode: true, vision: true, contextWindow: 131072, maxOutputTokens: 8192 };

const registry: ModelCandidate[] = [
  {
    id: 'a',
    provider: 'groq',
    model: 'model-a',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.9,
    capabilities: agentCaps,
  },
  {
    id: 'b',
    provider: 'gemini',
    model: 'model-b',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.8,
    capabilities: visionCaps,
  },
  {
    id: 'c',
    provider: 'workers_ai',
    model: 'model-c',
    reasoning: 'low',
    supportsStreaming: false,
    enabled: true,
    priority: 0.7,
    capabilities: defaultCaps,
  },
];

function snapshot(key: string, successRate: number, avgLatencyMs: number, cooldownUntil = 0): ModelStateSnapshot {
  return {
    key,
    attempts: 10,
    successRate,
    avgLatencyMs,
    cooldownUntil,
    headroom: 0.9,
    dailyUsed: 10,
    dailyLimit: 100,
    shortRetriableFailures: 0,
  };
}

describe('computeScore', () => {
  it('prefers higher success rate over lower latency when close', () => {
    const highSuccess = computeScore('medium', registry[0], snapshot('groq:model-a', 0.95, 1800), undefined);
    const lowSuccessFast = computeScore('medium', registry[1], snapshot('gemini:model-b', 0.55, 300), undefined);
    expect(highSuccess).toBeGreaterThan(lowSuccessFast);
  });

  it('uses continuous evaluation as a routing weight', () => {
    const baseline = computeScore('medium', registry[0], snapshot('groq:model-a', 0.8, 900), undefined);
    const evaluated = computeScore('medium', registry[0], snapshot('groq:model-a', 0.8, 900), {
      qualityScore: 1,
      taskSuccessRate: 1,
      freshness: 1,
      sampleCount: 20,
    });

    expect(evaluated).toBeGreaterThan(baseline);
  });
});

describe('selectCandidates', () => {
  it('filters out non-streaming candidates for stream requests', () => {
    const selected = selectCandidates(registry, new Map(), {
      min_reasoning_level: 'medium',
      stream: true,
      now: Date.now(),
    });

    expect(selected.some((candidate) => candidate.provider === 'workers_ai')).toBe(false);
  });

  it('filters out cooldowned candidates', () => {
    const now = Date.now();
    const selected = selectCandidates(
      registry,
      new Map([
        ['groq:model-a', snapshot('groq:model-a', 0.95, 500, now + 30_000)],
        ['gemini:model-b', snapshot('gemini:model-b', 0.8, 500, 0)],
      ]),
      {
        min_reasoning_level: 'medium',
        stream: false,
        now,
      },
    );

    expect(selected[0]?.provider).toBe('gemini');
  });

  it('lets eval weights reorder otherwise healthy candidates', () => {
    const selected = selectCandidates(
      registry,
      new Map([
        ['groq:model-a', snapshot('groq:model-a', 0.8, 800, 0)],
        ['gemini:model-b', snapshot('gemini:model-b', 0.8, 800, 0)],
      ]),
      {
        min_reasoning_level: 'medium',
        stream: false,
        now: Date.now(),
        evaluationMap: new Map([
          [
            'gemini:model-b',
            {
              qualityScore: 1,
              taskSuccessRate: 1,
              freshness: 1,
              sampleCount: 25,
            },
          ],
          [
            'groq:model-a',
            {
              qualityScore: 0.2,
              taskSuccessRate: 0.2,
              freshness: 0.4,
              sampleCount: 25,
            },
          ],
        ]),
      },
    );

    expect(selected[0]?.provider).toBe('gemini');
  });

  it('filters out models without tool calling when tools are required', () => {
    const selected = selectCandidates(registry, new Map(), {
      min_reasoning_level: 'medium',
      stream: false,
      now: Date.now(),
      requiredCapabilities: { toolCalling: true },
    });

    expect(selected.every((c) => c.capabilities.toolCalling)).toBe(true);
    expect(selected.some((c) => c.provider === 'workers_ai')).toBe(false);
  });

  it('filters out models without json mode when json_object is required', () => {
    const selected = selectCandidates(registry, new Map(), {
      min_reasoning_level: 'medium',
      stream: false,
      now: Date.now(),
      requiredCapabilities: { jsonMode: true },
    });

    expect(selected.every((c) => c.capabilities.jsonMode)).toBe(true);
    expect(selected.some((c) => c.provider === 'workers_ai')).toBe(false);
  });

  it('filters out models without vision when vision is required', () => {
    const selected = selectCandidates(registry, new Map(), {
      min_reasoning_level: 'medium',
      stream: false,
      now: Date.now(),
      requiredCapabilities: { vision: true },
    });

    expect(selected.every((c) => c.capabilities.vision)).toBe(true);
    expect(selected.length).toBe(1);
    expect(selected[0].provider).toBe('gemini');
  });

  it('filters GitHub OpenAI reasoning models from image requests even if registry marks them as vision-capable', () => {
    const staleGithubVisionRegistry: ModelCandidate[] = [
      {
        id: 'gh-gpt-5-mini',
        provider: 'github_models',
        model: 'openai/gpt-5-mini',
        reasoning: 'high',
        supportsStreaming: true,
        enabled: true,
        priority: 0.99,
        capabilities: visionCaps,
      },
      {
        id: 'gh-o4-mini',
        provider: 'github_models',
        model: 'openai/o4-mini',
        reasoning: 'high',
        supportsStreaming: true,
        enabled: true,
        priority: 0.98,
        capabilities: visionCaps,
      },
      {
        id: 'gemini-vision',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        reasoning: 'high',
        supportsStreaming: true,
        enabled: true,
        priority: 0.7,
        capabilities: visionCaps,
      },
    ];

    const selected = selectCandidates(staleGithubVisionRegistry, new Map(), {
      min_reasoning_level: 'high',
      stream: false,
      now: Date.now(),
      requiredCapabilities: { vision: true },
    });

    expect(selected.map((candidate) => candidate.model)).toEqual(['gemini-2.5-flash']);
  });

  it('returns all candidates when no capabilities are required', () => {
    const selected = selectCandidates(registry, new Map(), {
      min_reasoning_level: undefined,
      stream: false,
      now: Date.now(),
    });

    expect(selected.length).toBe(3);
  });

  it('does not route below the requested minimum reasoning level', () => {
    const selected = selectCandidates(registry, new Map(), {
      min_reasoning_level: 'medium',
      stream: false,
      now: Date.now(),
    });

    expect(selected.every((candidate) => candidate.reasoning !== 'low')).toBe(true);
  });
});

describe('deriveRequiredCapabilities', () => {
  it('returns toolCalling when tools are present', () => {
    const caps = deriveRequiredCapabilities({
      tools: [{ type: 'function', function: { name: 'get_weather' } }],
    });
    expect(caps.toolCalling).toBe(true);
    expect(caps.jsonMode).toBeUndefined();
  });

  it('returns jsonMode when response_format is json_object', () => {
    const caps = deriveRequiredCapabilities({
      response_format: { type: 'json_object' },
    });
    expect(caps.jsonMode).toBe(true);
    expect(caps.toolCalling).toBeUndefined();
  });

  it('returns empty when no special requirements', () => {
    const caps = deriveRequiredCapabilities({});
    expect(caps.toolCalling).toBeUndefined();
    expect(caps.jsonMode).toBeUndefined();
    expect(caps.vision).toBeUndefined();
  });

  it('detects vision when messages contain image_url parts', () => {
    const caps = deriveRequiredCapabilities({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
          ],
        },
      ],
    });
    expect(caps.vision).toBe(true);
  });

  it('does not set vision for text-only messages', () => {
    const caps = deriveRequiredCapabilities({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(caps.vision).toBeUndefined();
  });

  it('estimates minContextWindow from message length', () => {
    const longContent = 'x'.repeat(40_000); // ~10K tokens
    const caps = deriveRequiredCapabilities({
      messages: [{ role: 'user', content: longContent }],
    });
    expect(caps.minContextWindow).toBeGreaterThan(10_000);
  });
});

describe('selectCandidates — context window filtering', () => {
  const smallCtxModel: ModelCandidate = {
    id: 'small-ctx',
    provider: 'workers_ai',
    model: 'small',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.9,
    capabilities: { toolCalling: false, jsonMode: false, vision: false, contextWindow: 2048, maxOutputTokens: 1024 },
  };

  const largeCtxModel: ModelCandidate = {
    id: 'large-ctx',
    provider: 'groq',
    model: 'large',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.8,
    capabilities: { toolCalling: true, jsonMode: true, vision: false, contextWindow: 131072, maxOutputTokens: 8192 },
  };

  it('filters out models with insufficient context window', () => {
    const selected = selectCandidates([smallCtxModel, largeCtxModel], new Map(), {
      min_reasoning_level: 'medium',
      stream: false,
      now: Date.now(),
      requiredCapabilities: { minContextWindow: 10_000 },
    });

    expect(selected.length).toBe(1);
    expect(selected[0].id).toBe('large-ctx');
  });

  it('keeps all models when context requirement is small', () => {
    const selected = selectCandidates([smallCtxModel, largeCtxModel], new Map(), {
      min_reasoning_level: 'medium',
      stream: false,
      now: Date.now(),
      requiredCapabilities: { minContextWindow: 1000 },
    });

    expect(selected.length).toBe(2);
  });
});

describe('default registry vision coverage', () => {
  const allProviderKeysEnv = {
    GROQ_API_KEY: 'test',
    GEMINI_API_KEY: 'test',
    OPENROUTER_API_KEY: 'test',
    CEREBRAS_API_KEY: 'test',
    SAMBANOVA_API_KEY: 'test',
    NVIDIA_API_KEY: 'test',
    GITHUB_TOKEN: 'test',
    COHERE_API_KEY: 'test',
    MISTRAL_API_KEY: 'test',
  } as Env;

  it('keeps a broad vision-capable pool for high-effort image requests', () => {
    const selected = selectCandidates(getModelRegistry(allProviderKeysEnv), new Map(), {
      min_reasoning_level: 'high',
      stream: false,
      now: Date.now(),
      requiredCapabilities: { vision: true },
    });

    const highTier = selected.filter((candidate) => candidate.reasoning === 'high');
    const providers = new Set(selected.map((candidate) => candidate.provider));
    const models = selected.map((candidate) => candidate.model);

    expect(selected.every((candidate) => candidate.reasoning === 'high')).toBe(true);
    expect(selected.length).toBeGreaterThanOrEqual(5);
    expect(highTier.length).toBeGreaterThanOrEqual(5);
    expect(providers.size).toBeGreaterThanOrEqual(4);
    expect(models).not.toContain('openai/gpt-5-mini');
    expect(models).not.toContain('openai/o4-mini');
  });
});
