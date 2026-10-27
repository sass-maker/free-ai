import { identity } from '../site/src/data/site-identity.mjs';
import { loadPublicStatus } from '../site/src/lib/public-status';
import { normalizeProviderStats, summarizeProviderStats } from '../site/src/lib/provider-stats';

const cell = (value: unknown) =>
  String(value ?? '—')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ');
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);
export async function renderStatusMarkdown(fetchJson: (path: string) => Promise<any>) {
  const { models, providers } = await loadPublicStatus(fetchJson);
  if (!Array.isArray(models?.data)) throw new Error('Public models unavailable');
  const stats = normalizeProviderStats(providers?.stats);
  const summary = summarizeProviderStats(providers?.stats);
  const now = Date.now();
  const rows = [...models.data].sort(
    (a, b) =>
      String(a.provider).localeCompare(String(b.provider)) ||
      String(a.model).localeCompare(String(b.model))
  );
  const lines = [
    '# Gateway Status',
    '',
    '> Live model registry and provider health from the same public APIs as the status page.',
    '',
    `Canonical: ${identity.url}/status/`,
    '',
    `Observed: ${new Date(now).toISOString()}`,
    '',
    `Models: ${rows.length}; live: ${rows.filter((m) => m.enabled && (!m.cooldown_until || m.cooldown_until <= now)).length}; chat: ${rows.filter((m) => m.type === 'chat').length}; embedding: ${rows.filter((m) => m.type === 'embedding').length}; overall success: ${pct(summary.successRate)}.`,
    '',
    '## Provider Stats',
    '',
    'Recent routing attempts, model availability, and quota status by provider. — means unavailable or no attempt history.',
    '',
    '| Provider | Models (active / total) | Attempts | Success Rate | Avg Latency | Quota |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  if (stats)
    for (const s of [...stats].sort((a, b) => (b.total_attempts ?? 0) - (a.total_attempts ?? 0))) {
      const q = providers.quotas?.[s.provider];
      const quota =
        q?.remaining !== undefined && q?.limit !== undefined
          ? `${q.remaining}/${q.limit}`
          : q?.status;
      lines.push(
        `| ${[s.provider, `${cell(s.active_models)} / ${cell(s.total_models)}`, s.total_attempts, pct(s.success_rate), s.avg_latency_ms === null ? '—' : `${Math.round(s.avg_latency_ms)} ms`, quota].map(cell).join(' | ')} |`
      );
    }
  if (stats === null) lines.push('', 'Provider stats unavailable — response missing or invalid.');
  else if (stats.length < providers.stats.length)
    lines.push('', 'Some provider rows are invalid — totals are unavailable.');
  else if (!stats.length)
    lines.push('', 'No provider stats yet — requests will appear here after the first API call.');
  lines.push(
    '',
    '## Model Registry',
    '',
    'All chat and embedding models with live health scores, capabilities, and cooldown status.',
    '',
    '| Model ID | Provider | Type | Capabilities | Health | Status |',
    '| --- | --- | --- | --- | --- | --- |'
  );
  for (const m of rows) {
    const caps = [
      ['tool_calling', 'tools'],
      ['vision', 'vision'],
      ['json_mode', 'json'],
      ['native_reasoning', 'reasoning'],
      ['supports_streaming', 'stream'],
    ]
      .filter(([key]) => m[key])
      .map(([, name]) => name)
      .join(', ');
    const status = !m.enabled
      ? 'disabled'
      : m.cooldown_until > now
        ? `cooldown ${Math.ceil((m.cooldown_until - now) / 1000)}s`
        : m.headroom !== undefined && m.headroom <= 0
          ? 'rate-limited'
          : 'live';
    lines.push(
      `| ${[m.id, m.provider, m.type, caps, pct(m.success_rate ?? 0), status].map(cell).join(' | ')} |`
    );
  }
  lines.push(
    '',
    `Sources: [models](${identity.url}/v1/models), [provider stats](${identity.url}/v1/stats/providers). Readings change; HTML refreshes every 30 seconds.`,
    ''
  );
  return lines.join('\n');
}
