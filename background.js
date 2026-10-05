'use strict';
/*
 * Service worker: the only context that ever holds the API key in the clear.
 *
 * Key vault (option A):
 *   - The API key is encrypted at rest with AES-GCM. The key-encryption-key is
 *     derived from the user's passphrase with PBKDF2-SHA256 (600k iterations,
 *     random 16-byte salt, random 12-byte IV). Only the ciphertext is stored
 *     (chrome.storage.local), locked to TRUSTED_CONTEXTS so content scripts
 *     cannot read it.
 *   - Unlocking decrypts into chrome.storage.session: in-memory only, never
 *     persisted to disk, cleared on browser restart / extension reload, and
 *     not exposed to content scripts (Chrome storage docs, 2026-09-11).
 *   - There is no recovery: a forgotten passphrase means the vault is dead.
 *   - The plaintext is auto-locked after IDLE_LOCK_MS and can be locked or
 *     wiped at any time. It is never sent to any context, only used here to
 *     build the Authorization header.
 *
 * Honest limit: while unlocked, code running in this extension's own service
 * worker can read the key — it must, to send it. Encryption protects it at
 * rest, not from the extension itself.
 */
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const WINDOW_MAP = { '5h': 'rolling', weekly: 'weekly', monthly: 'monthly' };
const KDF_ITERATIONS = 600000;
const IDLE_LOCK_MS = 15 * 60 * 1000;

// Content scripts must never see the vault ciphertext.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function deriveKek(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptKey(apiKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveKek(passphrase, salt, KDF_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, enc.encode(apiKey));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: KDF_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

async function decryptKey(vault, passphrase) {
  const kek = await deriveKek(passphrase, unb64(vault.salt), vault.iter || KDF_ITERATIONS);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, kek, unb64(vault.ct));
  return dec.decode(pt);
}

// ---------------------------------------------------------------- session key
async function getSessionKey() {
  const { ocuKey, ocuKeyAt } = await chrome.storage.session.get(['ocuKey', 'ocuKeyAt']);
  if (!ocuKey) return null;
  if (Date.now() - (ocuKeyAt || 0) > IDLE_LOCK_MS) {
    await chrome.storage.session.remove(['ocuKey', 'ocuKeyAt']);
    return null;
  }
  return ocuKey;
}
const setSessionKey = (key) => chrome.storage.session.set({ ocuKey: key, ocuKeyAt: Date.now() });
const clearSessionKey = () => chrome.storage.session.remove(['ocuKey', 'ocuKeyAt']);

// ------------------------------------------------------------------- provider
function toWindow(entry) {
  if (!entry || typeof entry.percent !== 'number' || !Number.isFinite(entry.percent)) return null;
  const usedPercent = Math.min(100, Math.max(0, entry.percent));
  const resetAt = Date.parse(entry.resetsAt);
  const hasReset = Number.isFinite(resetAt);
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowSeconds: null,
    resetAt: hasReset ? resetAt : null,
    resetAtFormatted: hasReset ? new Date(resetAt).toLocaleString() : null,
    resetAfterSeconds: hasReset ? Math.max(0, Math.floor((resetAt - Date.now()) / 1000)) : null,
  };
}

async function fetchQuotaWithKey(apiKey) {
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: 'Bearer ' + apiKey,
      Accept: 'application/json',
      'x-opencode-session': 'oc-usage-ext',
      'User-Agent': 'oc-usage-ext',
    },
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) throw new Error('key rejected');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const payload = await res.json().catch(() => null);
  const usage = payload && payload.usage ? payload.usage : {};
  const windows = {};
  for (const [key, src] of Object.entries(WINDOW_MAP)) {
    const w = toWindow(usage[src]);
    if (w) windows[key] = w;
  }
  if (Object.keys(windows).length === 0) throw new Error('no usage data');
  return {
    providerId: 'opencode-go',
    providerName: 'OpenCode Go',
    ok: true,
    configured: true,
    usage: { windows },
    fetchedAt: Date.now(),
  };
}

async function getQuota() {
  const key = await getSessionKey();
  if (!key) {
    const { vault } = await chrome.storage.local.get('vault');
    return vault
      ? { providerId: 'opencode-go', providerName: 'OpenCode Go', ok: false, configured: true, locked: true }
      : { providerId: 'opencode-go', providerName: 'OpenCode Go', ok: false, configured: false };
  }
  try {
    return await fetchQuotaWithKey(key);
  } catch (error) {
    return {
      providerId: 'opencode-go',
      providerName: 'OpenCode Go',
      ok: false,
      configured: true,
      error: String(error && error.message || error),
    };
  }
}

async function vaultStatus() {
  const { vault } = await chrome.storage.local.get('vault');
  const key = await getSessionKey();
  return { configured: Boolean(vault), unlocked: Boolean(key) };
}

async function saveVault(apiKey, passphrase) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) return { ok: false, error: 'empty key' };
  if (typeof passphrase !== 'string' || passphrase.length < 8) return { ok: false, error: 'passphrase must be at least 8 characters' };
  try {
    await fetchQuotaWithKey(apiKey.trim()); // validate before storing
  } catch (error) {
    return { ok: false, error: 'key check failed: ' + String(error && error.message || error) };
  }
  const vault = await encryptKey(apiKey.trim(), passphrase);
  await chrome.storage.local.set({ vault });
  await setSessionKey(apiKey.trim());
  return { ok: true, unlocked: true };
}

async function unlockVault(passphrase) {
  const { vault } = await chrome.storage.local.get('vault');
  if (!vault) return { ok: false, error: 'no vault' };
  let apiKey;
  try {
    apiKey = await decryptKey(vault, passphrase);
  } catch {
    return { ok: false, error: 'wrong passphrase' };
  }
  await setSessionKey(apiKey);
  return { ok: true, unlocked: true };
}

async function wipeVault() {
  await chrome.storage.local.remove('vault');
  await clearSessionKey();
  return { ok: true };
}

// ------------------------------------------------------------------ messaging
const HANDLERS = {
  'ocu:quota': getQuota,
  'ocu:vaultStatus': vaultStatus,
  'ocu:setKey': (msg) => saveVault(msg.apiKey, msg.passphrase),
  'ocu:unlock': (msg) => unlockVault(msg.passphrase),
  'ocu:lock': async () => { await clearSessionKey(); return { ok: true, unlocked: false }; },
  'ocu:wipe': wipeVault,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg)).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});
