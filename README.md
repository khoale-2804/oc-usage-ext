# OpenChamber Usage (Chrome MV3 extension)

Bottom-right overlay on the OpenChamber page showing:

- **OpenCode Go quota** — 5h / weekly / monthly windows as remaining %, with a live reset countdown.
- **Current session** — turn count, cumulative cost, in/out + cache tokens. Updates in real time.
- **Per turn** — the latest 5 turns, each with cache-hit %, price, and `i / c / o`
  (input / cache-read / output) tokens.
- **Peak-hours timer** — DeepSeek peak/off-peak state and countdown to the next switch (any provider can be added to `PEAKS`).

Matches OpenChamber's theme automatically: it renders in a Shadow DOM and reads the app's
CSS variables (`--card`, `--border`, `--primary`, `--chart-2/4`, `--oc-glass-blur`, `--radius`, ...),
so light/dark and theme changes apply with no extra code.

## Install

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (`~/apps/oc-usage-ext`).
3. Open OpenChamber at `http://localhost:3000`. The card appears bottom-right.

No permissions are requested: the content script runs on the page origin and reuses the
OpenChamber UI session cookie for `/api/*` and the SSE stream.

## Different host/port

`matches` in `manifest.json` only lists `localhost:3000` and `127.0.0.1:3000`. Add your LAN or
tunnel origin (e.g. `http://192.168.1.20:3000/*`) and reload the extension.

## Data sources (verified against @openchamber/web 2.1.1)

| Purpose | Call |
|---|---|
| OpenCode Go windows | `GET /api/quota/opencode-go` |
| Current session totals | `GET /api/session/:id` |
| Turns (rows + count) | `GET /api/session/:id/message?limit=100&order=desc` |
| Realtime | `EventSource('/api/event')` — `session.usage.updated`, `session.step.ended`, `session.execution.*` |

A v2 **turn** is a sequence of steps. The widget groups messages by user message: a turn starts at a
`type:"user"` record and sums every completed `type:"assistant"` step after it. Each step carries
`tokens:{input,output,reasoning,cache:{read,write}}` and `cost`; the per-turn cache hit is
`cache.read / (input + cache.read + cache.write)`. `i / c / o` = input / cache-read / output.

## Tuning

- `PEAKS` in `content.js` — add providers/windows; each entry is `{name, tz, weekdays, windows:[[from,to],...]}` (hours, exclusive end).
- Quota poll interval: `setInterval(refreshQuota, 60000)`.
- Card is click-to-collapse (state in `localStorage`).

## Caveats

- `/api/quota/opencode-go` hits `opencode.ai`; `ok:false` renders as `unavailable`/`not configured`, never as 0.
- CSP: `/api` is same-origin (`'self'`), so no `web_accessible_resources` or host permissions are needed.

## Privacy

The extension collects nothing and sends nothing anywhere. It has no `host_permissions`, no
analytics, and no remote endpoints. It only calls the local OpenChamber server that is already
open in the tab (`/api/*` and `/api/event`), using the session cookie that page already has. No
data leaves your machine except OpenChamber's own quota request to `opencode.ai` (which the
server makes, not the extension).

## Package for the Chrome Web Store

```sh
./pack.sh        # builds oc-usage-ext.zip with manifest.json, content.js, icons/
```

Then upload it following the steps below.

## Publish to the Chrome Web Store

1. **Register a developer account** — go to the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole) and pay the one-time
   **US$5** registration fee. One account publishes unlimited extensions, no renewal.
2. **Upload** — Dashboard → **Add new item** → choose `oc-usage-ext.zip` → **Upload**.
3. **Listing** — set the name, summary, description, category, language, and upload:
   - Store icon: `icons/icon128.png` (128×128).
   - At least one screenshot, **1280×800** (or 640×400). Use the harness to capture one.
   - Optional: small promo tile 440×280.
4. **Privacy practices** — declare that the extension does not collect user data; justify the
   `localhost` host access (it only reads the local OpenChamber API). Provide a privacy policy URL
   if asked; the README's Privacy section works as the text.
5. **Distribution** — pick visibility. For a personal tool, **Unlisted** is the usual choice
   (installable via link, not searchable).
6. **Submit for review** — review usually takes hours to a few days for a new item.

Notes:
- `version` in `manifest.json` must increase with every upload.
- The extension only matches `http://localhost:3000/*` and `http://127.0.0.1:3000/*`; add your
  LAN/tunnel origin to `manifest.json` before uploading if you need it.
- Programmatic publishing exists (Chrome Web Store Publish API, `chrome-webstore-upload`), but
  the first submission must go through the dashboard.

