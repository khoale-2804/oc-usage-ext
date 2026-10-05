'use strict';
/*
 * Service worker: the only place allowed to call opencode.ai cross-origin.
 * Reads the OpenCode Go API key from chrome.storage.local and returns the same
 * shape OpenChamber's /api/quota/opencode-go does, so shared.js can render both.
 *
 * Endpoint + auth verified live: GET https://opencode.ai/zen/go/v1/usage with
 * `Authorization: Bearer <key>` -> {usage:{rolling,weekly,monthly:{percent,resetsAt}}}.
 */
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const WINDOW_MAP = { '5h': 'rolling', weekly: 'weekly', monthly: 'monthly' };

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

async function getQuota() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) return { providerId: 'opencode-go', providerName: 'OpenCode Go', ok: false, configured: false };
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
        'x-opencode-session': 'oc-usage-ext',
        'User-Agent': 'oc-usage-ext',
      },
      cache: 'no-store',
    });
    if (res.status === 401 || res.status === 403) {
      return { providerId: 'opencode-go', providerName: 'OpenCode Go', ok: false, configured: true, error: 'key rejected' };
    }
    if (!res.ok) {
      return { providerId: 'opencode-go', providerName: 'OpenCode Go', ok: false, configured: true, error: 'HTTP ' + res.status };
    }
    const payload = await res.json().catch(() => null);
    const usage = payload && payload.usage ? payload.usage : {};
    const windows = {};
    for (const [key, src] of Object.entries(WINDOW_MAP)) {
      const w = toWindow(usage[src]);
      if (w) windows[key] = w;
    }
    const ok = Object.keys(windows).length > 0;
    return {
      providerId: 'opencode-go',
      providerName: 'OpenCode Go',
      ok,
      configured: true,
      usage: ok ? { windows } : null,
      ...(ok ? {} : { error: 'no usage data' }),
      fetchedAt: Date.now(),
    };
  } catch (error) {
    return { providerId: 'opencode-go', providerName: 'OpenCode Go', ok: false, configured: true, error: 'network error' };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'ocu:quota') {
    getQuota().then(sendResponse, (e) => sendResponse({ ok: false, configured: true, error: String(e && e.message || e) }));
    return true; // async response
  }
  return false;
});
