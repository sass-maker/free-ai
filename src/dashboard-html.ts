// Dashboard HTML served at /dashboard, /live, /v1/dashboard.
// See src/index.ts for route registration. Uses Chart.js via CDN.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Free AI Gateway — Live</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  :root {
    --bg: #0a0a0b;
    --surface: #111114;
    --surface-2: #17171c;
    --border: #22222a;
    --text: #e7e7ea;
    --muted: #8a8a94;
    --accent: #7c5cff;
    --success: #22c55e;
    --danger: #ef4444;
    --warn: #f59e0b;
    --radius: 10px;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
    font-size: 14px; line-height: 1.4; -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); text-decoration: none; }
  .app { max-width: 1400px; margin: 0 auto; padding: 20px 24px 60px; }
  .topbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
    padding: 14px 16px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); margin-bottom: 20px; }
  .topbar h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: -0.01em; }
  .topbar h1 .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--success); margin-right: 8px; box-shadow: 0 0 8px var(--success);
    animation: pulse 2s infinite; vertical-align: middle; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .topbar .spacer { flex: 1; }
  .topbar input, .topbar select, .topbar button {
    background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit;
    outline: none; transition: border-color .15s;
  }
  .topbar input:focus, .topbar select:focus { border-color: var(--accent); }
  .topbar button { cursor: pointer; }
  .topbar button:hover { border-color: var(--accent); }
  .topbar label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; cursor: pointer; }
  .topbar label input[type=checkbox] { width: auto; accent-color: var(--accent); }
  .last-updated { color: var(--muted); font-size: 12px; font-family: var(--mono); }

  .banner { padding: 10px 14px; border-radius: var(--radius); margin-bottom: 16px;
    font-size: 13px; display: none; line-height: 1.5; }
  .banner.show { display: block; }
  .banner.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; }
  .banner.info { background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.35); color: #c4b5fd; }
  .banner.info code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: var(--mono); color: var(--text); }

  .empty-state { padding: 60px 20px; text-align: center; color: var(--muted);
    background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius); }
  .empty-state code { background: var(--surface-2); padding: 2px 6px; border-radius: 4px;
    font-family: var(--mono); color: var(--text); }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
  .kpi .label { color: var(--muted); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.05em; margin-bottom: 8px; }
  .kpi .value { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .kpi .sub { color: var(--muted); font-size: 12px; margin-top: 4px; font-family: var(--mono); }
  .kpi.good .value { color: var(--success); }
  .kpi.bad .value { color: var(--danger); }

  .grid { display: grid; gap: 16px; }
  .grid-2 { grid-template-columns: 2fr 1fr; }
  @media (max-width: 960px) {
    .grid-2 { grid-template-columns: 1fr; }
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .topbar select, .topbar button { width: 100%; }
  }

  .card { background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
  .card h2 { margin: 0 0 12px; font-size: 13px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.05em; }
  .chart-wrap { position: relative; height: 280px; }
  .chart-wrap.tall { height: 320px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 10px;
    border-bottom: 1px solid var(--border); }
  td { padding: 10px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: rgba(255,255,255,0.02); }
  .mono { font-family: var(--mono); font-size: 12px; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-family: var(--mono); font-weight: 500; }
  .badge.ok { background: rgba(34,197,94,0.15); color: var(--success); }
  .badge.warn { background: rgba(245,158,11,0.15); color: var(--warn); }
  .badge.err { background: rgba(239,68,68,0.15); color: var(--danger); }
  .badge.mute { background: var(--surface-2); color: var(--muted); }

  .progress { position: relative; height: 6px; background: var(--surface-2);
    border-radius: 3px; overflow: hidden; min-width: 80px; }
  .progress > div { height: 100%; background: var(--accent); border-radius: 3px; transition: width .3s; }
  .progress.warn > div { background: var(--warn); }
  .progress.danger > div { background: var(--danger); }
  .progress-label { font-size: 11px; color: var(--muted); margin-top: 4px; font-family: var(--mono); }

  .section-title { font-size: 12px; color: var(--muted); text-transform: uppercase;
    letter-spacing: 0.05em; margin: 20px 0 10px; }

  .throttle-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px; }
  .tcard { background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .tcard .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .tcard .name { font-weight: 600; font-size: 13px; letter-spacing: -0.01em; }
  .tcard .attempts { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .tcard .attempts small { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 4px; }
  .tcard .row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted);
    font-family: var(--mono); }
  .tcard .row b { color: var(--text); font-weight: 500; }
  .tcard .cool { align-self: flex-start; }
  .stackbar { display: flex; height: 6px; width: 100%; background: var(--surface-2);
    border-radius: 3px; overflow: hidden; }
  .stackbar > span { height: 100%; display: block; }
  .stacklegend { display: flex; flex-wrap: wrap; gap: 8px; font-size: 10px; color: var(--muted);
    font-family: var(--mono); }
  .stacklegend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px;
    margin-right: 4px; vertical-align: middle; }
  .pill-ok { background: rgba(34,197,94,0.15); color: var(--success); }
  .pill-warn { background: rgba(245,158,11,0.15); color: var(--warn); }
  .pill-err { background: rgba(239,68,68,0.15); color: var(--danger); }
  .lab-grid { display: grid; grid-template-columns: 160px 1fr 1fr 1fr auto; gap: 10px; align-items: start; }
  .lab-grid input, .lab-grid select, .lab-grid textarea, .lab-grid button {
    width: 100%; background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 9px 10px; font-size: 12px; font-family: inherit; outline: none;
  }
  .lab-grid textarea { grid-column: 1 / 5; min-height: 130px; resize: vertical; font-family: var(--mono); }
  .lab-grid button { cursor: pointer; white-space: nowrap; }
  .lab-grid button:hover { border-color: var(--accent); }
  .lab-result { margin-top: 12px; padding: 12px; min-height: 90px; background: var(--surface-2);
    border: 1px solid var(--border); border-radius: 6px; overflow: auto; white-space: pre-wrap; }
  @media (max-width: 960px) {
    .lab-grid { grid-template-columns: 1fr; }
    .lab-grid textarea { grid-column: auto; }
  }

  .pcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px; margin-bottom: 16px; }
  .pcard { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .pcard.available { border-color: rgba(34,197,94,0.25); }
  .pcard.degraded { border-color: rgba(245,158,11,0.25); }
  .pcard.cooldown, .pcard.exhausted { border-color: rgba(239,68,68,0.25); }
  .pcard .pname { font-weight: 600; font-size: 13px; letter-spacing: -0.01em; display: flex;
    align-items: center; justify-content: space-between; }
  .pcard .pcounts { display: flex; flex-wrap: wrap; gap: 4px; }
  .pcard .pcap { display: flex; flex-direction: column; gap: 3px; }
  .pcard .pcap-label { font-size: 11px; color: var(--muted); font-family: var(--mono); }
  .pcard .pbest { font-size: 11px; color: var(--muted); font-family: var(--mono);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 960px) { .pcards { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <h1><span class="dot"></span>Free AI Gateway — Live</h1>
    <div class="spacer"></div>
    <select id="groupBySel" title="Breakdown grouping">
      <option value="providers" selected>Group: Provider</option>
      <option value="models">Group: Model</option>
      <option value="projects">Group: Project ID</option>
    </select>
    <select id="rangeSel">
      <option value="1">1d</option>
      <option value="7" selected>7d</option>
      <option value="30">30d</option>
      <option value="90">90d</option>
    </select>
    <label><input type="checkbox" id="autoRefresh" checked /> Auto</label>
    <button id="refreshBtn" title="Refresh now">Refresh</button>
    <span class="last-updated" id="lastUpdated">—</span>
  </div>

  <div class="banner info" id="authBanner"></div>
  <div class="banner error" id="errBanner"></div>

  <div id="emptyState" class="empty-state" style="display:none">
    <div style="font-size:15px;color:var(--text);margin-bottom:6px;">No traffic yet</div>
    Hit <code>/v1/chat/completions</code> with an <code>x-gateway-project-id</code> header to start seeing data.
  </div>

  <div id="mainView">
    <div class="kpis">
      <div class="kpi"><div class="label">Total requests</div><div class="value" id="kpiTotal">0</div><div class="sub" id="kpiTotalSub">—</div></div>
      <div class="kpi good"><div class="label">Success rate</div><div class="value" id="kpiSuccess">0%</div><div class="sub" id="kpiSuccessSub">—</div></div>
      <div class="kpi bad"><div class="label">Failed</div><div class="value" id="kpiFailed">0</div><div class="sub" id="kpiFailedSub">—</div></div>
      <div class="kpi"><div class="label">Active models</div><div class="value" id="kpiActive">0</div><div class="sub" id="kpiActiveSub">—</div></div>
    </div>

    <div id="providerCards" class="pcards" style="display:none"></div>

    <div class="grid grid-2" id="analyticsCharts">
      <div class="card" id="timelineCard">
        <h2>Timeline — Successful vs Failed (weekly)</h2>
        <div class="chart-wrap"><canvas id="chartTimeline"></canvas></div>
      </div>
      <div class="card" id="providersCard">
        <h2 id="breakdownTitle">Provider breakdown</h2>
        <div class="chart-wrap"><canvas id="chartProviders"></canvas></div>
        <div id="providerBadges" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;"></div>
      </div>
    </div>

    <div class="card" id="routingCard">
      <h2>Routing fallback order</h2>
      <table>
        <thead><tr>
          <th>Rank</th><th>Model</th><th>Provider</th><th>Status</th><th>Success</th><th>Reasons</th>
        </tr></thead>
        <tbody id="routingBody"></tbody>
      </table>
    </div>

    <div class="card" id="throttleCard" style="display:none">
      <h2>Provider throttle health</h2>
      <div class="throttle-grid" id="throttleGrid"></div>
      <div class="stacklegend" style="margin-top:10px">
        <span><i style="background:#ef4444"></i>usage_retriable</span>
        <span><i style="background:#f59e0b"></i>input_nonretriable</span>
        <span><i style="background:#a855f7"></i>safety_refusal</span>
        <span><i style="background:#6b7280"></i>provider_fatal</span>
        <span><i style="background:#22c55e"></i>success</span>
      </div>
    </div>

    <div class="card">
      <h2>Request replay lab</h2>
      <div class="lab-grid">
        <select id="replayProvider">
          <option value="groq">groq</option>
          <option value="gemini">gemini</option>
          <option value="workers_ai">workers_ai</option>
          <option value="openrouter">openrouter</option>
          <option value="cerebras">cerebras</option>
          <option value="sambanova">sambanova</option>
          <option value="nvidia">nvidia</option>
          <option value="github_models">github_models</option>
          <option value="pollinations">pollinations</option>
          <option value="cohere">cohere</option>
          <option value="mistral">mistral</option>
        </select>
        <input id="replayModel" placeholder="model or auto" value="auto" />
        <input id="replayProject" placeholder="project_id" value="replay-lab" />
        <input id="replayApiKey" type="password" placeholder="API key for replay" autocomplete="off" />
        <button id="replayBtn">Replay</button>
        <textarea id="replayPayload" spellcheck="false">{
  "messages": [
    { "role": "user", "content": "Reply with one short diagnostic sentence." }
  ],
  "temperature": 0.2,
  "max_tokens": 64
}</textarea>
      </div>
      <pre class="lab-result mono" id="replayResult">No replay run yet.</pre>
    </div>

    <div class="card">
      <h2>Live model health</h2>
      <table>
        <thead><tr>
          <th>Key</th><th>Samples</th><th>Success</th><th>Avg</th><th>P90</th><th>P99</th>
          <th>Daily usage</th><th>Status</th>
        </tr></thead>
        <tbody id="healthBody"></tbody>
      </table>
    </div>

    <div class="grid grid-2" id="analyticsTables">
      <div class="card" id="topModelsCard">
        <h2 id="topBreakdownTitle">Top 10 models</h2>
        <table>
          <thead><tr>
            <th id="topBreakdownLabel">Model</th><th>Requests</th><th>Success</th><th>Failed</th>
          </tr></thead>
          <tbody id="topModelsBody"></tbody>
        </table>
      </div>
      <div class="card" id="projectsCard">
        <h2>Projects</h2>
        <table>
          <thead><tr>
            <th>Project</th><th>Requests</th><th>Success</th>
          </tr></thead>
          <tbody id="projectsBody"></tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script type="module">
  function capturePageCrash(error, source) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('foundry_page_crash', {
      project_slug: 'free-ai',
      route: location.origin + location.pathname,
      source,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  window.addEventListener('error', (event) => {
    capturePageCrash(event.error || event.message, 'window_error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    capturePageCrash(event.reason, 'unhandled_rejection');
  });

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (n ?? 0).toLocaleString();
  const pct = (n) => (isFinite(n) ? (n * 100).toFixed(1) + '%' : '—');
  const ms = (n) => (n > 0 ? Math.round(n) + ' ms' : '—');

  const state = {
    days: Number(localStorage.getItem('freeai.days') || 7),
    groupBy: localStorage.getItem('freeai.groupBy') || 'providers',
    replayApiKey: localStorage.getItem('freeai.replayApiKey') || '',
    autoRefresh: localStorage.getItem('freeai.autoRefresh') !== 'false',
    charts: { timeline: null, providers: null },
    inFlight: null,
    timer: null,
  };

  $('rangeSel').value = String(state.days);
  $('groupBySel').value = state.groupBy;
  $('replayApiKey').value = state.replayApiKey;
  $('autoRefresh').checked = state.autoRefresh;

  $('rangeSel').addEventListener('change', (e) => {
    state.days = Number(e.target.value);
    localStorage.setItem('freeai.days', String(state.days));
    refresh();
  });
  $('groupBySel').addEventListener('change', (e) => {
    state.groupBy = e.target.value;
    localStorage.setItem('freeai.groupBy', state.groupBy);
    refresh();
  });
  $('replayApiKey').addEventListener('change', (e) => {
    state.replayApiKey = e.target.value.trim();
    localStorage.setItem('freeai.replayApiKey', state.replayApiKey);
  });
  $('autoRefresh').addEventListener('change', (e) => {
    state.autoRefresh = e.target.checked;
    localStorage.setItem('freeai.autoRefresh', String(state.autoRefresh));
    schedule();
  });
  $('refreshBtn').addEventListener('click', () => refresh());
  $('replayBtn').addEventListener('click', () => replayRequest());

  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('focus', () => { if (state.autoRefresh) refresh(); });

  function showError(msg) {
    const b = $('errBanner');
    if (!msg) { b.classList.remove('show'); b.textContent = ''; return; }
    b.textContent = msg;
    b.classList.add('show');
  }

  function showAnalyticsBanner(visible) {
    const b = $('authBanner');
    if (!visible) { b.classList.remove('show'); b.innerHTML = ''; return; }
    b.innerHTML =
      '<strong>Usage analytics are public.</strong> '
      + 'The dashboard reads aggregate request volume from <code>/v1/analytics</code> without a token. '
      + 'Use the grouping control to switch provider, model, or project-id breakdowns.';
    b.classList.add('show');
  }

  function authHeaders() {
    return state.replayApiKey ? { Authorization: 'Bearer ' + state.replayApiKey } : {};
  }

  async function replayRequest() {
    const out = $('replayResult');
    let payload;
    try {
      payload = JSON.parse($('replayPayload').value);
    } catch (err) {
      out.textContent = 'Invalid JSON: ' + err.message;
      return;
    }

    payload.provider = $('replayProvider').value;
    payload.model = $('replayModel').value.trim() || 'auto';
    payload.project_id = $('replayProject').value.trim() || 'replay-lab';

    out.textContent = 'Running replay...';
    try {
      const res = await fetch('/v1/debug/replay', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      try {
        out.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        out.textContent = text;
      }
    } catch (err) {
      out.textContent = 'Replay failed — ' + err.message;
    }
  }

  async function fetchData(signal) {
    const [healthRes, statsRes, routingRes, analyticsRes] = await Promise.all([
      fetch('/health', { signal }),
      fetch('/v1/stats/providers', { signal }).catch(() => null),
      fetch('/v1/routing/status', { signal }).catch(() => null),
      fetch('/v1/analytics?days=' + state.days, { signal }),
    ]);

    if (!healthRes.ok) {
      throw new Error('Health ' + healthRes.status + ': ' + (await healthRes.text()).slice(0, 200));
    }

    const health = await healthRes.json();
    let providerStats = null;
    if (statsRes && statsRes.ok) {
      try { providerStats = await statsRes.json(); } catch { providerStats = null; }
    }
    let routing = null;
    if (routingRes && routingRes.ok) {
      try { routing = await routingRes.json(); } catch { routing = null; }
    }

    let analytics = null;
    if (!analyticsRes.ok) {
      throw new Error('Analytics ' + analyticsRes.status + ': ' + (await analyticsRes.text()).slice(0, 200));
    } else {
      analytics = await analyticsRes.json();
    }

    return { health, providerStats, routing, analytics };
  }

  async function refresh() {
    if (state.inFlight) state.inFlight.abort();
    const ctrl = new AbortController();
    state.inFlight = ctrl;
    try {
      const { health, providerStats, routing, analytics } = await fetchData(ctrl.signal);
      state.inFlight = null;
      render({ analytics, health, providerStats, routing });
      showError('');
      showAnalyticsBanner(false);
      $('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (err) {
      if (err.name === 'AbortError') return;
      state.inFlight = null;
      showAnalyticsBanner(false);
      showError('Fetch failed — ' + err.message);
    }
  }

  function schedule() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (state.autoRefresh && document.visibilityState === 'visible') {
      state.timer = setInterval(refresh, 5000);
    }
  }

  function render({ analytics, health, providerStats, routing }) {
    const healthItems = health.items || health.models || [];
    const activeModels = healthItems.filter((h) => (h.attempts || 0) > 0).length;
    const total = analytics?.total_requests || 0;

    if (analytics && total === 0 && activeModels === 0) {
      $('emptyState').style.display = 'block';
      $('mainView').style.display = 'none';
      return;
    }

    $('emptyState').style.display = 'none';
    $('mainView').style.display = '';

    if (!analytics) {
      renderRoutingKpis(routing);
      renderTimeline([]);
      renderBreakdown({});
      renderTopBreakdown({});
      renderProjects({});
    } else {
      renderAnalyticsKpis(analytics, healthItems, activeModels);
      renderTimeline(analytics.daily || []);
      renderBreakdown(getActiveBreakdown(analytics));
      renderTopBreakdown(getActiveBreakdown(analytics));
      renderProjects(analytics.projects || {});
    }

    renderProviderCards(routing);
    renderThrottles(providerStats && providerStats.stats ? providerStats.stats : []);
    renderHealth(healthItems);
    renderRouting(routing);
  }

  function renderAnalyticsKpis(analytics, healthItems, activeModels) {
    const total = analytics.total_requests || 0;
    $('kpiTotal').textContent = fmt(total);
    $('kpiTotalSub').textContent = 'last ' + state.days + 'd';
    $('kpiSuccess').textContent = pct(analytics.success_rate || 0);
    $('kpiSuccessSub').textContent = fmt(analytics.successful_requests) + ' ok';
    $('kpiFailed').textContent = fmt(analytics.failed_requests);
    $('kpiFailedSub').textContent = total > 0 ? pct((analytics.failed_requests || 0) / total) + ' of total' : '—';
    $('kpiActive').textContent = activeModels;
    $('kpiActiveSub').textContent = healthItems.length + ' registered';
    $('kpiSuccess').parentElement.className = 'kpi good';
    $('kpiFailed').parentElement.className = 'kpi bad';
    $('kpiTotal').parentElement.querySelector('.label').textContent = 'Total requests';
    $('kpiSuccess').parentElement.querySelector('.label').textContent = 'Success rate';
    $('kpiFailed').parentElement.querySelector('.label').textContent = 'Failed';
    $('kpiActive').parentElement.querySelector('.label').textContent = 'Active models';
  }

  function renderRoutingKpis(routing) {
    const summary = routing?.summary || {};
    $('kpiTotal').textContent = fmt(summary.configured_models || 0);
    $('kpiTotalSub').textContent = 'configured';
    $('kpiSuccess').textContent = fmt(summary.available_models || 0);
    $('kpiSuccessSub').textContent = (summary.degraded_models || 0) + ' degraded';
    $('kpiFailed').textContent = fmt((summary.cooldown_models || 0) + (summary.exhausted_models || 0));
    $('kpiFailedSub').textContent = (summary.cooldown_models || 0) + ' cooldown · ' + (summary.exhausted_models || 0) + ' exhausted';
    $('kpiActive').textContent = summary.fallback_ready ? 'Yes' : 'No';
    $('kpiActiveSub').textContent = summary.top_provider ? 'top: ' + summary.top_provider : '—';
    $('kpiSuccess').parentElement.className = 'kpi good';
    $('kpiFailed').parentElement.className = 'kpi';
    $('kpiTotal').parentElement.querySelector('.label').textContent = 'Configured models';
    $('kpiSuccess').parentElement.querySelector('.label').textContent = 'Available';
    $('kpiFailed').parentElement.querySelector('.label').textContent = 'Unavailable';
    $('kpiActive').parentElement.querySelector('.label').textContent = 'Fallback ready';
  }

  function renderProviderCards(routing) {
    const container = $('providerCards');
    const providers = routing?.providers || {};
    const fallbackOrder = routing?.fallback_order || [];
    const entries = Object.entries(providers);
    if (entries.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';

    // Aggregate daily capacity per provider from fallback_order
    const capacity = {};
    for (const item of fallbackOrder) {
      const p = capacity[item.provider] || { used: 0, limit: 0 };
      p.used += item.daily_used || 0;
      if (typeof item.daily_limit === 'number' && item.daily_limit > 0) {
        p.limit += item.daily_limit;
      }
      capacity[item.provider] = p;
    }

    // Sort: available first, then degraded, then cooldown/exhausted
    const priority = { available: 0, degraded: 1, cooldown: 2, exhausted: 2 };
    entries.sort((a, b) => {
      const aStatus = a[1].available_models > 0 ? 'available' : a[1].degraded_models > 0 ? 'degraded' : a[1].cooldown_models > 0 ? 'cooldown' : 'exhausted';
      const bStatus = b[1].available_models > 0 ? 'available' : b[1].degraded_models > 0 ? 'degraded' : b[1].cooldown_models > 0 ? 'cooldown' : 'exhausted';
      return (priority[aStatus] || 0) - (priority[bStatus] || 0);
    });

    container.innerHTML = '';
    for (const [name, p] of entries) {
      const status = p.available_models > 0 ? 'available' : p.degraded_models > 0 ? 'degraded' : p.cooldown_models > 0 ? 'cooldown' : 'exhausted';
      const statusCls = { available: 'ok', degraded: 'warn', cooldown: 'err', exhausted: 'err' };
      const cap = capacity[name] || { used: 0, limit: 0 };
      const usageRatio = cap.limit > 0 ? Math.min(1, cap.used / cap.limit) : 0;
      const capBarCls = usageRatio >= 0.9 ? 'danger' : usageRatio >= 0.7 ? 'warn' : '';
      const countBadges = [];
      if (p.available_models > 0) countBadges.push('<span class="badge ok">' + p.available_models + ' avail</span>');
      if (p.degraded_models > 0) countBadges.push('<span class="badge warn">' + p.degraded_models + ' deg</span>');
      if (p.cooldown_models > 0) countBadges.push('<span class="badge err">' + p.cooldown_models + ' cool</span>');
      if (p.exhausted_models > 0) countBadges.push('<span class="badge err">' + p.exhausted_models + ' exh</span>');
      const div = document.createElement('div');
      div.className = 'pcard ' + status;
      div.innerHTML =
        '<div class="pname">' + escape(name) + '<span class="badge ' + statusCls[status] + '">' + status + '</span></div>' +
        '<div class="pcounts">' + countBadges.join('') + '</div>' +
        (cap.limit > 0 ? '<div class="pcap"><div class="progress ' + capBarCls + '"><div style="width:' + (usageRatio * 100).toFixed(1) + '%"></div></div><div class="pcap-label">' + fmt(cap.used) + ' / ' + fmt(cap.limit) + ' daily</div></div>' : '') +
        (p.best_model ? '<div class="pbest">' + escape(p.best_model) + '</div>' : '');
      container.appendChild(div);
    }
  }

  function renderRouting(routing) {
    const tb = $('routingBody');
    tb.innerHTML = '';
    const items = routing?.fallback_order || [];
    if (items.length === 0) {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Routing status unavailable</td></tr>';
      return;
    }
    const statusCls = { available: 'ok', degraded: 'warn', cooldown: 'err', exhausted: 'err' };
    for (const item of items.slice(0, 15)) {
      const cls = statusCls[item.status] || 'mute';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + item.rank + '</td>' +
        '<td class="mono">' + escape(item.id) + '</td>' +
        '<td>' + escape(item.provider) + '</td>' +
        '<td><span class="badge ' + cls + '">' + escape(item.status) + '</span></td>' +
        '<td>' + pct(item.success_rate || 0) + '</td>' +
        '<td class="mono" style="font-size:11px;color:var(--muted)">' + escape((item.reasons || []).join(', ')) + '</td>';
      tb.appendChild(tr);
    }
  }

  const chartColors = {
    grid: '#22222a',
    tick: '#8a8a94',
    success: '#22c55e',
    danger: '#ef4444',
    accent: '#7c5cff',
  };
  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartColors.tick, font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: chartColors.tick }, grid: { color: chartColors.grid, drawBorder: false } },
      y: { ticks: { color: chartColors.tick }, grid: { color: chartColors.grid, drawBorder: false }, beginAtZero: true },
    },
  };

  function renderTimeline(daily) {
    const weekly = groupDailyByWeek(daily);
    const labels = weekly.map((d) => d.week);
    const succ = weekly.map((d) => d.successful || 0);
    const fail = weekly.map((d) => d.failed || 0);
    const data = {
      labels,
      datasets: [
        { label: 'Successful', data: succ, backgroundColor: chartColors.success, stack: 's' },
        { label: 'Failed', data: fail, backgroundColor: chartColors.danger, stack: 's' },
      ],
    };
    const opts = { ...baseOpts, scales: { x: { ...baseOpts.scales.x, stacked: true }, y: { ...baseOpts.scales.y, stacked: true } } };
    if (state.charts.timeline) {
      state.charts.timeline.data = data;
      state.charts.timeline.options = opts;
      state.charts.timeline.update('none');
    } else {
      state.charts.timeline = new Chart($('chartTimeline'), { type: 'bar', data, options: opts });
    }
  }

  function groupDailyByWeek(daily) {
    const byWeek = new Map();
    for (const day of daily || []) {
      const week = weekLabel(day.date);
      const current = byWeek.get(week) || { week, successful: 0, failed: 0 };
      current.successful += day.successful || 0;
      current.failed += day.failed || 0;
      byWeek.set(week, current);
    }
    return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
  }

  function weekLabel(dateString) {
    const date = new Date(dateString + 'T00:00:00Z');
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return date.toISOString().slice(0, 10);
  }

  function getActiveBreakdown(analytics) {
    return analytics?.[state.groupBy] || {};
  }

  function activeBreakdownLabel() {
    if (state.groupBy === 'projects') return 'Project ID';
    if (state.groupBy === 'models') return 'Model';
    return 'Provider';
  }

  function activeBreakdownTitle() {
    if (state.groupBy === 'projects') return 'Project-id breakdown';
    if (state.groupBy === 'models') return 'Model breakdown';
    return 'Provider breakdown';
  }

  function renderBreakdown(items) {
    const entries = Object.entries(items).sort((a, b) => (b[1].requests || 0) - (a[1].requests || 0));
    const labels = entries.map((e) => e[0]);
    const values = entries.map((e) => e[1].requests || 0);
    const data = { labels, datasets: [{ label: 'Requests', data: values, backgroundColor: chartColors.accent, borderRadius: 4 }] };
    const opts = { ...baseOpts, indexAxis: 'y', plugins: { legend: { display: false } } };
    $('breakdownTitle').textContent = activeBreakdownTitle();
    if (state.charts.providers) {
      state.charts.providers.data = data;
      state.charts.providers.options = opts;
      state.charts.providers.update('none');
    } else {
      state.charts.providers = new Chart($('chartProviders'), { type: 'bar', data, options: opts });
    }
    const bad = $('providerBadges');
    bad.innerHTML = '';
    entries.forEach(([name, p]) => {
      const rate = p.requests > 0 ? (p.successful || 0) / p.requests : 0;
      const cls = rate >= 0.95 ? 'ok' : rate >= 0.8 ? 'warn' : 'err';
      const el = document.createElement('span');
      el.className = 'badge ' + cls;
      el.textContent = name + ' · ' + pct(rate);
      bad.appendChild(el);
    });
  }

  function renderHealth(items) {
    const tb = $('healthBody');
    tb.innerHTML = '';
    const now = Date.now();
    const sorted = [...items].sort((a, b) => (b.attempts || 0) - (a.attempts || 0));
    if (sorted.length === 0) {
      tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">No models registered</td></tr>';
      return;
    }
    for (const m of sorted) {
      const rate = m.success_rate ?? 0;
      const rateCls = m.attempts > 0 ? (rate >= 0.95 ? 'ok' : rate >= 0.8 ? 'warn' : 'err') : 'mute';
      const used = m.daily_used || 0;
      const limit = m.daily_limit;
      const hasLimit = typeof limit === 'number' && limit > 0;
      const usageRatio = hasLimit ? used / limit : 0;
      const barCls = usageRatio >= 0.9 ? 'danger' : usageRatio >= 0.7 ? 'warn' : '';
      const usageLabel = hasLimit ? fmt(used) + ' / ' + fmt(limit) : fmt(used) + ' today';
      const cooldown = (m.cooldown_until || 0) > now;
      const cooldownSec = cooldown ? Math.ceil((m.cooldown_until - now) / 1000) : 0;
      const statusBadge = cooldown
        ? '<span class="badge err">cooldown ' + cooldownSec + 's</span>'
        : m.attempts > 0 ? '<span class="badge ok">live</span>' : '<span class="badge mute">idle</span>';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="mono">' + escape(m.key) + '</td>' +
        '<td>' + fmt(m.attempts) + '</td>' +
        '<td><span class="badge ' + rateCls + '">' + (m.attempts > 0 ? pct(rate) : '—') + '</span></td>' +
        '<td>' + ms(m.avg_latency_ms) + '</td>' +
        '<td>' + ms(m.p90_latency_ms) + '</td>' +
        '<td>' + ms(m.p99_latency_ms) + '</td>' +
        '<td><div class="progress ' + barCls + '"><div style="width:' + Math.min(100, usageRatio * 100).toFixed(1) + '%"></div></div>' +
          '<div class="progress-label">' + usageLabel + '</div></td>' +
        '<td>' + statusBadge + '</td>';
      tb.appendChild(tr);
    }
  }

  function renderTopBreakdown(items) {
    const tb = $('topModelsBody');
    tb.innerHTML = '';
    const label = activeBreakdownLabel();
    $('topBreakdownTitle').textContent = 'Top 10 ' + label.toLowerCase() + 's';
    $('topBreakdownLabel').textContent = label;
    const entries = Object.entries(items)
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => (b.requests || 0) - (a.requests || 0))
      .slice(0, 10);
    if (entries.length === 0) {
      tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">—</td></tr>';
      return;
    }
    for (const m of entries) {
      const rate = m.requests > 0 ? (m.successful || 0) / m.requests : 0;
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="mono">' + escape(m.key) + '</td>' +
        '<td>' + fmt(m.requests) + '</td>' +
        '<td>' + pct(rate) + '</td>' +
        '<td>' + fmt(m.failed) + '</td>';
      tb.appendChild(tr);
    }
  }

  function renderProjects(projects) {
    const tb = $('projectsBody');
    tb.innerHTML = '';
    const entries = Object.entries(projects)
      .map(([k, v]) => ({ id: k, ...v }))
      .sort((a, b) => (b.requests || 0) - (a.requests || 0));
    if (entries.length === 0) {
      tb.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">No projects yet</td></tr>';
      return;
    }
    for (const p of entries) {
      const rate = p.requests > 0 ? (p.successful || 0) / p.requests : 0;
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="mono">' + escape(p.id) + '</td>' +
        '<td>' + fmt(p.requests) + '</td>' +
        '<td>' + pct(rate) + '</td>';
      tb.appendChild(tr);
    }
  }

  function renderThrottles(stats) {
    const card = $('throttleCard');
    const grid = $('throttleGrid');
    const active = (stats || []).filter((s) => (s.total_attempts || 0) > 0);
    if (active.length === 0) { card.style.display = 'none'; grid.innerHTML = ''; return; }
    card.style.display = '';
    active.sort((a, b) => (b.throttle_rate || 0) - (a.throttle_rate || 0));
    const colors = { usage_retriable: '#ef4444', input_nonretriable: '#f59e0b',
      safety_refusal: '#a855f7', provider_fatal: '#6b7280', success: '#22c55e' };
    grid.innerHTML = '';
    for (const s of active) {
      const rate = s.throttle_rate || 0;
      const pillCls = rate > 0.2 ? 'pill-err' : rate >= 0.05 ? 'pill-warn' : 'pill-ok';
      const fb = s.failure_breakdown || {};
      const total = s.total_attempts || 0;
      const sumFail = (fb.usage_retriable || 0) + (fb.input_nonretriable || 0)
        + (fb.safety_refusal || 0) + (fb.provider_fatal || 0);
      const succCount = Math.max(0, total - sumFail);
      const seg = (n, c) => n > 0 ? '<span style="width:' + (n / total * 100).toFixed(2)
        + '%;background:' + c + '"></span>' : '';
      const bar = seg(fb.usage_retriable || 0, colors.usage_retriable)
        + seg(fb.input_nonretriable || 0, colors.input_nonretriable)
        + seg(fb.safety_refusal || 0, colors.safety_refusal)
        + seg(fb.provider_fatal || 0, colors.provider_fatal)
        + seg(succCount, colors.success);
      const firstThr = s.avg_attempts_before_first_throttle;
      const spacing = s.throttle_spacing_p50;
      const cooling = s.models_in_cooldown || 0;
      const card2 = document.createElement('div');
      card2.className = 'tcard';
      card2.innerHTML =
        '<div class="head">'
        + '<span class="name mono">' + escape(s.provider) + '</span>'
        + '<span class="badge ' + pillCls + '" title="requests that returned 429">'
        + (rate * 100).toFixed(1) + '%</span>'
        + '</div>'
        + '<div class="attempts">' + fmt(total) + '<small>attempts</small></div>'
        + '<div class="stackbar">' + bar + '</div>'
        + '<div class="row"><span>~ before first 429</span><b>'
        + (firstThr == null ? '—' : '~' + Number(firstThr).toFixed(1)) + '</b></div>'
        + '<div class="row"><span>between throttles (p50)</span><b>'
        + (spacing == null ? '—' : 'every ~' + spacing) + '</b></div>'
        + (cooling > 0 ? '<span class="badge err cool">' + cooling + ' cooling down</span>' : '');
      grid.appendChild(card2);
    }
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  refresh();
  schedule();
</script>
</body>
</html>`;
