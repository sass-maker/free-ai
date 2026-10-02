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
        total_models: null,
        active_models: null,
        total_attempts: 4,
        success_rate: 0.5,
        avg_latency_ms: 0,
      },
    ]);
  });

  it('keeps missing metrics and providers without attempt history unmeasured', () => {
    const rows = normalizeProviderStats([
      { provider: 'unknown', total_attempts: 5, success_rate: 2, avg_latency_ms: -1 },
      {
        provider: 'unused',
        total_models: 2,
        active_models: 0,
        total_attempts: 0,
        success_rate: 0,
        avg_latency_ms: 0,
      },
      { provider: 'missing' },
    ])!;
    expect(rows[0]).toMatchObject({ success_rate: null, avg_latency_ms: null });
    expect(rows[1]).toMatchObject({
      active_models: 0,
      total_attempts: 0,
      success_rate: null,
      avg_latency_ms: null,
    });
    expect(rows[2]).toMatchObject({ total_attempts: null, success_rate: null });
    expect(summarizeProviderStats(rows)).toEqual({ totalAttempts: null, successRate: null });
    expect(summarizeProviderStats(rows.slice(0, 2))).toEqual({
      totalAttempts: 5,
      successRate: null,
    });
    expect(
      summarizeProviderStats([
        { provider: 'measured', total_attempts: 5, success_rate: 0 },
        rows[1],
      ])
    ).toEqual({ totalAttempts: 5, successRate: 0 });
  });

  it('distinguishes valid empty data from unknown, malformed and partial data', () => {
    expect(normalizeProviderStats([])).toEqual([]);
    expect(summarizeProviderStats([])).toEqual({ totalAttempts: 0, successRate: null });
    for (const value of [undefined, null, {}, 'invalid', 0, { provider: 'groq' }]) {
      expect(normalizeProviderStats(value)).toBeNull();
      expect(summarizeProviderStats(value)).toEqual({ totalAttempts: null, successRate: null });
    }
    for (const value of [[null], [{}], [{ provider: '' }], [{ provider: '  ' }]]) {
      expect(normalizeProviderStats(value)).toBeNull();
      expect(summarizeProviderStats(value)).toEqual({ totalAttempts: null, successRate: null });
    }
    const measured = { provider: 'groq', total_attempts: 4, success_rate: 0, avg_latency_ms: 0 };
    expect(normalizeProviderStats([measured, null])).toHaveLength(1);
    expect(summarizeProviderStats([measured, null])).toEqual({
      totalAttempts: null,
      successRate: null,
    });
    expect(summarizeProviderStats([measured])).toEqual({ totalAttempts: 4, successRate: 0 });
    expect(normalizeProviderStats([measured])?.[0].avg_latency_ms).toBe(0);
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
