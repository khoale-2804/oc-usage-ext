# OpenChamber Usage (Chrome MV3 extension)

Bottom-right overlay on the OpenChamber page, plus a toolbar popup that works anywhere.

- **OpenCode Go quota** — 5h / weekly / monthly windows as remaining %, with a live reset countdown.
- **Current session** — turn count, cumulative cost, in/out + cache tokens (OpenChamber page only).
- **Per turn** — the latest 5 turns, each with cache-hit %, price, and `i / c / o`
  (input / cache-read / output) tokens (OpenChamber page only).
- **Usage (all sessions)** — totals, per-model cost, tool success/fail, streak, from the OpenCode
  console API `/api/experimental/session/stats` (OpenChamber page only).
- **Peak-hours timer** — DeepSeek peak/off-peak state and countdown to the next switch.

Matches OpenChamber's theme automatically on the page: it renders in a Shadow DOM and reads the
app's CSS variables (`--card`, `--border`, `--primary`, `--chart-2/4`, `--oc-glass-blur`, `--radius`).

## Two modes

| | OpenChamber page | Toolbar popup (any site) |
|---|---|---|
| Quota windows | ✅ (no key) | ✅ (unlocked vault) |
| Peak timer | ✅ | ✅ |
| Per-turn cost / cache / i-c-o | ✅ | ❌ |
| All-session stats (per-model) | ✅ | ❌ |

On the page it reuses the OpenChamber UI session cookie, so **no key is needed**. The popup has no
session, so it reads quota straight from `opencode.ai` with your **OpenCode Go API key**.

Per-turn data lives in OpenCode's session store, so it is page-only. The API key does not unlock it.

**What it talks to:** the page overlay calls **OpenChamber** (`http://localhost:3000/api/...`), which
proxies **OpenCode** — the per-turn and usage data come from OpenCode's server API through OpenChamber.
The popup talks **directly to `https://opencode.ai`** with the vault key. So the API key is used only
by the popup; the overlay needs none.

## Install

### Chrome / Edge / Brave / Vivaldi (Chromium)
1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (`~/apps/oc-usage-ext`).
3. Open OpenChamber at `http://localhost:3000` for the full overlay.

### Firefox
1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
2. Select `manifest.json` in this folder.
3. The overlay works the same; the popup shows quota + peak timer.

Firefox only supports temporary installs this way — they vanish on restart. For a permanent
install, sign the package on [addons.mozilla.org](https://addons.mozilla.org/developers/) (free,
unlisted is fine); the manifest already carries the required `browser_specific_settings.gecko.id`.

The same package works in both: the manifest declares `background.service_worker` (Chromium) and
`background.scripts` (Firefox event page), and the scripts use `browser.*` when present, else
`chrome.*`.

### Different host (Tailscale, LAN, tunnel)

The overlay only injects on `localhost:3000` / `127.0.0.1:3000` by default. For any other origin:

1. Open the extension's **Settings** (popup → Settings, or `chrome://extensions` → Details → Extension options).
2. Under **OpenChamber server**, enter your address, e.g. `http://100.64.0.5:3000` or
   `http://nuc.tailnet.ts.net:3000`, and click **Save server** — grant the permission when asked.
3. Open OpenChamber at that address; the overlay loads there.

**Use default** clears it. The permission is requested for that one origin only.

## API key vault (popup mode)

Toolbar icon → **Settings** (or `chrome://extensions` → Details → Extension options):

1. Paste your `opencode-go` API key and choose a passphrase (≥8 chars). **Encrypt & save.**
2. Each browser session, unlock once with the passphrase. It auto-locks after 15 minutes; **Lock now**
   and **Wipe vault** are in Settings.

The key is encrypted with AES-GCM; the key-encryption-key is derived from your passphrase with
PBKDF2-SHA256 (600k iterations, random salt). Only the ciphertext is stored. **The key is never shown
again and cannot be recovered if you forget the passphrase.** It is used only to call `opencode.ai`.

Find the key in `~/.local/share/opencode/auth.json` under the `opencode-go` entry, or from your
OpenCode Go account.

## Security model

What the vault guarantees:

- **At rest:** only AES-GCM ciphertext exists (`chrome.storage.local`), locked to trusted extension
  contexts so content scripts cannot read it. No plaintext on disk.
- **In memory:** the unlocked key lives only in `chrome.storage.session` — in-memory, never persisted
  to disk, cleared on browser restart / extension reload, not exposed to content scripts (Chrome
  storage docs, 2026-09-11). It auto-locks after 15 minutes idle.
- **No read-back:** the key is never rendered, in the popup, options page, or anywhere else.
- **No recovery:** a forgotten passphrase means the vault is permanently dead. Wipe deletes it.

What it does **not** guarantee: while unlocked, code running in this extension's own service worker
can read the key — it must, to send the `Authorization` header. Encryption protects the key at rest,
not from the extension itself, and not from a malicious extension update. Since you load it unpacked,
Chrome does not auto-update it; keep it that way.

## Data sources (verified against @openchamber/web 2.1.1)

| Purpose | Call |
|---|---|
| Quota (page) | `GET /api/quota/opencode-go` |
| Quota (popup) | `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>` |
| Current session totals | `GET /api/session/:id` |
| Turns (rows + count) | `GET /api/session/:id/message?limit=100&order=desc` |
| All-session stats | `GET /api/experimental/session/stats?tools=summary&timezone=...` |
| Session log stream | `GET /api/experimental/session/:id/log?follow=true` (SSE, not yet used) |
| Realtime | `EventSource('/api/event')` — `session.usage.updated`, `session.step.ended`, `session.execution.*` |

The stats and log endpoints are OpenCode's own server ("console") API, proxied by OpenChamber at
`http://localhost:3000/api/experimental/...`; the overlay reaches them with the page's session
cookie. `/api/experimental/session/stats` returns `sessions`, `prompts`, `steps`,
`tokens{input,output,reasoning,cache{read,write}}`, `cost`, `tools`, `activeDays`, `streak`,
`activity[]`, and per-model `models[]`.

A v2 **turn** is a sequence of steps. The overlay groups messages by user message: a turn starts at a
`type:"user"` record and sums every completed `type:"assistant"` step after it. Each step carries
`tokens:{input,output,reasoning,cache:{read,write}}` and `cost`; per-turn cache hit is
`cache.read / (input + cache.read + cache.write)`. `i / c / o` = input / cache-read / output.

The popup normalizes the direct usage response (`{usage:{rolling,weekly,monthly:{percent,resetsAt}}}`)
into the same window shape the page API returns, so one renderer serves both.

## Theme

On the page, Shadow DOM keeps CSS custom properties inherited, so `var(--card)` etc. resolve from the
OpenChamber document and follow light/dark automatically. The popup has no page to read, so it ships
its own light/dark palette via `prefers-color-scheme`.

## Peak hours

Mirrors `~/.config/opencode/deepseek_peak_toggle.sh`: peak = 10:00–13:00 & 15:00–19:00
**Asia/Tokyo**, Mon–Fri; weekends off-peak. Computed client-side with
`Intl.DateTimeFormat(timeZone:"Asia/Tokyo")`, so it is correct from any locale. The server-side
state file is not read.

## Privacy

The extension collects nothing and sends nothing to us. It has no analytics.

- On the OpenChamber page it only calls the local server already open in the tab (`/api/*`,
  `/api/event`), using that page's session cookie.
- The popup, when you have unlocked the vault, calls `https://opencode.ai/zen/go/v1/usage` directly
  from the service worker to read your quota. The key is stored only as AES-GCM ciphertext and is
  sent only to `opencode.ai`.
- No other host is contacted. Wipe the vault any time from Settings.

## Package for the Chrome Web Store

```sh
./pack.sh        # builds oc-usage-ext.zip with the extension files only
```

The built `oc-usage-ext.zip` is committed to this repo and attached to each GitHub release, so it can
be downloaded and loaded directly. Rebuild with `./pack.sh` after changes.

## Publish to the Chrome Web Store

1. **Register** — [Developer Dashboard](https://chrome.google.com/webstore/devconsole), one-time
   **US$5**.
2. **Upload** — Dashboard → **Add new item** → `oc-usage-ext.zip`.
3. **Listing** — name, summary, description, category, language; store icon `icons/icon128.png`
   (128×128) and ≥1 screenshot at **1280×800**.
4. **Privacy practices** — declare no data collection; justify the `storage` permission and the
   `https://opencode.ai/*` host permission (reads your own quota with your own key) and the
   `localhost:3000` host access (local OpenChamber API).
5. **Distribution** — **Unlisted** is usual for a personal tool.
6. **Submit for review.**

Notes: bump `version` on every upload; the extension only matches `localhost:3000` /
`127.0.0.1:3000` — add your LAN/tunnel origin to `manifest.json` if needed.

## Tuning

- `PEAKS` in `shared.js` — add providers/windows; `{name, tz, weekdays, windows:[[from,to],...]}`.
- Quota poll interval: 60 s (`content.js`, `popup.js`).
- The page card is click-to-collapse (state in `localStorage`).
