# OpenChamber Usage (Chrome MV3 extension)

Bottom-right overlay on the OpenChamber page, plus a toolbar popup that works anywhere.

- **OpenCode Go quota** — 5h / weekly / monthly windows as remaining %, with a live reset countdown.
- **Current session** — turn count, cumulative cost, in/out + cache tokens (OpenChamber page only).
- **Per turn** — the latest 5 turns, each with cache-hit %, price, and `i / c / o`
  (input / cache-read / output) tokens (OpenChamber page only).
- **Peak-hours timer** — DeepSeek peak/off-peak state and countdown to the next switch.

Matches OpenChamber's theme automatically on the page: it renders in a Shadow DOM and reads the
app's CSS variables (`--card`, `--border`, `--primary`, `--chart-2/4`, `--oc-glass-blur`, `--radius`).

## Two modes

| | OpenChamber page | Toolbar popup (any site) |
|---|---|---|
| Quota windows | ✅ (no key) | ✅ (needs API key) |
| Peak timer | ✅ | ✅ |
| Per-turn cost / cache / i-c-o | ✅ | ❌ |

On the page it reuses the OpenChamber UI session cookie, so **no key is needed**. The popup has no
session, so it reads quota straight from `opencode.ai` with your **OpenCode Go API key**.

Per-turn data lives in OpenCode's session store, so it is page-only. The API key does not unlock it.

## Install

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (`~/apps/oc-usage-ext`).
3. Open OpenChamber at `http://localhost:3000` for the full overlay.

## API key (popup mode)

Toolbar icon → **Settings** (or `chrome://extensions` → Details → Extension options), paste your
`opencode-go` API key, **Save & test**. It is stored in `chrome.storage.local` on your machine.

The key is the one OpenCode uses; find it in `~/.local/share/opencode/auth.json` under the
`opencode-go` entry, or from your OpenCode Go account.

## Data sources (verified against @openchamber/web 2.1.1)

| Purpose | Call |
|---|---|
| Quota (page) | `GET /api/quota/opencode-go` |
| Quota (popup) | `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>` |
| Current session totals | `GET /api/session/:id` |
| Turns (rows + count) | `GET /api/session/:id/message?limit=100&order=desc` |
| Realtime | `EventSource('/api/event')` — `session.usage.updated`, `session.step.ended`, `session.execution.*` |

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
- The popup, when you have saved a key, calls `https://opencode.ai/zen/go/v1/usage` directly from
  the service worker to read your quota. The key is stored locally in `chrome.storage.local` and is
  sent only to `opencode.ai`.
- No other host is contacted. Remove the key any time from Settings.

## Package for the Chrome Web Store

```sh
./pack.sh        # builds oc-usage-ext.zip with the extension files only
```

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
