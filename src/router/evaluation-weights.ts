import type { ModelEvaluationSnapshot } from '../types';

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function evaluationWeight(snapshot: ModelEvaluationSnapshot | undefined): number {
  if (!snapshot) {
    return 1;
  }

  const quality = clamp(finiteOr(snapshot.qualityScore, 0.5));
  const taskSuccess = clamp(finiteOr(snapshot.taskSuccessRate, 0.5));
  const freshness = clamp(finiteOr(snapshot.freshness, 0.5));
  const sampleConfidence = clamp(finiteOr(snapshot.sampleCount, 0) / 20);
  const blended = quality * 0.45 + taskSuccess * 0.35 + freshness * 0.1 + sampleConfidence * 0.1;

  // Keep evals as a strong nudge, not an override for health, cooldown, or capability filters.
  return 0.8 + blended * 0.4;
}

export function parseEvaluationWeights(raw: string | undefined): Map<string, ModelEvaluationSnapshot> {
  if (!raw) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Map();
    }

    const result = new Map<string, ModelEvaluationSnapshot>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const row = value as Record<string, unknown>;
      result.set(key, {
        qualityScore: clamp(finiteOr(row['qualityScore'], 0.5)),
        taskSuccessRate: clamp(finiteOr(row['taskSuccessRate'], 0.5)),
        freshness: clamp(finiteOr(row['freshness'], 0.5)),
        sampleCount: Math.max(0, Math.floor(finiteOr(row['sampleCount'], 0))),
        evaluatedAt: typeof row['evaluatedAt'] === 'string' ? row['evaluatedAt'] : undefined,
      });
    }

    return result;
  } catch {
    return new Map();
  }
}
