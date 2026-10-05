'use strict';
/*
 * OpenChamber Usage — content-script widget.
 *
 * Runs on the OpenChamber page origin, so it reuses the UI's session cookie for
 * every call. Verified against @openchamber/web 2.1.1:
 *   GET  /api/quota/opencode-go            -> {ok, configured, usage.windows}
 *   GET  /api/session?limit=N              -> {data:[session...], cursor}
 *   GET  /api/session/:id                  -> {data:{cost, tokens, ...}}
 *   GET  /api/session/:id/message?limit=   -> {data:[msg...]} (assistant msgs carry finish/tokens/cost)
 *   SSE  /api/event                        -> data: {id, type, data}
 *      session.usage.updated {sessionID, cost, tokens}
 *      session.step.ended    {sessionID, assistantMessageID, cost, tokens, finish}
 *      session.execution.started|succeeded|interrupted|failed {sessionID}
 */
(() => {
  const ORIGIN = location.origin;

  const getJSON = async (path) => {
    const res = await fetch(ORIGIN + path, { credentials: 'include' });
    if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
    return res.json();
  };

  // ---------------------------------------------------------------- helpers
  const fmtTokens = (n) => {
    if (!Number.isFinite(n)) return '-';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  };
  const fmtMoney = (n) => {
    if (!Number.isFinite(n)) return '-';
    if (n === 0) return '$0';
    return '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(3));
  };
  const fmtDur = (sec) => {
    if (!Number.isFinite(sec) || sec <= 0) return 'now';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  };

  // ------------------------------------------------------------ peak hours
  // Mirrors ~/.config/opencode/deepseek_peak_toggle.sh: peak = 10:00-13:00 &
  // 15:00-19:00 Asia/Tokyo, Mon-Fri; weekends fully off-peak. Evaluated in the
  // provider's timezone so it stays correct from any browser locale.
  const PEAKS = [
    { id: 'deepseek', name: 'DeepSeek', tz: 'Asia/Tokyo', weekdays: [1, 2, 3, 4, 5], windows: [[10, 13], [15, 19]] },
  ];
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  const partsIn = (ms, tz) => {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const o = {};
    for (const p of f.formatToParts(ms)) o[p.type] = p.value;
    return { wd: WD[o.weekday], h: (+o.hour) % 24, m: +o.minute };
  };
  const isPeak = (peak, ms) => {
    const p = partsIn(ms, peak.tz);
    if (!peak.weekdays.includes(p.wd)) return false;
    return peak.windows.some(([a, b]) => p.h >= a && p.h < b);
  };
  // Scan by the minute (<= 8 days); JST has no DST so boundaries are exact.
  const nextChange = (peak, nowMs) => {
    const cur = isPeak(peak, nowMs);
    for (let i = 1; i <= 8 * 24 * 60; i++) {
      const t = nowMs + i * 60000;
      if (isPeak(peak, t) !== cur) return t;
    }
    return null;
  };

  // ------------------------------------------------------------------ DOM
  const host = document.createElement('div');
  host.id = 'oc-usage-ext';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000';
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        color: var(--card-foreground, #eee);
        background: color-mix(in oklab, var(--card, #1f1f1f) 90%, transparent);
        border: 1px solid var(--border, #444);
        border-radius: var(--radius, 9px);
        box-shadow: 0 6px 24px rgb(0 0 0 / .28);
        backdrop-filter: blur(var(--oc-glass-blur, 22px)) saturate(var(--oc-glass-saturation, 1.2));
        width: 268px;
        overflow: hidden;
      }
      .row { display: flex; align-items: center; gap: 6px; padding: 7px 10px; }
      .hdr { cursor: pointer; user-select: none; }
      .hdr .title { font-weight: 600; flex: 1; }
      .body { border-top: 1px solid var(--border, #444); }
      .sep { height: 1px; background: var(--border, #444); }
      .sec { padding: 8px 10px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted-foreground, #888); flex: none; }
      .dot.off { background: var(--chart-2, #4caf50); }
      .dot.on { background: var(--chart-4, #e57373); }
      .muted { color: var(--muted-foreground, #999); }
      .val { font-variant-numeric: tabular-nums; }
      .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
      .bar { height: 4px; border-radius: 3px; background: var(--muted, #333); overflow: hidden; flex: 1; }
      .bar > i { display: block; height: 100%; background: var(--primary, #e8b04b); border-radius: 3px; }
      .grid { display: grid; grid-template-columns: 36px 1fr auto; gap: 4px 8px; align-items: center; }
      .badge { font-size: 10px; padding: 1px 6px; border-radius: 99px; background: var(--muted, #333); }
      .badge.busy { background: var(--primary, #e8b04b); color: var(--primary-foreground, #111); }
      .turns { margin-top: 7px; padding-top: 6px; border-top: 1px dashed var(--border, #444); display: flex; flex-direction: column; gap: 6px; }
      .trow { display: flex; align-items: center; gap: 6px; }
      .hit { font-variant-numeric: tabular-nums; }
      .hit.good { color: var(--chart-2, #4caf50); }
      .chev { transition: transform .15s; }
      .card.collapsed .body { display: none; }
      .card.collapsed .chev { transform: rotate(-90deg); }
    </style>
    <div class="card" id="card">
      <div class="row hdr" id="hdr">
        <span class="chev muted">v</span>
        <span class="title">OpenCode Go</span>
        <span class="badge" id="busy">idle</span>
      </div>
      <div class="body">
        <div class="sec" id="peaks"></div>
        <div class="sep"></div>
        <div class="sec" id="quota"></div>
        <div class="sep"></div>
        <div class="sec" id="session"></div>
      </div>
    </div>`;

  (document.body || document.documentElement).appendChild(host);

  const $ = (id) => root.getElementById(id);
  const card = $('card');

  // collapse toggle, persisted per origin
  const CKEY = 'ocUsage.collapsed';
  if (localStorage.getItem(CKEY) === '1') card.classList.add('collapsed');
  $('hdr').addEventListener('click', () => {
    card.classList.toggle('collapsed');
    localStorage.setItem(CKEY, card.classList.contains('collapsed') ? '1' : '0');
  });

  // ---------------------------------------------------------------- state
  const WINDOW_LABEL = { '5h': '5h', weekly: 'Week', monthly: 'Month' };
  let quota = null;
  const sess = { id: null, cost: 0, tokens: null, turns: 0, turnRows: [], busy: false };

  const cacheHit = (r) => {
    const denom = r.input + r.cacheRead + r.cacheWrite;
    return denom ? Math.round((r.cacheRead / denom) * 100) : null;
  };

  // -------------------------------------------------------------- rendering
  function renderPeaks() {
    const now = Date.now();
    $('peaks').innerHTML = PEAKS.map((p) => {
      const on = isPeak(p, now);
      const nc = nextChange(p, now);
      const dur = nc ? fmtDur((nc - now) / 1000) : '';
      return '<div class="row" style="padding:0">'
        + '<span class="dot ' + (on ? 'on' : 'off') + '"></span>'
        + '<span style="flex:1">' + p.name + ' <span class="muted">' + (on ? 'peak' : 'off-peak') + '</span></span>'
        + '<span class="val muted">' + (dur ? dur + ' &rarr; ' + (on ? 'off-peak' : 'peak') : '-') + '</span>'
        + '</div>';
    }).join('');
  }

  function renderQuota() {
    const el = $('quota');
    if (!quota) { el.innerHTML = '<span class="muted">usage...</span>'; return; }
    if (!quota.ok) {
      const why = quota.configured === false ? 'not configured' : 'unavailable';
      el.innerHTML = '<span class="muted">OpenCode Go: ' + why + '</span>';
      return;
    }
    const w = (quota.usage && quota.usage.windows) || {};
    const elapsed = (Date.now() - (quota.fetchedAt || Date.now())) / 1000;
    const rows = ['5h', 'weekly', 'monthly'].filter((k) => w[k]).map((k, i) => {
      const x = w[k];
      const used = Math.min(100, Math.max(0, Math.round(x.usedPercent || 0)));
      const left = Number.isFinite(x.resetAfterSeconds) ? Math.max(0, x.resetAfterSeconds - elapsed) : NaN;
      const reset = Number.isFinite(left) ? ' &middot; ' + fmtDur(left) : '';
      return '<div class="grid" style="margin-top:' + (i ? '4px' : '0') + '">'
        + '<span class="lbl muted">' + (WINDOW_LABEL[k] || k) + '</span>'
        + '<span class="bar"><i style="width:' + used + '%"></i></span>'
        + '<span class="val muted" title="used ' + used + '%; resets ' + (x.resetAtFormatted || '') + '">'
        + (100 - used) + '%' + reset + '</span>'
        + '</div>';
    });
    el.innerHTML = rows.join('') || '<span class="muted">no windows</span>';
  }

  function renderBusy() {
    const b = $('busy');
    b.textContent = sess.busy ? 'busy' : 'idle';
    b.classList.toggle('busy', sess.busy);
  }

  function renderSession() {
    const el = $('session');
    renderBusy();
    if (!sess.id) { el.innerHTML = '<span class="muted">no active session</span>'; return; }
    const t = sess.tokens || {};
    const parts = [fmtTokens(t.input) + ' in / ' + fmtTokens(t.output) + ' out'];
    if (t.cache && t.cache.read) parts.push('cache ' + fmtTokens(t.cache.read));
    let html =
      '<div class="row" style="padding:0"><span style="flex:1">' + sess.turns + ' turn' + (sess.turns === 1 ? '' : 's') + '</span>'
      + '<span class="val">' + fmtMoney(sess.cost) + '</span></div>'
      + '<div class="muted" style="margin-top:2px">' + parts.join(' &middot; ') + '</div>';

    const rows = sess.turnRows.slice(-5).reverse();
    if (rows.length) {
      html += '<div class="turns">' + rows.map((r, i) => {
        const n = sess.turnRows.length - i;
        const hit = cacheHit(r);
        const hitCls = hit != null && hit >= 80 ? ' hit good' : ' hit';
        return '<div class="turn">'
          + '<div class="trow"><span class="muted">t' + n + '</span>'
          + '<span class="' + hitCls.trim() + '" style="flex:1">' + (hit == null ? '' : hit + '% cache') + '</span>'
          + '<span class="val">' + fmtMoney(r.cost) + '</span></div>'
          + '<div class="trow muted"><span style="flex:1">i ' + fmtTokens(r.input)
          + ' &middot; c ' + fmtTokens(r.cacheRead) + ' &middot; o ' + fmtTokens(r.output) + '</span></div>'
          + '</div>';
      }).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------ data
  // Group messages into turns: a turn starts at a user message and owns every
  // completed assistant step after it (v2 turn = one or more steps). Each step
  // carries tokens{input,output,reasoning,cache{read,write}} and cost.
  function buildTurns(msgsDesc) {
    const turns = [];
    let cur = null;
    for (const m of (msgsDesc || []).slice().reverse()) {
      if (m.type === 'user') {
        cur = { steps: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
        turns.push(cur);
      } else if (m.type === 'assistant' && m.tokens) {
        if (!cur) { cur = { steps: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }; turns.push(cur); }
        cur.steps += 1;
        cur.input += m.tokens.input || 0;
        cur.output += m.tokens.output || 0;
        cur.reasoning += m.tokens.reasoning || 0;
        cur.cacheRead += (m.tokens.cache && m.tokens.cache.read) || 0;
        cur.cacheWrite += (m.tokens.cache && m.tokens.cache.write) || 0;
        cur.cost += m.cost || 0;
      }
    }
    return turns.filter((t) => t.steps > 0);
  }

  async function loadTurns(id) {
    try {
      const r = await getJSON('/api/session/' + encodeURIComponent(id) + '/message?limit=100&order=desc');
      const msgs = r.data || r || [];
      sess.turnRows = buildTurns(msgs);
      sess.turns = sess.turnRows.length;
    } catch { /* keep previous */ }
  }

  async function loadSession(id) {
    try {
      const r = await getJSON('/api/session/' + encodeURIComponent(id));
      const s = r.data || r;
      if (!s || !s.id) return;
      sess.id = s.id;
      sess.cost = s.cost || 0;
      sess.tokens = s.tokens || null;
      await loadTurns(s.id);
      renderSession();
    } catch { /* session may have vanished */ }
  }

  async function pickSession() {
    const fromUrl = new URL(location.href).searchParams.get('session');
    if (fromUrl) { await loadSession(fromUrl); return; }
    try {
      const r = await getJSON('/api/session?limit=1');
      const s = (r.data || [])[0];
      if (s && s.id) await loadSession(s.id);
    } catch { /* ignore */ }
  }

  async function refreshQuota() {
    try { quota = await getJSON('/api/quota/opencode-go'); }
    catch (e) { quota = { ok: false, configured: true, error: String(e && e.message || e) }; }
    renderQuota();
  }

  // -------------------------------------------------------------- realtime
  let refreshTimer = null;
  const scheduleRefresh = (id) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (id === sess.id) loadSession(id); }, 600);
  };

  function connect() {
    const es = new EventSource(ORIGIN + '/api/event');
    es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      const d = ev.data || {};
      const sid = d.sessionID;
      if (!sid) return;
      if (!sess.id) { loadSession(sid); return; }
      if (sid !== sess.id) return;

      switch (ev.type) {
        case 'session.execution.started':
          sess.busy = true; renderBusy(); break;
        case 'session.execution.succeeded':
        case 'session.execution.interrupted':
        case 'session.execution.failed':
          sess.busy = false; renderBusy(); scheduleRefresh(sid); break;
        case 'session.usage.updated':
          if (d.cost != null) sess.cost = d.cost;
          if (d.tokens) sess.tokens = d.tokens;
          renderSession(); break;
        case 'session.step.ended':
          if (d.cost != null) sess.cost = d.cost;
          if (d.tokens) sess.tokens = d.tokens;
          renderSession();
          scheduleRefresh(sid);   // rebuild turn rows from the message list
          break;
        default: break;
      }
    };
    es.onerror = () => { /* EventSource reconnects on its own */ };
  }

  // ---------------------------------------------------------------- clocks
  renderPeaks();
  renderQuota();
  renderSession();
  refreshQuota();
  pickSession();
  connect();

  setInterval(renderPeaks, 1000);
  setInterval(renderQuota, 1000);           // live reset countdown
  setInterval(refreshQuota, 60000);         // pull the account windows
  setInterval(() => {                       // SPA URL change -> follow session
    const id = new URL(location.href).searchParams.get('session');
    if (id && id !== sess.id) loadSession(id);
  }, 2000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshQuota();
  });
})();
