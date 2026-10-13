'use strict';
/*
 * Service worker. No secrets live here any more: the overlay talks to
 * OpenChamber with the page's own session cookie.
 *
 * It does two things:
 *   - registers/unregisters the overlay for the configured OpenChamber origin
 *     (default: the Tailscale address), and
 *   - opens that origin in a tab when the toolbar icon is clicked.
 */
const ext = globalThis.browser ?? globalThis.chrome;

const DYNAMIC_SCRIPT_ID = 'ocu-overlay';
const DEFAULT_ORIGIN = 'http://100.92.46.9:3000';

const normalizeOrigin = (input) => {
  if (typeof input !== 'string' || !input.trim()) return null;
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
  try { return new URL(raw).origin; } catch { return null; }
};

const storedOrigin = async () => {
  const { serverUrl } = await ext.storage.local.get('serverUrl');
  return serverUrl || DEFAULT_ORIGIN;
};

const canRegister = () => typeof ext.scripting?.registerContentScripts === 'function';

async function syncContentScript() {
  if (!canRegister()) return;
  const origin = await storedOrigin();
  try {
    const existing = await ext.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
    if (existing.length) await ext.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
  } catch { /* nothing registered */ }
  if (!origin) return;
  try {
    await ext.scripting.registerContentScripts([{
      id: DYNAMIC_SCRIPT_ID,
      matches: [origin + '/*'],
      js: ['shared.js', 'content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]);
  } catch (e) {
    console.warn('[oc-go] overlay registration failed:', e && e.message);
  }
}

ext.runtime.onInstalled.addListener(() => { syncContentScript(); });
ext.runtime.onStartup.addListener(() => { syncContentScript(); });
syncContentScript();

// -------------------------------------------------------------- toolbar click
ext.action.onClicked.addListener(async () => {
  const origin = await storedOrigin();
  try {
    const tabs = await ext.tabs.query({ url: origin + '/*' });
    if (tabs.length) {
      await ext.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId != null) await ext.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
  } catch { /* no host permission for that origin yet: just open it */ }
  await ext.tabs.create({ url: origin });
});

// ------------------------------------------------------------------ messaging
const HANDLERS = {
  'ocu:getServer': async () => {
    const raw = (await ext.storage.local.get('serverUrl')).serverUrl || null;
    return { ok: true, serverUrl: raw, defaultOrigin: DEFAULT_ORIGIN, canRegister: canRegister() };
  },
  'ocu:setServer': async (msg) => {
    const origin = normalizeOrigin(msg.serverUrl);
    if (!origin) {
      await ext.storage.local.remove('serverUrl');
      await syncContentScript();
      return { ok: true, serverUrl: null, defaultOrigin: DEFAULT_ORIGIN };
    }
    await ext.storage.local.set({ serverUrl: origin });
    await syncContentScript();
    return { ok: true, serverUrl: origin, defaultOrigin: DEFAULT_ORIGIN };
  },
  'ocu:forgetQuotaCache': async () => {
    await ext.storage.local.remove('ocuCache');
    return { ok: true };
  },
};

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg)).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
