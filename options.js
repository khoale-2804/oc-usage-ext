'use strict';
/* Options: where OpenChamber lives. No secrets are stored anywhere. */
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const $ = (id) => document.getElementById(id);

  const serverStatus = (text, kind) => {
    const el = $('server-status');
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  };

  const normalizeOrigin = (input) => {
    if (!input || !input.trim()) return null;
    let raw = input.trim();
    if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
    try { return new URL(raw).origin; } catch { return null; }
  };

  const send = (msg) => ext.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'worker unavailable' }));

  let defaultOrigin = '';

  async function load() {
    const res = await send({ type: 'ocu:getServer' });
    defaultOrigin = (res && res.defaultOrigin) || '';
    $('server').value = (res && res.serverUrl) || '';
    $('server').placeholder = defaultOrigin;
    if (res && res.canRegister === false) {
      $('register-note').hidden = false;
      $('register-note').textContent =
        'This browser cannot register the overlay at runtime. Add your origin to the content_scripts matches in manifest.json.';
    }
    serverStatus(res && res.serverUrl
      ? 'Chip active on ' + res.serverUrl
      : 'Using the default address ' + defaultOrigin, res && res.serverUrl ? 'ok' : '');
  }

  async function saveServer() {
    const origin = normalizeOrigin($('server').value);
    if (!origin) return serverStatus('Enter a valid address, e.g. http://100.92.46.9:3000', 'err');
    // Must be the first await: permissions.request needs the click gesture.
    let granted = true;
    if (ext.permissions && ext.permissions.request) {
      try { granted = await ext.permissions.request({ origins: [origin + '/*'] }); } catch { granted = false; }
    }
    if (!granted) return serverStatus('Permission denied for ' + origin, 'err');
    const res = await send({ type: 'ocu:setServer', serverUrl: origin });
    serverStatus('Saved. The chip appears on ' + ((res && res.serverUrl) || origin), 'ok');
  }

  async function clearServer() {
    await send({ type: 'ocu:setServer', serverUrl: '' });
    $('server').value = '';
    await load();
  }

  async function clearCache() {
    await send({ type: 'ocu:forgetQuotaCache' });
    return serverStatus('Cached quota forgotten; the chip reads both pools again.', 'ok');
  }

  $('save-server').addEventListener('click', saveServer);
  $('clear-server').addEventListener('click', clearServer);
  $('clear-cache').addEventListener('click', clearCache);
  load();
})();
