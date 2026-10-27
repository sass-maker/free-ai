/** Public read-only sources shared by the inline browser views and Markdown. */
export async function loadHealthView(readJson: (path: string) => Promise<any>) {
  return Promise.all([
    readJson('/health'),
    readJson('/v1/routing/status').catch(() => null),
    readJson('/v1/stats/providers').catch(() => null),
    readJson('/v1/routing/ledger?days=7').catch(() => null),
  ]);
}
export async function loadDashboardResponses(
  read: (path: string) => Promise<Response>,
  days = 7,
  group = 'provider'
) {
  return Promise.all([
    read('/health'),
    read('/v1/stats/providers').catch(() => null),
    read('/v1/routing/status').catch(() => null),
    read(`/v1/analytics?days=${days}&group_by=${group}`),
  ]);
}
export async function loadModelView(readJson: (path: string) => Promise<any>) {
  const body = await readJson('/v1/models');
  return (body.data || [])
    .slice()
    .sort((a: any, b: any) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}
export async function loadBenchmarkView(readJson: (path: string) => Promise<any>) {
  return readJson('/v1/benchmark/optimizer');
}
export function modelStatus(model: any) {
  const now = Date.now();
  if (Number(model.cooldown_until || 0) > now) return ['cooldown', 'err'];
  if (Number(model.headroom || 0) <= 0) return ['exhausted', 'err'];
  if (Number(model.attempts || 0) === 0) return ['standby', ''];
  if (Number(model.success_rate || 0) < 0.75 || Number(model.avg_latency_ms || 0) > 5000)
    return ['degraded', 'warn'];
  return ['healthy', 'ok'];
}

export function statusOf(model: any) {
  const now = Date.now();
  if (model.automatic_routing === false) return ['manual only', 'warn'];
  if (Number(model.cooldown_until || 0) > now) return ['cooldown', 'err'];
  if (Number(model.headroom || 0) <= 0) return ['exhausted', 'err'];
  if (!model.enabled || Number(model.success_rate || 0) < 0.75) return ['degraded', 'warn'];
  return ['ready', 'ok'];
}

export function capabilityText(model: any) {
  const caps = [];
  if (model.supports_streaming) caps.push('streaming');
  if (model.tool_calling) caps.push('tools');
  if (model.json_mode) caps.push('json');
  if (model.vision) caps.push('vision');
  if (model.native_reasoning) caps.push('native reasoning');
  caps.push(`${model.reasoning} reasoning`);
  return caps;
}

export const REPLAY_EXAMPLE =
  '{\n  "messages": [\n    { "role": "user", "content": "Reply with one short diagnostic sentence." }\n  ],\n  "temperature": 0.2,\n  "max_tokens": 64\n}';
