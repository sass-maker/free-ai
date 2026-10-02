import { describe, expect, it } from 'vitest';

import { normalizeProviderStats, summarizeProviderStats } from '../site/src/lib/provider-stats';

describe('provider status view data', () => {
  it('normalizes the public ProviderStats array and ignores malformed rows', () => {
    expect(
      normalizeProviderStats([
        {
          provider: 'groq',
          total_models: 3,
          active_models: 2,
          total_attempts: 100,
          success_rate: 0.9,
          avg_latency_ms: 320,
        },
        {
          provider: '<img>',
          total_models: Number.NaN,
          active_models: '2',
          total_attempts: 4,
          success_rate: 0.5,
          avg_latency_ms: 0,
        },
        { total_attempts: 99 },
      ])
    ).toEqual([
      {
        provider: 'groq',
        total_models: 3,
        active_models: 2,
        total_attempts: 100,
        success_rate: 0.9,
        avg_latency_ms: 320,
      },
      {
        provider: '<img>',
        total_models: 0,
        active_models: 0,
        total_attempts: 4,
        success_rate: 0.5,
        avg_latency_ms: 0,
      },
    ]);
  });

  it('weights the overall success rate by attempts and handles empty history', () => {
    expect(
      summarizeProviderStats([
        { provider: 'a', total_attempts: 100, success_rate: 0.9 },
        { provider: 'b', total_attempts: 10, success_rate: 0.5 },
      ])
    ).toEqual({ totalAttempts: 110, successRate: (100 * 0.9 + 10 * 0.5) / 110 });
    expect(summarizeProviderStats([])).toEqual({ totalAttempts: 0, successRate: null });
  });
});
