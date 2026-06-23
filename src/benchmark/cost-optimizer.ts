import fixture from '../../fixtures/benchmark-cost-optimizer.json';

export type BenchmarkQualityTier = 'low' | 'medium' | 'high';
export type BenchmarkModelStatus = 'available' | 'degraded' | 'cooldown' | 'exhausted';

export interface BenchmarkCandidate {
  id: string;
  provider: string;
  model: string;
  quality_tier: BenchmarkQualityTier;
  cost_usd_per_1m_tokens: number;
  latency_ms_p50: number;
  latency_ms_p90: number;
  success_rate: number;
  cooldown_until: number;
  status: BenchmarkModelStatus;
  headroom: number;
  score: number;
}

export interface BenchmarkWorkload {
  id: string;
  label: string;
  prompt_class: string;
  description: string;
}

export interface BenchmarkRouteRecommendation {
  workload_id: string;
  recommended: {
    provider: string;
    model: string;
    id: string;
    reason: string;
  };
  alternates: Array<{ id: string; reason: string }>;
}

export interface BenchmarkExperimentEntry {
  id: string;
  label: string;
  recorded_at: string;
  change: string;
  notes: string;
  baseline_id?: string;
  metrics: {
    avg_success_rate: number;
    avg_latency_ms: number;
    estimated_cost_usd_per_1k_req: number;
    fallback_rate: number;
  };
}

export interface BenchmarkOptimizerResponse {
  ok: true;
  source: string;
  fixture_id: string;
  generated_at: string;
  privacy: {
    stores_prompt_text: false;
    uses_synthetic_benchmarks: boolean;
  };
  cost_basis: {
    unit: string;
    note: string;
  };
  workloads: BenchmarkWorkload[];
  candidates: BenchmarkCandidate[];
  routes_by_workload: BenchmarkRouteRecommendation[];
  experiments: BenchmarkExperimentEntry[];
}

export interface BenchmarkExperimentCreateBody {
  label: string;
  change?: string;
  notes?: string;
  baseline_id?: string;
}

export interface BenchmarkExperimentCreateResponse {
  ok: true;
  stored: 'session_fixture_only';
  entry: BenchmarkExperimentEntry;
  message: string;
}

const fixturePayload = fixture as BenchmarkOptimizerResponse;

export function getBenchmarkOptimizerFixture(): BenchmarkOptimizerResponse {
  return {
    ...fixturePayload,
    generated_at: fixturePayload.generated_at,
  };
}

export function createBenchmarkExperimentEntry(
  body: BenchmarkExperimentCreateBody
): BenchmarkExperimentCreateResponse {
  const now = new Date();
  const entry: BenchmarkExperimentEntry = {
    id: `exp-local-${now.getTime()}`,
    label: body.label.trim() || 'Untitled experiment',
    recorded_at: now.toISOString(),
    change: body.change?.trim() || 'Manual operator snapshot',
    notes: body.notes?.trim() || '',
    baseline_id: body.baseline_id,
    metrics: {
      avg_success_rate: 0.9,
      avg_latency_ms: 720,
      estimated_cost_usd_per_1k_req: 0,
      fallback_rate: 0.12,
    },
  };

  return {
    ok: true,
    stored: 'session_fixture_only',
    entry,
    message:
      'Prototype entry returned for client-side ledger merge. Persist to D1 in a follow-up; prompt text is never stored.',
  };
}
