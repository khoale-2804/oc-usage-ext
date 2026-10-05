'use strict';
/* Options page: manage the encrypted key vault. The key is never displayed. */
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  const status = (text, kind) => {
    const el = $('status');
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  };

  const send = (msg) => ext.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'worker unavailable' }));

  async function refresh() {
    const st = await send({ type: 'ocu:vaultStatus' });
    const hasVault = Boolean(st && st.configured);
    $('setup').style.display = hasVault ? 'none' : '';
    $('manage').style.display = hasVault ? '' : 'none';
    if (!hasVault) status('No key set.');
    else if (st.unlocked) status('Vault configured. Unlocked (auto-locks after 15 min idle).', 'ok');
    else status('Vault configured. Locked.', '');
    $('key').value = '';
    $('pass').value = '';
    $('pass2').value = '';
    $('unlock-pass').value = '';
  }

  async function save() {
    const apiKey = $('key').value.trim();
    const pass = $('pass').value;
    const pass2 = $('pass2').value;
    if (!apiKey) return status('Enter the API key.', 'err');
    if (pass.length < 8) return status('Passphrase must be at least 8 characters.', 'err');
    if (pass !== pass2) return status('Passphrases do not match.', 'err');
    status('Checking key and encrypting...');
    const res = await send({ type: 'ocu:setKey', apiKey, passphrase: pass });
    if (res && res.ok) { await refresh(); status('Saved and unlocked. The key will not be shown again.', 'ok'); }
    else status('Failed: ' + ((res && res.error) || 'unknown'), 'err');
  }

  async function unlock() {
    const pass = $('unlock-pass').value;
    if (!pass) return status('Enter your passphrase.', 'err');
    status('Unlocking...');
    const res = await send({ type: 'ocu:unlock', passphrase: pass });
    if (res && res.ok) { await refresh(); status('Unlocked for this session.', 'ok'); }
    else status('Failed: ' + ((res && res.error) || 'unknown'), 'err');
  }

  async function lock() {
    await send({ type: 'ocu:lock' });
    await refresh();
    status('Locked.', '');
  }

  async function wipe() {
    if (!confirm('Wipe the vault? The stored key is unrecoverable and you will need to enter it again.')) return;
    await send({ type: 'ocu:wipe' });
    await refresh();
    status('Vault wiped.', '');
  }

  // --- OpenChamber server (Tailscale etc.) ---
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

  async function loadServer() {
    const res = await send({ type: 'ocu:getServer' });
    $('server').value = (res && res.serverUrl) || '';
    if (res && res.canRegister === false) {
      serverStatus('This browser cannot register the overlay at runtime; add the origin to manifest.json instead.', 'err');
    } else if (res && res.serverUrl) {
      serverStatus('Overlay active on ' + res.serverUrl, 'ok');
    } else {
      serverStatus('Using the default localhost:3000.');
    }
  }

  async function saveServer() {
    const origin = normalizeOrigin($('server').value);
    if (!origin) return serverStatus('Enter a valid URL, e.g. http://100.64.0.5:3000', 'err');
    // Must be the first await: permissions.request needs the click gesture.
    let granted = true;
    if (ext.permissions && ext.permissions.request) {
      try { granted = await ext.permissions.request({ origins: [origin + '/*'] }); } catch { granted = false; }
    }
    if (!granted) return serverStatus('Permission denied for ' + origin, 'err');
    const res = await send({ type: 'ocu:setServer', serverUrl: origin });
    $('server').value = (res && res.serverUrl) || origin;
    serverStatus('Saved. Overlay active on ' + ((res && res.serverUrl) || origin), 'ok');
  }

  async function clearServer() {
    await send({ type: 'ocu:setServer', serverUrl: '' });
    $('server').value = '';
    serverStatus('Using the default localhost:3000.');
  }

  $('save-server').addEventListener('click', saveServer);
  $('clear-server').addEventListener('click', clearServer);
  loadServer();

  $('save').addEventListener('click', save);
  $('do-unlock').addEventListener('click', unlock);
  $('lock').addEventListener('click', lock);
  $('wipe').addEventListener('click', wipe);
  refresh();
})();
