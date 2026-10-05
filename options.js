'use strict';
/* Options page: store the OpenCode Go API key used by the popup (API-key mode). */
(() => {
  const $ = (id) => document.getElementById(id);
  const status = (text, kind) => {
    const el = $('status');
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  };

  async function testQuota() {
    try { return await chrome.runtime.sendMessage({ type: 'ocu:quota' }); }
    catch { return { ok: false, configured: true, error: 'worker unavailable' }; }
  }

  async function save() {
    const key = $('key').value.trim();
    await chrome.storage.local.set({ apiKey: key });
    const q = await testQuota();
    if (q && q.ok) {
      const w = q.usage.windows;
      const parts = ['5h', 'weekly', 'monthly'].filter((k) => w[k])
        .map((k) => k + ' ' + (100 - Math.round(w[k].usedPercent)) + '% left');
      status('Saved. ' + (parts.join(' · ') || 'no windows returned'), 'ok');
    } else if (q && q.configured === false) {
      status('Saved, but the key is empty.', 'err');
    } else {
      status('Saved, but the usage call failed: ' + ((q && q.error) || 'unknown'), 'err');
    }
  }

  async function clear() {
    await chrome.storage.local.remove('apiKey');
    $('key').value = '';
    status('Key cleared.', '');
  }

  async function load() {
    const { apiKey } = await chrome.storage.local.get('apiKey');
    $('key').value = apiKey || '';
    if (apiKey) {
      const q = await testQuota();
      status(q && q.ok ? 'Key is working.' : 'Stored key: ' + ((q && q.error) || 'not verified'), q && q.ok ? 'ok' : 'err');
    }
  }

  $('save').addEventListener('click', save);
  $('clear').addEventListener('click', clear);
  load();
})();
