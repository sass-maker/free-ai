import pages from './public-runtime-pages.json';
import {
  loadHealthView,
  loadModelView,
  loadBenchmarkView,
  loadDashboardResponses,
  REPLAY_EXAMPLE,
  modelStatus,
  statusOf,
  capabilityText,
} from './public-view-data';

import { identity } from '../site/src/data/site-identity.mjs';
const origin = identity.url;
const cell = (value: unknown) =>
  String(value ?? '—')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ');
const fmt = (n: any) => Number(n || 0).toLocaleString('en-US');
const pct = (n: any) => (Number.isFinite(Number(n)) ? `${(Number(n) * 100).toFixed(1)}%` : '—');
const ms = (n: any) => (Number(n || 0) > 0 ? `${Math.round(Number(n))} ms` : '—');
const money = (n: number) => (n === 0 ? '$0' : `$${n.toFixed(3)}`);
function table(headers: string[], rows: unknown[][], empty = 'No data available.') {
  return rows.length
    ? `| ${headers.map(cell).join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n')}\n`
    : empty;
}
function section(title: string, body: string) {
  return `\n## ${title}\n\n${body}\n`;
}
function providerReadiness(routing: any) {
  return table(
    ['Provider', 'Status', 'Configured', 'Manual-only', 'Available', 'Degraded', 'Best'],
    Object.entries(routing?.providers || {}).map(([name, v]) => {
      const p = v as any;
      return [
        name,
        p.available_models > 0 ? 'ready' : p.degraded_models > 0 ? 'degraded' : 'blocked',
        fmt(p.configured_models),
        fmt(p.manual_only_models),
        fmt(p.available_models),
        fmt(p.degraded_models),
        p.best_model || '—',
      ];
    }),
    'No routing snapshot available.'
  );
}
function fallback(routing: any, limit: number) {
  return table(
    ['Rank', 'Model', 'Provider', 'Status', 'Success', 'Latency', 'Reasons'],
    (routing?.fallback_order || [])
      .slice(0, limit)
      .map((r: any) => [
        r.rank,
        `${r.id} (${r.model})`,
        r.provider,
        r.status,
        pct(r.success_rate),
        ms(r.avg_latency_ms),
        (r.reasons || []).join(', '),
      ]),
    'No fallback status available.'
  );
}
function quotas(data: any) {
  return table(
    ['Provider', 'Status', 'Remaining', 'Source'],
    Object.values(data?.quotas || {}).map((q: any) => [
      q.provider || 'provider',
      q.status,
      q.limitRemaining === null ? '—' : fmt(q.limitRemaining),
      q.source || 'unknown',
    ]),
    'No quota poller data available.'
  );
}
async function healthMarkdown(readJson: (path: string) => Promise<any>) {
  const [health, routing, stats, ledger] = await loadHealthView(readJson);
  const models = health.models || [];
  const statuses = models.map(modelStatus);
  const risky = statuses.filter((s: string[]) =>
    ['cooldown', 'exhausted', 'degraded'].includes(s[0])
  ).length;
  const available =
    routing?.summary?.available_models ??
    statuses.filter((s: string[]) => ['healthy', 'standby'].includes(s[0])).length;
  const ready = routing?.summary?.fallback_ready ?? available > 1;
  let body = `Gateway: ${ready ? 'Ready' : 'Limited'} (${models.length} health snapshots). Available models: ${fmt(available)}. Attention needed: ${fmt(risky + (routing?.summary?.exhausted_models || 0))}. Top provider: ${routing?.summary?.top_provider || '—'}. ${ready ? 'Fallback ready' : 'Fallback constrained'}.\n`;
  if (routing?.summary)
    body += `${fmt(routing.summary.degraded_models)} degraded; ${fmt(routing.summary.manual_only_models)} manual-only.\n`;
  body += section('Provider readiness', providerReadiness(routing));
  body += section('Fallback order', fallback(routing, 24));
  body += section('Provider quotas', quotas(stats));
  body += section(
    'Routing experiment ledger (7d)',
    'Anonymous aggregates. Prompt text is never stored.\n\n' +
      table(
        ['Prompt class', 'Requests', 'Success', 'Avg latency', 'Fallback rate'],
        (ledger?.by_prompt_class || [])
          .slice(0, 12)
          .map((r: any) => [
            r.key,
            fmt(r.requests),
            pct(r.success_rate),
            ms(r.avg_latency_ms),
            pct(r.fallback_rate),
          ]),
        'No routing ledger data yet.'
      )
  );
  body += section(
    'Live model health',
    table(
      ['Model key', 'Status', 'Attempts', 'Success', 'Avg', 'P90', 'Daily'],
      models.map((m: any) => [
        m.key,
        modelStatus(m)[0],
        fmt(m.attempts),
        pct(m.success_rate),
        ms(m.avg_latency_ms),
        ms(m.p90_latency_ms),
        `${fmt(m.daily_used)} / ${m.daily_limit === null ? '—' : fmt(m.daily_limit)}`,
      ]),
      'No health snapshots have been recorded yet.'
    )
  );
  return body;
}
async function modelsMarkdown(readJson: (path: string) => Promise<any>) {
  const models = await loadModelView(readJson);
  return (
    `Default unfiltered view: ${models.length} visible of ${models.length} models; ${models.filter((m: any) => statusOf(m)[0] === 'ready').length} ready; ${new Set(models.map((m: any) => m.provider)).size} providers; 0 capability filters.\n\n` +
    table(
      [
        'Model',
        'Provider',
        'Status',
        'Capabilities',
        'Context / max output',
        'Success',
        'Headroom',
        'Evaluation',
      ],
      models.map((m: any) => [
        `${m.id} (${m.model})`,
        m.provider,
        statusOf(m)[0],
        capabilityText(m).join(', '),
        `${fmt(m.context_window)} / ${fmt(m.max_output_tokens)}`,
        pct(m.success_rate),
        pct(m.headroom),
        `${Number(m.evaluation_weight || 0).toFixed(2)}; ${fmt(m.evaluation_sample_count)} samples; ${m.evaluated_at || 'not evaluated'}`,
      ]),
      'No models match the current filters.'
    )
  );
}
async function benchmarkMarkdown(readJson: (path: string) => Promise<any>) {
  const d = await loadBenchmarkView(readJson),
    candidates = d.candidates || [];
  const avg = (key: string) =>
    candidates.length
      ? candidates.reduce((sum: number, c: any) => sum + c[key], 0) / candidates.length
      : 0;
  let body = `Prototype operator surface. Benchmark rows are a local fixture. Compare routing experiments before changing production weights.\n\nFixture: ${d.fixture_id}; source: ${d.source}; generated: ${d.generated_at}.\n\nCandidates: ${candidates.length}; workloads: ${(d.workloads || []).length}; average success: ${pct(avg('success_rate'))}; direct API cost: ${money(avg('cost_usd_per_1m_tokens'))}.\n`;
  body += section(
    'Model benchmark matrix',
    table(
      [
        'Model',
        'Provider',
        'Cost /1M',
        'p50',
        'p90',
        'Success',
        'Quality',
        'Cooldown',
        'Status',
        'Score',
      ],
      candidates.map((c: any) => [
        c.id,
        c.provider,
        money(c.cost_usd_per_1m_tokens),
        ms(c.latency_ms_p50),
        ms(c.latency_ms_p90),
        pct(c.success_rate),
        c.quality_tier,
        c.cooldown_until > Date.now() ? new Date(c.cooldown_until).toISOString() : '—',
        c.status,
        Number(c.score || 0).toFixed(2),
      ])
    )
  );
  const workloads = new Map((d.workloads || []).map((w: any) => [w.id, w]));
  body += section(
    'Recommended route by workload',
    (d.routes_by_workload || [])
      .map((r: any) => {
        const w: any = workloads.get(r.workload_id) || { label: r.workload_id };
        return `### ${w.label}\n\n${w.prompt_class || ''}\n\n${w.description || ''}\n\nRecommended: ${r.recommended?.id || '—'} — ${r.recommended?.reason || ''}\n\n${(r.alternates || []).map((a: any) => `- ${a.id} — ${a.reason}`).join('\n')}`;
      })
      .join('\n\n')
  );
  body += section(
    'Experiment ledger',
    'Public fixture entries only. Browser-local snapshots are private and excluded.\n\n' +
      table(
        ['When', 'Label', 'Change', 'Success', 'Latency', 'Cost /1k', 'Fallback'],
        [...(d.experiments || [])]
          .sort((a: any, b: any) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))
          .map((e: any) => [
            e.recorded_at,
            e.label,
            e.change || '—',
            pct(e.metrics?.avg_success_rate || 0),
            ms(e.metrics?.avg_latency_ms || 0),
            money(e.metrics?.estimated_cost_usd_per_1k_req || 0),
            pct(e.metrics?.fallback_rate || 0),
          ]),
        'No experiments yet.'
      )
  );
  body += section(
    'Record experiment entry',
    'The HTML form accepts a label, change, baseline and notes. Reading this page does not create experiments.'
  );
  return body;
}

async function dashboardMarkdown(read: (path: string) => Promise<Response>) {
  const [healthRes, statsRes, routingRes, analyticsRes] = await loadDashboardResponses(read);
  if (!healthRes.ok || !analyticsRes.ok) throw new Error('Public dashboard sources unavailable');
  const health: any = await healthRes.json(),
    analytics: any = await analyticsRes.json();
  const stats: any = statsRes?.ok ? await statsRes.json().catch(() => null) : null;
  const routing: any = routingRes?.ok ? await routingRes.json().catch(() => null) : null;
  const models = health.items || health.models || [],
    active = models.filter((m: any) => (m.attempts || 0) > 0).length;
  const total = analytics.total_requests || 0;
  if (total === 0 && active === 0)
    return 'No traffic yet.\n\nSend a request to `/v1/chat/completions` with an `x-gateway-project-id` header to start seeing data. No request is sent by reading this document.\n';
  let attempts = 0,
    successes = 0;
  for (const m of models) {
    attempts += m.attempts || 0;
    successes += (m.attempts || 0) * (m.success_rate || 0);
  }
  const upstream = attempts ? successes / attempts : 1,
    gateway = analytics.success_rate || 0;
  let body = `Anonymous default view: last 7 days, grouped by provider. Saved browser preferences and replay credentials are not used.\n\nTotal requests: ${fmt(total)}. Gateway success: ${pct(gateway)} (${fmt(analytics.successful_requests)} ok). Gateway failed: ${fmt(analytics.failed_requests)} (${total ? pct((analytics.failed_requests || 0) / total) : '—'} of total). Fallback: ${gateway >= 0.99 && upstream < 0.95 ? 'Working' : 'Ready'}; upstream ${pct(upstream)}; ${active} active models.\n`;
  const providerRows = Object.entries(routing?.providers || {}).map(([name, value]) => {
    const p: any = value,
      rows = (routing.fallback_order || []).filter((r: any) => r.provider === name);
    const used = rows.reduce((sum: number, r: any) => sum + (r.daily_used || 0), 0),
      limit = rows.reduce(
        (sum: number, r: any) =>
          sum + (typeof r.daily_limit === 'number' && r.daily_limit > 0 ? r.daily_limit : 0),
        0
      );
    const quota = rows
      .map((r: any) => r.quota_status)
      .filter(Boolean)
      .at(-1);
    const status =
      p.available_models > 0
        ? 'available'
        : p.degraded_models > 0
          ? 'degraded'
          : p.cooldown_models > 0
            ? 'cooldown'
            : 'exhausted';
    return {
      status,
      row: [
        name,
        status,
        fmt(p.available_models),
        fmt(p.degraded_models),
        fmt(p.cooldown_models),
        fmt(p.exhausted_models),
        quota === 'exhausted' ? 'quota exhausted' : quota === 'unknown' ? 'quota unknown' : '—',
        limit > 0 ? `${fmt(used)} / ${fmt(limit)} daily` : '—',
        p.best_model || '—',
      ],
    };
  });
  if (providerRows.length) {
    const order: Record<string, number> = { available: 0, degraded: 1, cooldown: 2, exhausted: 2 };
    providerRows.sort((a, b) => order[a.status] - order[b.status]);
    body += section(
      'Provider readiness',
      table(
        [
          'Provider',
          'Status',
          'Available',
          'Degraded',
          'Cooldown',
          'Exhausted',
          'Quota',
          'Daily capacity',
          'Best model',
        ],
        providerRows.map((p) => p.row)
      )
    );
  }
  const quotaRows = Object.entries(stats?.quotas || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => {
      const q: any = value;
      return [
        name,
        q.status || 'unknown',
        q.limitRemaining !== null && q.limit !== null
          ? `${fmt(q.limitRemaining)} remaining / ${fmt(q.limit)}`
          : q.isFreeTier && q.freeDailyLimit
            ? `free tier · ~${fmt(q.freeDailyLimit)}/day`
            : q.source || 'unknown',
        q.reason || q.source || 'advisory',
        q.checkedAt ? new Date(q.checkedAt).toISOString() : '—',
      ];
    });
  if (quotaRows.length)
    body += section(
      'Provider quota status',
      table(['Provider', 'Status', 'Allowance', 'Reason', 'Checked'], quotaRows)
    );
  const byDate = new Map((analytics.daily || []).map((d: any) => [d.date, d]));
  const daily: any[] = [];
  const today = new Date();
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset)
    )
      .toISOString()
      .slice(0, 10);
    daily.push(
      byDate.get(date) || { date, requests: 0, successful: 0, failed: 0, failure_rate: null }
    );
  }
  const dailyRows = daily.map((d) => [
    d.date,
    fmt(d.requests),
    fmt(d.successful),
    fmt(d.failed),
    d.requests > 0 ? pct(d.failure_rate ?? d.failed / d.requests) : 'No traffic',
  ]);
  body += section(
    'Daily gateway outcomes',
    'UTC. Successful and failed requests with failure rate.\n\n' +
      table(['Date', 'Requests', 'Successful', 'Failed', 'Failure rate'], dailyRows)
  );
  const providers = Object.entries(analytics.providers || {}).map(([key, v]) => ({
    key,
    ...(v as any),
  }));
  body += section(
    'Provider breakdown',
    table(
      ['Provider', 'Requests', 'Success rate'],
      [...providers]
        .sort((a: any, b: any) => (b.requests || 0) - (a.requests || 0))
        .map((p: any) => [
          p.key,
          fmt(p.requests),
          pct(p.requests > 0 ? (p.successful || 0) / p.requests : 0),
        ])
    )
  );
  body += section(
    'Daily failure rate',
    'UTC. Zero-traffic days are labelled instead of shown as 0% failures.\n\n' +
      table(['Date', 'Requests', 'Successful', 'Failed', 'Failure rate'], [...dailyRows].reverse())
  );
  body += section(
    'Daily provider attribution',
    table(
      ['Date', 'Provider', 'Requests', 'Failed', 'Failure rate'],
      [...(analytics.daily_breakdown || [])]
        .sort(
          (a: any, b: any) => b.date.localeCompare(a.date) || (b.requests || 0) - (a.requests || 0)
        )
        .slice(0, 50)
        .map((r: any) => [
          r.date,
          r.key || '—',
          fmt(r.requests),
          fmt(r.failed),
          r.requests > 0 ? pct(r.failure_rate ?? (r.failed || 0) / r.requests) : '—',
        ]),
      'No grouped traffic in this range.'
    )
  );
  body += section(
    'Routing fallback order',
    table(
      ['Rank', 'Model', 'Provider', 'Status', 'Upstream success', 'Reasons'],
      (routing?.fallback_order || [])
        .slice(0, 15)
        .map((r: any) => [
          r.rank,
          r.id,
          r.provider,
          r.status,
          pct(r.success_rate || 0),
          (r.reasons || []).join(', '),
        ]),
      'Routing status unavailable.'
    )
  );
  const throttles = (stats?.stats || [])
    .filter((s: any) => (s.total_attempts || 0) > 0)
    .sort((a: any, b: any) => (b.throttle_rate || 0) - (a.throttle_rate || 0));
  if (throttles.length)
    body += section(
      'Provider throttle health',
      table(
        [
          'Provider',
          'Throttle rate',
          'Attempts',
          'Usage retriable',
          'Input nonretriable',
          'Safety refusal',
          'Provider fatal',
          'Success',
          'Before first 429',
          'Between throttles (p50)',
          'Cooling',
        ],
        throttles.map((s: any) => {
          const f = s.failure_breakdown || {};
          return [
            s.provider,
            pct(s.throttle_rate || 0),
            fmt(s.total_attempts),
            fmt(f.usage_retriable),
            fmt(f.input_nonretriable),
            fmt(f.safety_refusal),
            fmt(f.provider_fatal),
            fmt(
              Math.max(
                0,
                s.total_attempts -
                  (f.usage_retriable || 0) -
                  (f.input_nonretriable || 0) -
                  (f.safety_refusal || 0) -
                  (f.provider_fatal || 0)
              )
            ),
            s.avg_attempts_before_first_throttle === null
              ? '—'
              : `~${Number(s.avg_attempts_before_first_throttle).toFixed(1)}`,
            s.throttle_spacing_p50 === null ? '—' : `every ~${s.throttle_spacing_p50}`,
            s.models_in_cooldown || 0,
          ];
        })
      )
    );
  body += section(
    'Request replay lab',
    'A gateway key is required to replay. Default model: `auto`; project ID: `replay-lab`. The public initial example is shown below; saved credentials, submitted payloads and replay results are private and excluded. No replay run is performed.\n\n```json\n' +
      REPLAY_EXAMPLE +
      '\n```'
  );
  body += section(
    'Live model health',
    table(
      ['Key', 'Samples', 'Upstream success', 'Avg', 'P90', 'P99', 'Daily usage', 'Status'],
      [...models]
        .sort((a: any, b: any) => (b.attempts || 0) - (a.attempts || 0))
        .map((m: any) => [
          m.key,
          fmt(m.attempts),
          m.attempts > 0 ? pct(m.success_rate ?? 0) : '—',
          ms(m.avg_latency_ms),
          ms(m.p90_latency_ms),
          ms(m.p99_latency_ms),
          typeof m.daily_limit === 'number' && m.daily_limit > 0
            ? `${fmt(m.daily_used)} / ${fmt(m.daily_limit)}`
            : `${fmt(m.daily_used)} today`,
          m.cooldown_until > Date.now()
            ? `cooldown ${Math.ceil((m.cooldown_until - Date.now()) / 1000)}s`
            : m.attempts > 0
              ? 'live'
              : 'idle',
        ]),
      'No models registered.'
    )
  );
  body += section(
    'Top 10 providers',
    table(
      ['Provider', 'Requests', 'Success rate', 'Failed'],
      providers
        .sort((a: any, b: any) => (b.requests || 0) - (a.requests || 0))
        .slice(0, 10)
        .map((p: any) => [
          p.key,
          fmt(p.requests),
          pct(p.requests > 0 ? (p.successful || 0) / p.requests : 0),
          fmt(p.failed),
        ])
    )
  );
  body += section(
    'Projects',
    table(
      ['Project', 'Requests', 'Success'],
      Object.entries(analytics.projects || {})
        .map(([id, v]) => ({ id, ...(v as any) }))
        .sort((a: any, b: any) => (b.requests || 0) - (a.requests || 0))
        .map((p: any) => [
          p.id,
          fmt(p.requests),
          pct(p.requests > 0 ? (p.successful || 0) / p.requests : 0),
        ]),
      'No projects yet.'
    )
  );
  return body;
}

export async function renderRuntimeMarkdown(
  path: string,
  read: (path: string) => Promise<Response>
): Promise<string | undefined> {
  const page = pages.find((p) => p.path === path);
  if (!page) return undefined;
  const readJson = async (source: string) => {
    const response = await read(source);
    if (!response.ok) throw new Error('Public view source unavailable');
    return response.json();
  };
  let body: string;
  if (path === '/models') body = await modelsMarkdown(readJson);
  else if (path === '/health') body = await healthMarkdown(readJson);
  else if (path === '/benchmark') body = await benchmarkMarkdown(readJson);
  else body = await dashboardMarkdown(read);
  return `# ${page.title}\n\n> ${page.description}\n\nCanonical: ${origin}${path}\n\nObserved: ${new Date().toISOString()}\n\n${body}\n\n## Related\n- [Gateway health](${origin}/health)\n- [Model catalog](${origin}/models)\n- [Traffic dashboard](${origin}/dashboard)\n- [API docs](${origin}/docs/)\n`;
}
