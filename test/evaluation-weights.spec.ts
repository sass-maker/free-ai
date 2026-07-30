import { describe, expect, it } from 'vitest';

import { evaluationWeight, parseEvaluationWeights } from '../src/router/evaluation-weights';

describe('evaluationWeight', () => {
  it('is neutral without an evaluation snapshot', () => {
    expect(evaluationWeight(undefined)).toBe(1);
  });

  it('rewards a fully supported evaluation without exceeding the nudge range', () => {
    expect(
      evaluationWeight({
        qualityScore: 1,
        taskSuccessRate: 1,
        freshness: 1,
        sampleCount: 20,
      })
    ).toBeCloseTo(1.2);
  });

  it('clamps out-of-range values and falls back for non-finite inputs', () => {
    expect(
      evaluationWeight({
        qualityScore: 2,
        taskSuccessRate: -1,
        freshness: Number.NaN,
        sampleCount: 100,
      })
    ).toBeCloseTo(1.04);
  });
});

describe('parseEvaluationWeights', () => {
  it('returns an empty map for absent or malformed input', () => {
    expect(parseEvaluationWeights(undefined)).toEqual(new Map());
    expect(parseEvaluationWeights('not json')).toEqual(new Map());
    expect(parseEvaluationWeights('null')).toEqual(new Map());
    expect(parseEvaluationWeights('[]')).toEqual(new Map());
  });

  it('normalizes valid rows and skips non-object entries', () => {
    const weights = parseEvaluationWeights(
      JSON.stringify({
        'model-a': {
          qualityScore: 1.4,
          taskSuccessRate: -0.2,
          freshness: 0.8,
          sampleCount: 12.9,
          evaluatedAt: '2026-07-31T00:00:00Z',
        },
        'model-b': {
          qualityScore: 'unknown',
          taskSuccessRate: null,
          freshness: Number.NaN,
          sampleCount: -5,
          evaluatedAt: 42,
        },
        skippedNull: null,
        skippedArray: [],
        skippedPrimitive: 1,
      })
    );

    expect([...weights.entries()]).toEqual([
      [
        'model-a',
        {
          qualityScore: 1,
          taskSuccessRate: 0,
          freshness: 0.8,
          sampleCount: 12,
          evaluatedAt: '2026-07-31T00:00:00Z',
        },
      ],
      [
        'model-b',
        {
          qualityScore: 0.5,
          taskSuccessRate: 0.5,
          freshness: 0.5,
          sampleCount: 0,
          evaluatedAt: undefined,
        },
      ],
    ]);
  });
});
