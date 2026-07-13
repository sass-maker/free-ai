export const BENCHMARK_COST_OPTIMIZER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>AI Gateway - Benchmark &amp; Cost Optimizer</title>
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
  h1 { font-size: 22px; line-height: 1.1; margin: 0; }
  .sub { color: var(--muted); font-size: 12px; font-family: var(--mono); }
  .spacer { flex: 1; }
  .button { border: 1px solid var(--border); background: var(--panel); color: var(--text); border-radius: var(--radius); padding: 8px 11px; cursor: pointer; font: inherit; display: inline-block; }
  .button:hover { border-color: var(--blue); }
  .grid { display: grid; gap: 12px; }
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 12px; }
  .kpi, .card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
  .kpi { padding: 14px; }
  .label { color: var(--muted); text-transform: uppercase; letter-spacing: .04em; font-size: 11px; }
  .value { font-size: 28px; font-weight: 650; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .card { padding: 14px; margin-top: 12px; }
  .card h2 { font-size: 13px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .muted { color: var(--muted); }
  .pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-family: var(--mono); background: var(--panel-alt); }
  .ok { color: var(--green); }
  .warn { color: var(--amber); }
  .err { color: var(--rose); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
  td { font-variant-numeric: tabular-nums; }
  .mono { font-family: var(--mono); font-size: 12px; }
  .route-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .route-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--panel-alt); }
  .route-card strong { display: block; margin-bottom: 6px; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .banner { display: none; margin-bottom: 12px; padding: 10px 12px; border: 1px solid #fecdd3; background: #fff1f2; color: #9f1239; border-radius: var(--radius); }
  .banner.show { display: block; }
  .form { display: grid; gap: 8px; max-width: 520px; }
  .form input, .form textarea, .form select { width: 100%; border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; font: inherit; background: var(--panel); }
  .delta-up { color: var(--green); }
  .delta-down { color: var(--rose); }
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
      <h1>Benchmark &amp; Cost Optimizer</h1>
      <div class="sub" id="updated">Loading fixture...</div>
    </div>
    <div class="spacer"></div>
    <a class="button" href="/health">Gateway health</a>
    <a class="button" href="/dashboard">Traffic dashboard</a>
    <button class="button" id="refresh">Refresh</button>
  </div>
  <div class="banner" id="error"></div>
  <p class="muted">Prototype operator surface. Benchmark rows come from <code>/v1/benchmark/optimizer</code> (local fixture). Compare routing experiments before changing production weights.</p>

  <section class="grid kpis">
    <div class="kpi"><div class="label">Candidates</div><div class="value" id="kCandidates">0</div><div class="sub">providers/models in fixture</div></div>
    <div class="kpi"><div class="label">Workloads</div><div class="value" id="kWorkloads">0</div><div class="sub">prompt-class routes</div></div>
    <div class="kpi"><div class="label">Avg success</div><div class="value" id="kSuccess">0%</div><div class="sub">across fixture candidates</div></div>
    <div class="kpi"><div class="label">Direct API cost</div><div class="value" id="kCost">$0</div><div class="sub">free-tier weighted</div></div>
  </section>

  <section class="card">
    <h2>Model benchmark matrix</h2>
    <table>
      <thead>
        <tr>
          <th>Model</th><th>Provider</th><th>Cost /1M</th><th>p50</th><th>p90</th>
          <th>Success</th><th>Quality</th><th>Cooldown</th><th>Status</th><th>Score</th>
        </tr>
      </thead>
      <tbody id="matrix"></tbody>
    </table>
  </section>

  <section class="card">
    <h2>Recommended route by workload</h2>
    <div class="grid route-grid" id="routes"></div>
  </section>

  <section class="split">
    <div class="card">
      <h2>Experiment ledger</h2>
      <p class="muted">Fixture entries plus browser-local snapshots for before/after comparisons.</p>
      <table>
        <thead><tr><th>When</th><th>Label</th><th>Change</th><th>Success</th><th>Latency</th><th>Cost /1k</th><th>Fallback</th></tr></thead>
        <tbody id="experiments"></tbody>
      </table>
    </div>
    <div class="card">
      <h2>Record experiment entry</h2>
      <form class="form" id="expForm">
        <label>Label <input name="label" required placeholder="e.g. Raise latency weight" /></label>
        <label>Change <input name="change" placeholder="What routing knob changed?" /></label>
        <label>Baseline <select name="baseline_id" id="baselineSelect"><option value="">None</option></select></label>
        <label>Notes <textarea name="notes" rows="3" placeholder="Operator notes (no prompt text)"></textarea></label>
        <button class="button" type="submit">Add ledger entry</button>
      </form>
      <p class="muted mono" id="expMsg"></p>
    </div>
  </section>
</main>
<script>
(function () {
  const LEDGER_KEY = 'free-ai-benchmark-experiments';
  const $ = (id) => document.getElementById(id);

  function pct(n) { return (n * 100).toFixed(1) + '%'; }
  function money(n) { return n === 0 ? '$0' : '$' + n.toFixed(3); }
  function fmtMs(n) { return Math.round(n) + 'ms'; }
  function statusClass(s) {
    if (s === 'available') return 'ok';
    if (s === 'cooldown' || s === 'exhausted') return 'err';
    return 'warn';
  }
  function cooldownLabel(until) {
    if (!until || until <= Date.now()) return '—';
    return new Date(until).toLocaleString();
  }

  function loadLocalExperiments() {
    try {
      const raw = localStorage.getItem(LEDGER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveLocalExperiment(entry) {
    const list = loadLocalExperiments();
    list.unshift(entry);
    localStorage.setItem(LEDGER_KEY, JSON.stringify(list.slice(0, 20)));
  }

  function renderExperiments(fixtureExperiments) {
    const merged = [...loadLocalExperiments(), ...(fixtureExperiments || [])]
      .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
    const baseline = $('baselineSelect');
    baseline.innerHTML = '<option value="">None</option>';
    for (const exp of merged) {
      const opt = document.createElement('option');
      opt.value = exp.id;
      opt.textContent = exp.label + ' (' + exp.id + ')';
      baseline.appendChild(opt);
    }
    $('experiments').innerHTML = merged.map((exp) => {
      const m = exp.metrics || {};
      return '<tr>'
        + '<td class="mono">' + new Date(exp.recorded_at).toLocaleString() + '</td>'
        + '<td>' + exp.label + '</td>'
        + '<td class="mono">' + (exp.change || '—') + '</td>'
        + '<td>' + pct(m.avg_success_rate || 0) + '</td>'
        + '<td>' + fmtMs(m.avg_latency_ms || 0) + '</td>'
        + '<td>' + money(m.estimated_cost_usd_per_1k_req || 0) + '</td>'
        + '<td>' + pct(m.fallback_rate || 0) + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="7" class="muted">No experiments yet</td></tr>';
  }

  function renderMatrix(candidates) {
    $('matrix').innerHTML = (candidates || []).map((c) => {
      return '<tr>'
        + '<td class="mono">' + c.id + '</td>'
        + '<td>' + c.provider + '</td>'
        + '<td>' + money(c.cost_usd_per_1m_tokens) + '</td>'
        + '<td>' + fmtMs(c.latency_ms_p50) + '</td>'
        + '<td>' + fmtMs(c.latency_ms_p90) + '</td>'
        + '<td>' + pct(c.success_rate) + '</td>'
        + '<td>' + c.quality_tier + '</td>'
        + '<td class="mono">' + cooldownLabel(c.cooldown_until) + '</td>'
        + '<td><span class="pill ' + statusClass(c.status) + '">' + c.status + '</span></td>'
        + '<td>' + (c.score || 0).toFixed(2) + '</td>'
        + '</tr>';
    }).join('');
  }

  function renderRoutes(payload) {
    const byId = Object.fromEntries((payload.workloads || []).map((w) => [w.id, w]));
    $('routes').innerHTML = (payload.routes_by_workload || []).map((route) => {
      const w = byId[route.workload_id] || { label: route.workload_id, prompt_class: '', description: '' };
      const rec = route.recommended || {};
      const alts = (route.alternates || []).map((a) => '<li class="mono">' + a.id + ' — ' + a.reason + '</li>').join('');
      return '<div class="route-card">'
        + '<strong>' + w.label + '</strong>'
        + '<div class="muted mono">' + w.prompt_class + '</div>'
        + '<p>' + (w.description || '') + '</p>'
        + '<div class="mono"><span class="pill ok">' + rec.id + '</span></div>'
        + '<p class="muted">' + (rec.reason || '') + '</p>'
        + (alts ? '<ul class="muted">' + alts + '</ul>' : '')
        + '</div>';
    }).join('');
  }

  async function load() {
    $('error').classList.remove('show');
    $('error').textContent = '';
    const res = await fetch('/v1/benchmark/optimizer');
    if (!res.ok) throw new Error('Benchmark API ' + res.status);
    const data = await res.json();
    const candidates = data.candidates || [];
    const avgSuccess = candidates.length
      ? candidates.reduce((s, c) => s + c.success_rate, 0) / candidates.length
      : 0;
    const avgCost = candidates.length
      ? candidates.reduce((s, c) => s + c.cost_usd_per_1m_tokens, 0) / candidates.length
      : 0;

    $('updated').textContent = data.fixture_id + ' · ' + data.source + ' · ' + data.generated_at;
    $('kCandidates').textContent = String(candidates.length);
    $('kWorkloads').textContent = String((data.workloads || []).length);
    $('kSuccess').textContent = pct(avgSuccess);
    $('kCost').textContent = money(avgCost);
    renderMatrix(candidates);
    renderRoutes(data);
    renderExperiments(data.experiments);
    return data;
  }

  $('refresh').addEventListener('click', () => {
    load().catch((err) => {
      $('error').textContent = String(err);
      $('error').classList.add('show');
    });
  });

  $('expForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('expMsg').textContent = '';
    const fd = new FormData(event.target);
    const body = {
      label: String(fd.get('label') || ''),
      change: String(fd.get('change') || ''),
      notes: String(fd.get('notes') || ''),
      baseline_id: String(fd.get('baseline_id') || '') || undefined,
    };
    const res = await fetch('/v1/benchmark/experiments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      $('expMsg').textContent = 'Failed: ' + res.status;
      return;
    }
    const payload = await res.json();
    saveLocalExperiment(payload.entry);
    $('expMsg').textContent = payload.message;
    event.target.reset();
    const data = await fetch('/v1/benchmark/optimizer').then((r) => r.json());
    renderExperiments(data.experiments);
  });

  load().catch((err) => {
    $('error').textContent = String(err);
    $('error').classList.add('show');
  });
})();
</script>
</body>
</html>`;
