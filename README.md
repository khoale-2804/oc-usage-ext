# oc-usage-ext — OpenChamber Go chip

A tiny chip for the [OpenChamber](https://github.com/openchamber/openchamber) page:

- **DeepSeek peak hours** — dot, state word, and countdown to the next switch
  (peak = 10:00–13:00 & 15:00–19:00 Asia/Tokyo, Mon–Fri; off-peak is half price),
  with a 24h JST ruler of the two windows.
- **Go key switcher** — lists every OpenCode Go subscription connected in
  OpenCode (`/api/integration/opencode-go`) and makes one active with
  `POST /api/credential/:id/activate`.
- **Per-key quota** — 5h / weekly / monthly remaining for each subscription.

Chrome (MV3) and Firefox 115+ from one package. No API key is stored: the chip
runs on the OpenChamber page origin and signs in with that page's session
cookie. It is meant to be reached over Tailscale; point it at your server in
the options page and the overlay is injected on that origin only.

## Install

- Chrome/Chromium: `chrome://extensions` → enable Developer mode → **Load
  unpacked** → select this folder (or unpack `oc-usage-ext.zip`).
- Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
  → pick `manifest.json` (permanent installs need AMO signing).

Then open the options page and set the **OpenChamber address** (default
`http://100.92.46.9:3000`, your Tailscale address). Clicking the toolbar icon
opens that address.

## How per-key quota works

OpenChamber reports quota for the **active** key only
(`GET /api/quota/opencode-go`), and refuses to hand stored keys to clients
(`GET /api/credential` → 403). So the chip reads each pool by making that key
active for a moment, fetching its quota, and restoring the previously active
key afterwards — about a second for two keys. It does that when you open the
chip or press **refresh**, never on a timer. Which key is currently active is
recognised by matching the live quota fingerprint (reset labels + percentages)
against the cached per-key fingerprints in `storage.local`.

## Theme

The chip inherits OpenChamber's own tokens (`--card`, `--border`, `--primary`,
`--chart-*`, glass blur), so it follows the active flexoki-light / flexoki-dark
theme automatically. The options page ships the Flexoki palette for light and
dark.

## Development

```
node test/peak.test.mjs                  # peak logic + markup builders
python3 -m http.server 8737              # then open
# http://127.0.0.1:8737/test/harness.html?theme=dark&at=16:35
./pack.sh                                # rebuild oc-usage-ext.zip
```

The harness mocks the OpenChamber API and `chrome.storage`, and `?at=HH:MM`
freezes the JST clock (Tue 2026-10-13) so both peak states can be previewed.

## History

- 0.1–0.2 — quota overlay + popup, peak timer (2026-10-05)
- 0.3 — encrypted API-key vault
- 0.4 — console usage section
- 0.5 — Firefox support
- 0.6 — configurable server (Tailscale)
- **0.7 — everything removed but peak hours; Go key switcher + per-key quota;
  the vault, popup, standalone API-key mode and per-turn/usage sections are gone**
