export const OPERATOR_HEALTH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>AI Gateway - Health</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f7f7f4;
    --panel: #ffffff;
    --panel-alt: #f1f5f3;
    --border: #d8ddd8;
    --text: #171817;
    --muted: #67716b;
    --green: #15803d;
    --amber: #b45309;
    --rose: #be123c;
    --blue: #2563eb;
    --radius: 8px;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  a { color: var(--blue); text-decoration: none; }
  .app { max-width: 1320px; margin: 0 auto; padding: 24px; }
  .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 18px; }
  h1 { font-size: 22px; line-height: 1.1; margin: 0; letter-spacing: 0; }
  .sub { color: var(--muted); font-size: 12px; font-family: var(--mono); }
  .spacer { flex: 1; }
  .button { border: 1px solid var(--border); background: var(--panel); color: var(--text); border-radius: var(--radius); padding: 8px 11px; cursor: pointer; font: inherit; }
  .button:hover { border-color: var(--blue); }
  .grid { display: grid; gap: 12px; }
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 12px; }
  .kpi, .card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
  .kpi { padding: 14px; }
  .label { color: var(--muted); text-transform: uppercase; letter-spacing: .04em; font-size: 11px; }
  .value { font-size: 28px; font-weight: 650; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .card { padding: 14px; margin-top: 12px; }
  .card h2 { font-size: 13px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .status { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-family: var(--mono); background: var(--panel-alt); }
  .status:before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: var(--muted); }
  .ok { color: var(--green); } .ok:before { background: var(--green); }
  .warn { color: var(--amber); } .warn:before { background: var(--amber); }
  .err { color: var(--rose); } .err:before { background: var(--rose); }
  .muted { color: var(--muted); }
  .providers { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
  .provider { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--panel-alt); }
  .provider strong { display: block; margin-bottom: 8px; }
  .provider dl { display: grid; grid-template-columns: 1fr auto; gap: 5px 10px; margin: 0; color: var(--muted); font-size: 12px; }
  .provider dd { margin: 0; color: var(--text); font-family: var(--mono); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
  td { font-variant-numeric: tabular-nums; }
  .mono { font-family: var(--mono); font-size: 12px; }
  .reason { display: inline-block; margin: 0 4px 4px 0; padding: 2px 6px; border-radius: 999px; background: var(--panel-alt); color: var(--muted); font-size: 11px; font-family: var(--mono); }
  .split { display: grid; grid-template-columns: 1.35fr .65fr; gap: 12px; }
  .banner { display: none; margin-bottom: 12px; padding: 10px 12px; border: 1px solid #fecdd3; background: #fff1f2; color: #9f1239; border-radius: var(--radius); }
  .banner.show { display: block; }
  @media (max-width: 900px) {
    .app { padding: 16px; }
    .kpis, .split { grid-template-columns: 1fr; }
    table { display: block; overflow-x: auto; white-space: nowrap; }
  }
</style>
</head>
<body>
<main class="app">
  <div class="bar">
    <div>
      <h1>Gateway Health</h1>
      <div class="sub" id="updated">Loading...</div>
    </div>
    <div class="spacer"></div>
    <a class="button" href="/models">Model catalog</a>
    <a class="button" href="/dashboard">Traffic dashboard</a>
    <a class="button" href="/benchmark">Benchmark optimizer</a>
    <button class="button" id="refresh">Refresh</button>
  </div>
  <div class="banner" id="error"></div>
  <section class="grid kpis">
    <div class="kpi"><div class="label">Gateway</div><div class="value" id="kGateway">...</div><div class="sub" id="kGatewaySub">...</div></div>
    <div class="kpi"><div class="label">Available models</div><div class="value" id="kAvailable">0</div><div class="sub" id="kAvailableSub">...</div></div>
    <div class="kpi"><div class="label">Attention needed</div><div class="value" id="kRisk">0</div><div class="sub" id="kRiskSub">...</div></div>
    <div class="kpi"><div class="label">Top provider</div><div class="value" id="kProvider">...</div><div class="sub" id="kProviderSub">...</div></div>
  </section>
  <section class="card">
    <h2>Provider readiness</h2>
    <div class="grid providers" id="providers"></div>
  </section>
  <section class="split">
    <div class="card">
      <h2>Fallback order</h2>
      <table>
        <thead><tr><th>Rank</th><th>Model</th><th>Provider</th><th>Status</th><th>Success</th><th>Latency</th><th>Reasons</th></tr></thead>
        <tbody id="fallback"></tbody>
      </table>
    </div>
    <div class="card">
      <h2>Provider quotas</h2>
      <div id="quotas"></div>
    </div>
  </section>
  <section class="card">
    <h2>Routing experiment ledger (7d)</h2>
    <p class="muted">Anonymous aggregates from <code>/v1/routing/ledger</code>. Prompt text is never stored.</p>
    <table>
      <thead><tr><th>Prompt class</th><th>Requests</th><th>Success</th><th>Avg latency</th><th>Fallback rate</th></tr></thead>
      <tbody id="ledger"></tbody>
    </table>
  </section>
  <section class="card">
    <h2>Live model health</h2>
    <table>
      <thead><tr><th>Model key</th><th>Status</th><th>Attempts</th><th>Success</th><th>Avg</th><th>P90</th><th>Daily</th></tr></thead>
      <tbody id="models"></tbody>
    </table>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString();
const pct = (n) => Number.isFinite(Number(n)) ? (Number(n) * 100).toFixed(1) + '%' : '-';
const ms = (n) => Number(n || 0) > 0 ? Math.round(Number(n)) + ' ms' : '-';
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function modelStatus(model) {
  const now = Date.now();
  if (Number(model.cooldown_until || 0) > now) return ['cooldown', 'err'];
  if (Number(model.headroom || 0) <= 0) return ['exhausted', 'err'];
  if (Number(model.attempts || 0) === 0) return ['standby', ''];
  if (Number(model.success_rate || 0) < 0.75 || Number(model.avg_latency_ms || 0) > 5000) return ['degraded', 'warn'];
  return ['healthy', 'ok'];
}

async function readJson(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(path + ' returned ' + res.status);
  return res.json();
}

async function load() {
  $('error').className = 'banner';
  try {
    const [health, routing, providerStats, ledger] = await Promise.all([
      readJson('/health'),
      readJson('/v1/routing/status').catch(() => null),
      readJson('/v1/stats/providers').catch(() => null),
      readJson('/v1/routing/ledger?days=7').catch(() => null),
    ]);
    render(health, routing, providerStats, ledger);
    $('updated').textContent = 'Updated ' + new Date().toLocaleString();
  } catch (err) {
    $('error').textContent = err.message || String(err);
    $('error').className = 'banner show';
    $('updated').textContent = 'Refresh failed';
  }
}

function render(health, routing, providerStats, ledger) {
  const models = health.models || [];
  const statuses = models.map(modelStatus);
  const risky = statuses.filter((s) => s[0] === 'cooldown' || s[0] === 'exhausted' || s[0] === 'degraded').length;
  const available = routing && routing.summary ? routing.summary.available_models : statuses.filter((s) => s[0] === 'healthy' || s[0] === 'standby').length;
  const fallbackReady = routing && routing.summary ? routing.summary.fallback_ready : available > 1;
  $('kGateway').textContent = fallbackReady ? 'Ready' : 'Limited';
  $('kGatewaySub').textContent = models.length + ' health snapshots';
  $('kAvailable').textContent = fmt(available);
  $('kAvailableSub').textContent = routing && routing.summary ? fmt(routing.summary.degraded_models || 0) + ' degraded' : 'from health snapshots';
  $('kRisk').textContent = fmt(risky + ((routing && routing.summary && routing.summary.exhausted_models) || 0));
  $('kRiskSub').textContent = 'cooldown, exhausted, or degraded';
  $('kProvider').textContent = (routing && routing.summary && routing.summary.top_provider) || '-';
  $('kProviderSub').textContent = fallbackReady ? 'fallback ready' : 'fallback constrained';
  renderProviders(routing);
  renderFallback(routing);
  renderQuotas(providerStats);
  renderLedger(ledger);
  renderModels(models);
}

function renderLedger(ledger) {
  const rows = ledger && ledger.by_prompt_class ? ledger.by_prompt_class.slice(0, 12) : [];
  $('ledger').innerHTML = rows.length ? rows.map((row) => {
    return '<tr><td class="mono">' + esc(row.key) + '</td><td>' + fmt(row.requests) + '</td><td>' + pct(row.success_rate) + '</td><td>' + ms(row.avg_latency_ms) + '</td><td>' + pct(row.fallback_rate) + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="muted">No routing ledger data yet.</td></tr>';
}

function renderProviders(routing) {
  const providers = routing && routing.providers ? Object.entries(routing.providers) : [];
  $('providers').innerHTML = providers.length ? providers.map(([name, item]) => {
    const status = item.available_models > 0 ? 'ok' : item.degraded_models > 0 ? 'warn' : 'err';
    return '<article class="provider"><strong>' + esc(name) + ' <span class="status ' + status + '">' + (status === 'ok' ? 'ready' : status === 'warn' ? 'degraded' : 'blocked') + '</span></strong>' +
      '<dl><dt>configured</dt><dd>' + fmt(item.configured_models) + '</dd><dt>available</dt><dd>' + fmt(item.available_models) + '</dd><dt>degraded</dt><dd>' + fmt(item.degraded_models) + '</dd><dt>best</dt><dd>' + esc(item.best_model || '-') + '</dd></dl></article>';
  }).join('') : '<div class="muted">No routing snapshot available.</div>';
}

function renderFallback(routing) {
  const rows = routing && routing.fallback_order ? routing.fallback_order.slice(0, 24) : [];
  $('fallback').innerHTML = rows.length ? rows.map((item) => {
    const cls = item.status === 'available' ? 'ok' : item.status === 'degraded' ? 'warn' : 'err';
    return '<tr><td class="mono">' + item.rank + '</td><td><strong>' + esc(item.id) + '</strong><div class="sub">' + esc(item.model) + '</div></td><td>' + esc(item.provider) + '</td><td><span class="status ' + cls + '">' + esc(item.status) + '</span></td><td>' + pct(item.success_rate) + '</td><td>' + ms(item.avg_latency_ms) + '</td><td>' + (item.reasons || []).map((reason) => '<span class="reason">' + esc(reason) + '</span>').join('') + '</td></tr>';
  }).join('') : '<tr><td colspan="7" class="muted">No fallback status available.</td></tr>';
}

function renderQuotas(providerStats) {
  const quotas = providerStats && providerStats.quotas ? Object.values(providerStats.quotas) : [];
  $('quotas').innerHTML = quotas.length ? quotas.map((quota) => {
    const cls = quota.status === 'ok' ? 'ok' : quota.status === 'unknown' ? '' : 'err';
    const remaining = quota.limitRemaining == null ? '-' : fmt(quota.limitRemaining);
    return '<p><span class="status ' + cls + '">' + esc(quota.provider || 'provider') + ': ' + esc(quota.status) + '</span><br><span class="sub">remaining ' + remaining + ' from ' + esc(quota.source || 'unknown') + '</span></p>';
  }).join('') : '<p class="muted">No quota poller data available.</p>';
}

function renderModels(models) {
  $('models').innerHTML = models.length ? models.map((model) => {
    const s = modelStatus(model);
    const limit = model.daily_limit == null ? '-' : fmt(model.daily_limit);
    return '<tr><td class="mono">' + esc(model.key) + '</td><td><span class="status ' + s[1] + '">' + s[0] + '</span></td><td>' + fmt(model.attempts) + '</td><td>' + pct(model.success_rate) + '</td><td>' + ms(model.avg_latency_ms) + '</td><td>' + ms(model.p90_latency_ms) + '</td><td>' + fmt(model.daily_used) + ' / ' + limit + '</td></tr>';
  }).join('') : '<tr><td colspan="7" class="muted">No health snapshots have been recorded yet.</td></tr>';
}

$('refresh').addEventListener('click', load);
load();
setInterval(load, 10000);
</script>
</body>
</html>`;

export const MODEL_CATALOG_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>AI Gateway - Model Catalog</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f7f7f4;
    --panel: #ffffff;
    --panel-alt: #f1f5f3;
    --border: #d8ddd8;
    --text: #171817;
    --muted: #67716b;
    --green: #15803d;
    --amber: #b45309;
    --rose: #be123c;
    --blue: #2563eb;
    --radius: 8px;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  a { color: var(--blue); text-decoration: none; }
  .app { max-width: 1320px; margin: 0 auto; padding: 24px; }
  .bar, .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .bar { margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: 0; }
  .spacer { flex: 1; }
  .button, input, select { border: 1px solid var(--border); background: var(--panel); color: var(--text); border-radius: var(--radius); padding: 8px 10px; font: inherit; }
  input { min-width: min(360px, 100%); flex: 1; }
  .button { cursor: pointer; }
  .button:hover, input:focus, select:focus { border-color: var(--blue); outline: none; }
  .filters { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 12px; }
  label { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); font-size: 13px; }
  label input { min-width: 0; flex: none; accent-color: var(--blue); }
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
  .kpi, .card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
  .kpi { padding: 14px; }
  .label { color: var(--muted); text-transform: uppercase; letter-spacing: .04em; font-size: 11px; }
  .value { font-size: 28px; font-weight: 650; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .sub { color: var(--muted); font-size: 12px; font-family: var(--mono); }
  .card { overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 9px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; background: var(--panel-alt); }
  tr:last-child td { border-bottom: 0; }
  .mono { font-family: var(--mono); font-size: 12px; }
  .status, .cap { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 7px; font-size: 12px; font-family: var(--mono); background: var(--panel-alt); margin: 0 4px 4px 0; }
  .status:before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: var(--muted); margin-right: 6px; }
  .ok { color: var(--green); } .ok:before { background: var(--green); }
  .warn { color: var(--amber); } .warn:before { background: var(--amber); }
  .err { color: var(--rose); } .err:before { background: var(--rose); }
  .banner { display: none; margin-bottom: 12px; padding: 10px 12px; border: 1px solid #fecdd3; background: #fff1f2; color: #9f1239; border-radius: var(--radius); }
  .banner.show { display: block; }
  @media (max-width: 900px) {
    .app { padding: 16px; }
    .kpis { grid-template-columns: 1fr 1fr; }
    table { display: block; overflow-x: auto; white-space: nowrap; }
  }
</style>
</head>
<body>
<main class="app">
  <div class="bar">
    <div>
      <h1>Model Catalog</h1>
      <div class="sub" id="updated">Loading...</div>
    </div>
    <div class="spacer"></div>
    <a class="button" href="/health">Gateway health</a>
    <a class="button" href="/dashboard">Traffic dashboard</a>
  </div>
  <div class="banner" id="error"></div>
  <section class="filters">
    <input id="search" type="search" placeholder="Search model, provider, capability" autocomplete="off" />
    <select id="provider"><option value="">All providers</option></select>
    <select id="reasoning"><option value="">All reasoning</option><option value="high">High reasoning</option><option value="medium">Medium reasoning</option><option value="low">Low reasoning</option></select>
    <select id="status"><option value="">All statuses</option><option value="ready">Ready</option><option value="degraded">Degraded</option><option value="cooldown">Cooldown</option><option value="exhausted">Exhausted</option></select>
    <label><input id="streaming" type="checkbox" /> Streaming</label>
    <label><input id="tools" type="checkbox" /> Tools</label>
    <label><input id="jsonMode" type="checkbox" /> JSON</label>
    <label><input id="vision" type="checkbox" /> Vision</label>
  </section>
  <section class="kpis">
    <div class="kpi"><div class="label">Visible</div><div class="value" id="kVisible">0</div><div class="sub" id="kVisibleSub">models</div></div>
    <div class="kpi"><div class="label">Ready</div><div class="value" id="kReady">0</div><div class="sub">healthy or standby</div></div>
    <div class="kpi"><div class="label">Providers</div><div class="value" id="kProviders">0</div><div class="sub">in current filter</div></div>
    <div class="kpi"><div class="label">Capability match</div><div class="value" id="kCaps">0</div><div class="sub">selected filters</div></div>
  </section>
  <section class="card">
    <table>
      <thead><tr><th>Model</th><th>Provider</th><th>Status</th><th>Capabilities</th><th>Context</th><th>Success</th><th>Headroom</th><th>Evaluation</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString();
const pct = (n) => Number.isFinite(Number(n)) ? (Number(n) * 100).toFixed(1) + '%' : '-';
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const state = { models: [] };

function statusOf(model) {
  const now = Date.now();
  if (Number(model.cooldown_until || 0) > now) return ['cooldown', 'err'];
  if (Number(model.headroom || 0) <= 0) return ['exhausted', 'err'];
  if (!model.enabled || Number(model.success_rate || 0) < 0.75) return ['degraded', 'warn'];
  return ['ready', 'ok'];
}

function capabilityText(model) {
  const caps = [];
  if (model.supports_streaming) caps.push('streaming');
  if (model.tool_calling) caps.push('tools');
  if (model.json_mode) caps.push('json');
  if (model.vision) caps.push('vision');
  if (model.native_reasoning) caps.push('native reasoning');
  caps.push(model.reasoning + ' reasoning');
  return caps;
}

function readFilters() {
  return {
    q: $('search').value.trim().toLowerCase(),
    provider: $('provider').value,
    reasoning: $('reasoning').value,
    status: $('status').value,
    streaming: $('streaming').checked,
    tools: $('tools').checked,
    jsonMode: $('jsonMode').checked,
    vision: $('vision').checked,
  };
}

function matches(model, filters) {
  const status = statusOf(model)[0];
  const haystack = [model.id, model.provider, model.model, model.reasoning, capabilityText(model).join(' ')].join(' ').toLowerCase();
  if (filters.q && !haystack.includes(filters.q)) return false;
  if (filters.provider && model.provider !== filters.provider) return false;
  if (filters.reasoning && model.reasoning !== filters.reasoning) return false;
  if (filters.status && status !== filters.status) return false;
  if (filters.streaming && !model.supports_streaming) return false;
  if (filters.tools && !model.tool_calling) return false;
  if (filters.jsonMode && !model.json_mode) return false;
  if (filters.vision && !model.vision) return false;
  return true;
}

function render() {
  const filters = readFilters();
  const rows = state.models.filter((model) => matches(model, filters));
  const ready = rows.filter((model) => statusOf(model)[0] === 'ready').length;
  const providers = new Set(rows.map((model) => model.provider));
  const capabilityFilters = [filters.streaming, filters.tools, filters.jsonMode, filters.vision].filter(Boolean).length;
  $('kVisible').textContent = fmt(rows.length);
  $('kVisibleSub').textContent = 'of ' + fmt(state.models.length) + ' models';
  $('kReady').textContent = fmt(ready);
  $('kProviders').textContent = fmt(providers.size);
  $('kCaps').textContent = fmt(capabilityFilters);
  $('rows').innerHTML = rows.length ? rows.map((model) => {
    const status = statusOf(model);
    const caps = capabilityText(model).map((cap) => '<span class="cap">' + esc(cap) + '</span>').join('');
    const evaluated = model.evaluated_at ? esc(model.evaluated_at) : 'not evaluated';
    return '<tr><td><strong>' + esc(model.id) + '</strong><div class="sub">' + esc(model.model) + '</div></td><td>' + esc(model.provider) + '</td><td><span class="status ' + status[1] + '">' + status[0] + '</span></td><td>' + caps + '</td><td class="mono">' + fmt(model.context_window) + '<br><span class="sub">out ' + fmt(model.max_output_tokens) + '</span></td><td>' + pct(model.success_rate) + '</td><td>' + pct(model.headroom) + '</td><td class="mono">' + Number(model.evaluation_weight || 0).toFixed(2) + '<br><span class="sub">' + fmt(model.evaluation_sample_count) + ' samples</span><br><span class="sub">' + evaluated + '</span></td></tr>';
  }).join('') : '<tr><td colspan="8" class="muted">No models match the current filters.</td></tr>';
}

async function load() {
  try {
    const res = await fetch('/v1/models', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('/v1/models returned ' + res.status);
    const body = await res.json();
    state.models = (body.data || []).slice().sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
    const providers = Array.from(new Set(state.models.map((model) => model.provider))).sort();
    $('provider').innerHTML = '<option value="">All providers</option>' + providers.map((provider) => '<option value="' + esc(provider) + '">' + esc(provider) + '</option>').join('');
    $('updated').textContent = 'Updated ' + new Date().toLocaleString();
    render();
  } catch (err) {
    $('error').textContent = err.message || String(err);
    $('error').className = 'banner show';
    $('updated').textContent = 'Load failed';
  }
}

['search','provider','reasoning','status','streaming','tools','jsonMode','vision'].forEach((id) => {
  $(id).addEventListener('input', render);
  $(id).addEventListener('change', render);
});
load();
</script>
</body>
</html>`;
