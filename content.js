'use strict';
/*
 * OpenChamber page overlay. Runs on the page origin and reuses the UI session
 * cookie, so no key and no vault are involved. Verified against
 * @openchamber/web 2.3.1:
 *   GET  /api/integration/opencode-go   -> {data:{connections:[{id,label}]}}
 *   GET  /api/quota/opencode-go         -> {ok, usage.windows} for the ACTIVE key
 *   POST /api/credential/:id/activate   -> 204, switches the active key
 * Listing credential keys is refused (403 credential_list_refused), so per-key
 * quota is read by activating each key in turn and restoring the previous one.
 */
(() => {
  if (document.getElementById('oc-usage-ext')) return; // already injected

  const { state, rulerHTML, keyRowsHTML } = OCU;
  const CACHE_TTL_MS = 3 * 60 * 1000;
  const PROBE_KEY = 'ocuCache';

  // ------------------------------------------------------------------ DOM
  const host = document.createElement('div');
  host.id = 'oc-usage-ext';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000';
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        font: 12px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        color: var(--card-foreground, #cecdc3);
        background: color-mix(in oklab, var(--card, #1c1b1a) 92%, transparent);
        border: 1px solid var(--border, #38332b);
        border-radius: var(--radius, 9px);
        box-shadow: 0 10px 30px rgb(0 0 0 / .26);
        backdrop-filter: blur(var(--oc-glass-blur, 22px)) saturate(var(--oc-glass-saturation, 1.2));
        width: 264px; overflow: hidden;
      }
      .hdr { display: flex; align-items: center; gap: 7px; padding: 9px 11px; cursor: pointer; user-select: none; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted-foreground, #878580); flex: none; }
      .dot.on { background: var(--chart-4, #da702c); }
      .dot.off { background: var(--chart-2, #879a39); }
      .dot.live { background: var(--chart-2, #879a39); }
      .dot.idle { background: var(--border, #38332b); }
      .name { font-weight: 600; }
      .word.on { color: var(--chart-4, #da702c); }
      .word.off { color: var(--chart-2, #879a39); }
      .until { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--muted-foreground, #878580); }
      .chev { color: var(--muted-foreground, #878580); transition: transform .15s; }
      .card.collapsed .body { display: none; }
      .card.collapsed .chev { transform: rotate(-90deg); }
      .body { border-top: 1px solid var(--border, #38332b); }
      .ruler { padding: 10px 11px 0; }
      .track { position: relative; height: 4px; border-radius: 3px; background: var(--muted, #282726); }
      .band { position: absolute; top: 0; bottom: 0; border-radius: 3px;
        background: color-mix(in oklab, var(--chart-4, #da702c) 70%, transparent); }
      .now { position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 2px; background: var(--primary, #e8b04b); }
      .marks { position: relative; height: 14px; margin-top: 5px; font-size: 10px; color: var(--muted-foreground, #878580); }
      .mark { position: absolute; }
      .sub { margin-top: 2px; font-size: 10px; color: var(--muted-foreground, #878580); }
      .sec { padding: 10px 11px; }
      .sec + .sec { border-top: 1px solid var(--border, #38332b); }
      .shead { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
      .stitle { flex: 1; color: var(--muted-foreground, #878580); }
      .ghost { background: none; border: 0; padding: 0; font: inherit; color: var(--muted-foreground, #878580); cursor: pointer; }
      .ghost:hover { color: var(--card-foreground, #cecdc3); }
      .krow + .krow { margin-top: 10px; }
      .khead { display: flex; align-items: center; gap: 7px; }
      .kname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .use { border: 1px solid var(--border, #38332b); background: none; color: var(--card-foreground, #cecdc3);
        border-radius: 999px; padding: 1px 9px; font: inherit; cursor: pointer; }
      .use:hover { border-color: var(--primary, #e8b04b); }
      .use.is-active { background: var(--muted, #282726); border-color: transparent; color: var(--muted-foreground, #878580); cursor: default; }
      .meters { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 9px; margin-top: 7px; }
      .m { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 5px; }
      .mlbl { font-size: 10px; color: var(--muted-foreground, #878580); }
      .bar { height: 4px; border-radius: 2px; background: var(--muted, #282726); overflow: hidden; }
      .bar > i { display: block; height: 100%; background: var(--chart-2, #879a39); }
      .bar > i.mid { background: var(--chart-5, #ad8301); }
      .bar > i.low { background: var(--chart-4, #da702c); }
      .val { font-variant-numeric: tabular-nums; color: var(--muted-foreground, #878580); }
      .kbody { margin-top: 3px; }
      .note { font-size: 10px; line-height: 1.4; color: var(--muted-foreground, #878580); }
      @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
    </style>
    <div class="card" id="card">
      <div class="hdr" id="hdr">
        <span class="dot" id="dot"></span>
        <span class="name">DeepSeek</span>
        <span class="word" id="word"></span>
        <span class="until" id="until"></span>
        <span class="chev">⌄</span>
      </div>
      <div class="body" id="body">
        <div class="ruler" id="ruler"></div>
        <div class="sec">
          <div class="shead">
            <span class="stitle">Go keys</span>
            <button class="ghost" id="refresh" type="button">refresh</button>
          </div>
          <div id="keys"></div>
          <div class="note" id="note" style="margin-top:8px"></div>
        </div>
      </div>
    </div>`;

  (document.body || document.documentElement).appendChild(host);

  const $ = (id) => root.getElementById(id);
  const card = $('card');

  // ---------------------------------------------------------------- state
  const st = { keys: [], activeId: null, busy: false, at: 0, open: false, note: '', ambiguous: false };
  const store = (globalThis.browser ?? globalThis.chrome).storage.local;

  const sigOf = (quota) => {
    const w = quota && quota.usage && quota.usage.windows;
    if (!w) return null;
    const one = (x) => x ? [x.usedPercent, x.resetAtFormatted || x.resetAt].join('~') : '';
    return [one(w['5h']), one(w.weekly), one(w.monthly)].join('|');
  };

  const api = async (path, method) => {
    const res = await fetch(location.origin + path, {
      method: method || 'GET', credentials: 'include',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? '{}' : undefined,
    });
    if (res.status === 401 || res.status === 403) throw new Error('sign in to OpenChamber');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.status === 204 ? null : res.json();
  };

  // -------------------------------------------------------------- render
  function renderPeak() {
    const s = state(Date.now());
    $('dot').className = 'dot ' + (s.on ? 'on' : 'off');
    $('word').className = 'word ' + (s.on ? 'on' : 'off');
    $('word').textContent = s.word;
    $('until').textContent = s.until ? s.until + ' to ' + s.nextWord : '';
    $('ruler').innerHTML = rulerHTML(Date.now());
  }

  function renderKeys() {
    $('keys').innerHTML = keyRowsHTML(st.keys, st.activeId);
    for (const b of root.querySelectorAll('.use:not(.is-active)')) {
      b.addEventListener('click', () => switchTo(b.dataset.id));
    }
    $('note').textContent = st.note;
  }

  function render() { renderPeak(); renderKeys(); }

  // ---------------------------------------------------------------- data
  const readCache = async () => {
    try { return (await store.get(PROBE_KEY))[PROBE_KEY] || null; } catch { return null; }
  };
  const writeCache = async (c) => { try { await store.set({ [PROBE_KEY]: c }); } catch { /* ignore */ } };

  async function loadKeys() {
    const r = await api('/api/integration/opencode-go');
    const conn = (r && r.data && r.data.connections) || [];
    return conn.filter((c) => c.type === 'credential' && c.id)
      .map((c) => ({ id: c.id, label: c.label || c.id }));
  }

  // The active key's pool, matched against cached per-key fingerprints: that
  // is how the chip knows which key OpenChamber is on without listing keys.
  // Returns the inferred id plus the live fingerprint, which probe() uses as a
  // fallback restore target on a first run (nothing cached yet).
  async function inferActive(keys, cache) {
    let sig = null;
    try { sig = sigOf(await api('/api/quota/opencode-go')); } catch { return { id: cache.activeId, sig: null }; }
    if (!sig) return { id: cache.activeId, sig: null };
    const match = keys.find((k) => cache.keys[k.id] && cache.keys[k.id].sig === sig);
    return { id: match ? match.id : cache.activeId, sig };
  }

  const withCachedQuota = (keys, cache) => keys.map((k) => ({
    ...k,
    quota: cache.keys[k.id] ? { usage: { windows: cache.keys[k.id].windows } } : null,
  }));

  // activate -> read -> repeat, then restore. ~1s for two keys, on demand only.
  async function probe(keys, restoreId, preSig) {
    const cache = (await readCache()) || { keys: {} };
    cache.keys = cache.keys || {};
    const out = [];
    for (const k of keys) {
      try {
        await api('/api/credential/' + encodeURIComponent(k.id) + '/activate', 'POST');
        const q = await api('/api/quota/opencode-go');
        const sig = sigOf(q);
        cache.keys[k.id] = {
          label: k.label, sig, windows: (q.usage && q.usage.windows) || null, at: Date.now(),
        };
        out.push({ ...k, quota: q, error: q.ok === false ? 'quota unavailable' : null });
      } catch (e) {
        out.push({ ...k, quota: null, error: String((e && e.message) || e) });
      }
    }
    // Put back what was active. On a first run nothing is cached, so the live
    // fingerprint read just before probing identifies it.
    let back = restoreId;
    if (!back && preSig) {
      back = (keys.find((k) => cache.keys[k.id] && cache.keys[k.id].sig === preSig) || {}).id;
    }
    if (back) {
      try { await api('/api/credential/' + encodeURIComponent(back) + '/activate', 'POST'); } catch { /* ignore */ }
      cache.activeId = back;
      st.ambiguous = false;
    } else {
      // Nothing to restore to: the last probed key is the active one now.
      const last = keys[keys.length - 1];
      cache.activeId = last ? last.id : null;
      st.ambiguous = true;
    }
    cache.at = Date.now();
    await writeCache(cache);
    st.activeId = cache.activeId;
    st.at = cache.at;
    return out;
  }

  async function switchTo(id) {
    if (st.busy || id === st.activeId) return;
    st.busy = true;
    st.note = 'switching…';
    renderKeys();
    try {
      await api('/api/credential/' + encodeURIComponent(id) + '/activate', 'POST');
      const q = await api('/api/quota/opencode-go');
      const cache = (await readCache()) || { keys: {} };
      cache.keys = cache.keys || {};
      cache.keys[id] = { sig: sigOf(q), windows: (q.usage && q.usage.windows) || null, at: Date.now() };
      cache.activeId = id;
      cache.at = Date.now();
      await writeCache(cache);
      st.activeId = id;
      st.ambiguous = false;
      for (const k of st.keys) if (k.id === id) k.quota = q;
      st.note = 'Active key switched. Sessions started now use this pool.';
    } catch (e) {
      st.note = 'Switch failed: ' + String((e && e.message) || e);
    }
    st.busy = false;
    renderKeys();
  }

  async function refresh(force) {
    if (st.busy) return;
    st.busy = true;
    st.note = 'reading quota…';
    renderKeys();
    try {
      const keys = await loadKeys();
      if (!keys.length) {
        st.keys = [];
        st.note = 'No OpenCode Go keys connected.';
        st.busy = false;
        renderKeys();
        return;
      }
      const cache = (await readCache()) || { keys: {} };
      cache.keys = cache.keys || {};
      const inferred = await inferActive(keys, cache);
      st.activeId = inferred.id;
      cache.activeId = st.activeId;
      const complete = keys.every((k) => cache.keys[k.id]);
      if (force || !complete || Date.now() - (cache.at || 0) > CACHE_TTL_MS) {
        st.keys = await probe(keys, st.activeId, inferred.sig);
      } else {
        await writeCache(cache);
        st.at = cache.at;
        st.keys = withCachedQuota(keys, cache);
      }
      st.note = st.ambiguous
        ? 'Could not tell which key was active before the read; ' +
          (st.keys[st.keys.length - 1] || {}).label + ' was left active.'
        : 'Quota is per subscription. Reading a key makes it active momentarily, then the previous key is restored.';
    } catch (e) {
      st.note = 'OpenChamber unreachable: ' + String((e && e.message) || e);
    }
    st.busy = false;
    renderKeys();
    renderPeak();
  }

  // ---------------------------------------------------------------- wiring
  card.classList.add('collapsed');
  $('hdr').addEventListener('click', () => {
    st.open = !st.open;
    card.classList.toggle('collapsed', !st.open);
    if (st.open) refresh(false);
  });
  $('refresh').addEventListener('click', (e) => { e.stopPropagation(); refresh(true); });

  render();
  setInterval(renderPeak, 1000);
})();
