import { deriveRequiredCapabilities } from '../router/select-model';
import type {
  ChatMessage,
  GatewayMeta,
  NormalizedChatRequest,
  ProviderQuotaStatus,
  ResponseFormat,
  TextProvider,
  Tool,
} from '../types';

export type RoutingOutcome = 'ok' | 'error' | 'no_candidate' | 'quota_exhausted';

export interface FallbackHop {
  provider: string;
  model: string;
  outcome?: 'ok' | 'failed';
  latency_ms?: number;
}

export interface RoutingLedgerRecord {
  endpoint: string;
  project_id?: string;
  prompt_class: string;
  requested_model: string;
  chosen_provider?: string;
  chosen_model?: string;
  fallback_chain: FallbackHop[];
  quota_state: Record<string, { status: string; limit_remaining?: number | null }>;
  latency_ms: number;
  outcome: RoutingOutcome;
  attempts: number;
  error_class?: string;
}

interface RoutingLedgerBreakdownRow {
  key: string;
  requests: number;
  successful: number;
  failed: number;
  success_rate: number;
  avg_latency_ms: number;
  avg_attempts: number;
  fallback_rate: number;
}

export interface RoutingLedgerResponse {
  ok: true;
  generated_at: string;
  days: number;
  project_id?: string;
  privacy: {
    stores_prompt_text: false;
    stores_request_ids: false;
  };
  summary: {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate: number;
    avg_latency_ms: number;
    avg_attempts: number;
    fallback_rate: number;
  };
  by_prompt_class: RoutingLedgerBreakdownRow[];
  by_outcome: RoutingLedgerBreakdownRow[];
  by_model: RoutingLedgerBreakdownRow[];
  by_quota_signature: RoutingLedgerBreakdownRow[];
  top_fallback_signatures: Array<{
    signature: string;
    requests: number;
    success_rate: number;
    avg_latency_ms: number;
    fallback_rate: number;
  }>;
}

export function derivePromptClass(params: {
  tools?: Tool[];
  response_format?: ResponseFormat;
  messages: ChatMessage[];
  stream?: boolean;
}): string {
  const parts = new Set<string>(['text']);
  const caps = deriveRequiredCapabilities({
    tools: params.tools,
    response_format: params.response_format,
    messages: params.messages,
  });

  if (caps.vision) {
    parts.add('vision');
  }
  if (caps.toolCalling) {
    parts.add('tools');
  }
  if (caps.jsonMode) {
    parts.add('json');
  }
  if (params.stream) {
    parts.add('stream');
  }

  return [...parts].sort().join('+');
}

export function buildFallbackSignature(chain: FallbackHop[]): string {
  if (chain.length === 0) {
    return 'none';
  }

  return chain
    .map((hop) => {
      const outcome = hop.outcome ? `:${hop.outcome}` : '';
      return `${hop.provider}/${hop.model}${outcome}`;
    })
    .join('>');
}

export function buildQuotaSignature(quotas: Map<TextProvider, ProviderQuotaStatus>): string {
  const exhausted = [...quotas.entries()]
    .filter(([, status]) => status.status === 'exhausted')
    .map(([provider]) => provider)
    .sort();

  return exhausted.length > 0 ? exhausted.join(',') : 'all_ok';
}

export function buildChatLedgerRecord(params: {
  endpoint: string;
  projectId: string;
  normalized: NormalizedChatRequest;
  requestedModel: string;
  quotaStatuses: Map<TextProvider, ProviderQuotaStatus>;
  fallbackHops: FallbackHop[];
  chosenMeta?: GatewayMeta;
  outcome: RoutingOutcome;
  requestStartedAt: number;
  errorClass?: string;
}): RoutingLedgerRecord {
  return {
    endpoint: params.endpoint,
    project_id: params.projectId,
    prompt_class: derivePromptClass({
      tools: params.normalized.tools,
      response_format: params.normalized.response_format,
      messages: params.normalized.messages,
      stream: params.normalized.stream,
    }),
    requested_model: params.requestedModel,
    chosen_provider: params.chosenMeta?.provider,
    chosen_model: params.chosenMeta?.model,
    fallback_chain: params.fallbackHops,
    quota_state: compactQuotaState(params.quotaStatuses),
    latency_ms: Date.now() - params.requestStartedAt,
    outcome: params.outcome,
    attempts: params.chosenMeta?.attempts ?? Math.max(1, params.fallbackHops.length),
    error_class: params.errorClass,
  };
}

function compactQuotaState(
  quotas: Map<TextProvider, ProviderQuotaStatus>
): Record<string, { status: string; limit_remaining?: number | null }> {
  return Object.fromEntries(
    [...quotas.entries()].map(([provider, status]) => [
      provider,
      {
        status: status.status,
        limit_remaining: status.limitRemaining ?? null,
      },
    ])
  );
}

export async function recordRoutingLedger(
  db: D1Database,
  record: RoutingLedgerRecord
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const projectId = record.project_id ?? '';
  const chosenProvider = record.chosen_provider ?? '';
  const chosenModel = record.chosen_model ?? '';
  const fallbackSignature = buildFallbackSignature(record.fallback_chain);
  const quotaSignature = buildQuotaSignatureFromState(record.quota_state);
  const withFallback = record.attempts > 1 ? 1 : 0;

  try {
    await db
      .prepare(
        `INSERT INTO routing_ledger_rollup (
          date, project_id, prompt_class, outcome, chosen_provider, chosen_model,
          fallback_signature, quota_signature, request_count, sum_latency_ms, sum_attempts, with_fallback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(
          date, project_id, prompt_class, outcome, chosen_provider, chosen_model, fallback_signature, quota_signature
        ) DO UPDATE SET
          request_count = request_count + 1,
          sum_latency_ms = sum_latency_ms + excluded.sum_latency_ms,
          sum_attempts = sum_attempts + excluded.sum_attempts,
          with_fallback = with_fallback + excluded.with_fallback`
      )
      .bind(
        date,
        projectId,
        record.prompt_class,
        record.outcome,
        chosenProvider,
        chosenModel,
        fallbackSignature,
        quotaSignature,
        Math.max(0, Math.round(record.latency_ms)),
        Math.max(1, record.attempts),
        withFallback
      )
      .run();
  } catch {
    // Ignore ledger persistence errors so routing behavior stays unchanged.
  }
}

function buildQuotaSignatureFromState(quotaState: Record<string, { status: string }>): string {
  const exhausted = Object.entries(quotaState)
    .filter(([, value]) => value.status === 'exhausted')
    .map(([provider]) => provider)
    .sort();

  return exhausted.length > 0 ? exhausted.join(',') : 'all_ok';
}

interface RollupRow {
  prompt_class?: string;
  outcome?: string;
  chosen_provider?: string;
  chosen_model?: string;
  quota_signature?: string;
  fallback_signature?: string;
  request_count: number;
  sum_latency_ms: number;
  sum_attempts: number;
  with_fallback: number;
}

function rowFromAggregate(
  row: RollupRow,
  key: string,
  successfulRequests = 0
): RoutingLedgerBreakdownRow {
  const requests = row.request_count;
  const successful = Math.min(requests, successfulRequests);
  const failed = requests - successful;

  return {
    key,
    requests,
    successful,
    failed,
    success_rate: requests > 0 ? successful / requests : 0,
    avg_latency_ms: requests > 0 ? row.sum_latency_ms / requests : 0,
    avg_attempts: requests > 0 ? row.sum_attempts / requests : 0,
    fallback_rate: requests > 0 ? row.with_fallback / requests : 0,
  };
}

export async function queryRoutingLedger(
  db: D1Database,
  options: { days: number; project_id?: string }
): Promise<RoutingLedgerResponse> {
  const days = options.days;
  const filters = [`date >= date('now', ?)`];
  const params: unknown[] = [`-${days} days`];

  if (options.project_id) {
    filters.push('project_id = ?');
    params.push(options.project_id);
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  const totals = await db
    .prepare(
      `SELECT
        SUM(request_count) as total_requests,
        SUM(CASE WHEN outcome = 'ok' THEN request_count ELSE 0 END) as successful_requests,
        SUM(CASE WHEN outcome != 'ok' THEN request_count ELSE 0 END) as failed_requests,
        SUM(sum_latency_ms) as sum_latency_ms,
        SUM(sum_attempts) as sum_attempts,
        SUM(with_fallback) as with_fallback
      FROM routing_ledger_rollup ${where}`
    )
    .bind(...params)
    .first<{
      total_requests: number | null;
      successful_requests: number | null;
      failed_requests: number | null;
      sum_latency_ms: number | null;
      sum_attempts: number | null;
      with_fallback: number | null;
    }>();

  const byPromptClass = await db
    .prepare(
      `SELECT prompt_class,
        SUM(request_count) as request_count,
        SUM(sum_latency_ms) as sum_latency_ms,
        SUM(sum_attempts) as sum_attempts,
        SUM(with_fallback) as with_fallback,
        SUM(CASE WHEN outcome = 'ok' THEN request_count ELSE 0 END) as successful_requests
      FROM routing_ledger_rollup ${where}
      GROUP BY prompt_class
      ORDER BY request_count DESC`
    )
    .bind(...params)
    .all<RollupRow & { prompt_class: string; successful_requests: number }>();

  const byOutcome = await db
    .prepare(
      `SELECT outcome,
        SUM(request_count) as request_count,
        SUM(sum_latency_ms) as sum_latency_ms,
        SUM(sum_attempts) as sum_attempts,
        SUM(with_fallback) as with_fallback
      FROM routing_ledger_rollup ${where}
      GROUP BY outcome
      ORDER BY request_count DESC`
    )
    .bind(...params)
    .all<RollupRow & { outcome: string }>();

  const byModel = await db
    .prepare(
      `SELECT chosen_provider, chosen_model,
        SUM(request_count) as request_count,
        SUM(sum_latency_ms) as sum_latency_ms,
        SUM(sum_attempts) as sum_attempts,
        SUM(with_fallback) as with_fallback,
        SUM(CASE WHEN outcome = 'ok' THEN request_count ELSE 0 END) as successful_requests
      FROM routing_ledger_rollup ${where}
      GROUP BY chosen_provider, chosen_model
      ORDER BY request_count DESC
      LIMIT 40`
    )
    .bind(...params)
    .all<
      RollupRow & { chosen_provider: string; chosen_model: string; successful_requests: number }
    >();

  const byQuota = await db
    .prepare(
      `SELECT quota_signature,
        SUM(request_count) as request_count,
        SUM(sum_latency_ms) as sum_latency_ms,
        SUM(sum_attempts) as sum_attempts,
        SUM(with_fallback) as with_fallback,
        SUM(CASE WHEN outcome = 'ok' THEN request_count ELSE 0 END) as successful_requests
      FROM routing_ledger_rollup ${where}
      GROUP BY quota_signature
      ORDER BY request_count DESC`
    )
    .bind(...params)
    .all<RollupRow & { quota_signature: string; successful_requests: number }>();

  const fallbackSignatures = await db
    .prepare(
      `SELECT fallback_signature,
        SUM(request_count) as request_count,
        SUM(sum_latency_ms) as sum_latency_ms,
        SUM(sum_attempts) as sum_attempts,
        SUM(with_fallback) as with_fallback,
        SUM(CASE WHEN outcome = 'ok' THEN request_count ELSE 0 END) as successful_requests
      FROM routing_ledger_rollup ${where}
      GROUP BY fallback_signature
      ORDER BY request_count DESC
      LIMIT 20`
    )
    .bind(...params)
    .all<RollupRow & { fallback_signature: string; successful_requests: number }>();

  const totalRequests = totals?.total_requests ?? 0;
  const successfulRequests = totals?.successful_requests ?? 0;
  const failedRequests = totals?.failed_requests ?? 0;
  const sumLatency = totals?.sum_latency_ms ?? 0;
  const sumAttempts = totals?.sum_attempts ?? 0;
  const withFallback = totals?.with_fallback ?? 0;

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    days,
    project_id: options.project_id,
    privacy: {
      stores_prompt_text: false,
      stores_request_ids: false,
    },
    summary: {
      total_requests: totalRequests,
      successful_requests: successfulRequests,
      failed_requests: failedRequests,
      success_rate: totalRequests > 0 ? successfulRequests / totalRequests : 0,
      avg_latency_ms: totalRequests > 0 ? sumLatency / totalRequests : 0,
      avg_attempts: totalRequests > 0 ? sumAttempts / totalRequests : 0,
      fallback_rate: totalRequests > 0 ? withFallback / totalRequests : 0,
    },
    by_prompt_class: (byPromptClass.results ?? []).map((row) =>
      rowFromAggregate(row, row.prompt_class, row.successful_requests)
    ),
    by_outcome: (byOutcome.results ?? []).map((row) => {
      const successful = row.outcome === 'ok' ? row.request_count : 0;
      return rowFromAggregate(row, row.outcome, successful);
    }),
    by_model: (byModel.results ?? []).map((row) =>
      rowFromAggregate(
        row,
        row.chosen_provider && row.chosen_model
          ? `${row.chosen_provider}:${row.chosen_model}`
          : '(none)',
        row.successful_requests
      )
    ),
    by_quota_signature: (byQuota.results ?? []).map((row) =>
      rowFromAggregate(row, row.quota_signature, row.successful_requests)
    ),
    top_fallback_signatures: (fallbackSignatures.results ?? []).map((row) => ({
      signature: row.fallback_signature,
      requests: row.request_count,
      success_rate: row.request_count > 0 ? row.successful_requests / row.request_count : 0,
      avg_latency_ms: row.request_count > 0 ? row.sum_latency_ms / row.request_count : 0,
      fallback_rate: row.request_count > 0 ? row.with_fallback / row.request_count : 0,
    })),
  };
}
