# CDP Debugging (Claude ↔ Electron)

EM's `serve` task forwards all `--` CLI flags to the Electron child process. This enables Chrome DevTools Protocol (CDP) debugging, which lets Claude (or any CDP client) interact with the running Electron app — take screenshots, click elements, type text, evaluate JS, read console logs, inspect network requests, etc.

Two ways to use it: **the built-in `npx mgr cdp` toolkit** (below — zero setup, multi-target, knows EM's conventions) and the `chrome-devtools-electron` MCP (further down — richer single-page interaction: click/fill/network/traces).

## Launching with CDP

Two equivalent ways:

```bash
# Env var (recommended)
EM_CDP_PORT=9222 npm start

# CLI flag
npm start -- --remote-debugging-port=9222
```

Both add `--remote-debugging-port=9222` to the Electron spawn args. The env var takes precedence if both are set; a CLI flag already present won't be duplicated.

Verify CDP is live:

```bash
curl -s http://localhost:9222/json
# Returns JSON array of page targets (one per BrowserWindow)
```

## The `mgr cdp` toolkit

Zero-dependency subcommands for driving the running dev app — see, act, and run the no-watch iterate loop. All read `EM_CDP_PORT` (default 9222).

```bash
npx mgr cdp status                          # running? targets, window rect, theme
npx mgr cdp eval <match> '<expr>'           # evaluate JS in any webContents
npx mgr cdp shot <match> <out.png>          # ONE renderer's own pixels
npx mgr cdp capture <out.png>               # the COMPOSITED window (macOS)
npx mgr cdp theme <dark|light|system>       # flip the live theme (manager.theme)
npx mgr cdp relaunch                        # quit → npm start → wait for boot
npx mgr cdp quit                            # quit + wait for the process tree to drain
```

### The multi-target model

An EM app is one window but potentially MANY webContents (every BrowserWindow + every `WebContentsView` is its own CDP page target). Every subcommand takes a **URL-substring matcher** instead of a "current page": the main window's document is always `/views/main/` (EM's templating convention); other views match by their own URLs. `status` lists what's live.

```bash
npx mgr cdp eval "/views/main/" 'document.title'
npx mgr cdp eval "example.com" 'getComputedStyle(document.body).backgroundColor'
npx mgr cdp eval "/views/main/" "window.em.ipc.invoke('my-app:some-channel')"   # the real IPC surface
```

Promises are awaited, results print as JSON, and expressions run with a user gesture (focus()/clipboard-ish APIs behave like real input).

### shot vs capture — the compositing discriminator

`shot` asks ONE renderer for its own surface; `capture` photographs the window the OS composited (the BrowserWindow document + every WebContentsView stacked). They answer different questions:

- Styling wrong in one view? → `shot` that target.
- Layering/transparency/z-order wrong? → `capture`; if `shot` looks right but `capture` doesn't, the bug is in compositing, not your CSS.

Caveats:
- `shot` needs a VISIBLE surface — a hidden view (`setVisible(false)`, a background view) produces no compositor frames and the capture times out. Show/select it first.
- `capture` raises the app and region-captures its rect — anything overlaying that region still wins. For an occlusion-proof image: `--find-window-id` (slow Swift path; JXA's CoreGraphics bridge segfaults) → `capture <out.png> --window-id <id>` (the ID is stable per window lifetime — cache it).
- **Color profiles:** macOS embeds the MONITOR's ICC profile in screenshot PNGs; many viewers (including image previews in tooling) misrender it dramatically — an opaque dark panel can read near-white. `capture` converts every file to sRGB via `sips`, so it's portable. Hand-rolled screencaptures should do the same: `sips -m "/System/Library/ColorSync/Profiles/sRGB Profile.icc" shot.png --out shot.png`.
- `capture`, `relaunch`, and `quit` are macOS-only (screencapture / sips / osascript). `status`/`eval`/`shot`/`theme` are cross-platform.

### relaunch / quit — the iterate loop

EM dev has **no watch** (`npm start` builds once, then runs) — every `src/` edit needs quit → rebuild → boot. `relaunch` is that loop in one command: it quits the app (real quit — `before-quit` handlers run), waits for the **full process tree to drain** (port-down alone is NOT that signal — the npm-start chain takes a few more seconds, and a test run started inside that window gets contaminated with flaky boot suites), spawns a detached `npm start` with `EM_CDP_PORT`, and waits for the boot signal. `quit` is the first half alone — safe to run `npx mgr test` the moment it returns. **Never run tests while the app is up or going down** (both rebuild `dist/`).

The boot signal defaults to the main window's document target. Apps whose boot completes later than first paint override it in `config/electron-manager.json`:

```json5
cdp: {
  readySignal: 'my-app://overlay',   // URL substring of the target that appears LAST in boot
}
```

The packaged-app process name (for quit/raise/window-id matching) comes from config too: `app.productName` (derived from `brand.name`); dev builds run under "Electron".

## Launching a controllable Chrome (not the app)

Sometimes the thing to drive is a regular **Chrome** — the marketing site, a web flow, an OAuth page — not the Electron app.

> Mirrored across the four sister frameworks (UJM / BEM / BXM / EM) — same core section, framework-flavored. Edit all four together.

```bash
open -gna "Google Chrome" --args \
  --remote-debugging-port=9223 \
  --user-data-dir="$HOME/Library/Application Support/chrome-profiles/agent" \
  --no-first-run --no-default-browser-check \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding
```

Verify it's up: `curl -s http://127.0.0.1:9223/json/version`

- **`open -gna` launches WITHOUT stealing focus.** `-g` = don't bring to foreground, `-n` = new instance (required — without it `open` just activates the already-running daily Chrome and the `--args` are ignored). Launching the Chrome binary directly ALWAYS activates the app and steals focus. Do NOT use `-j`/`--hide` — animations need a visible window; instead the three `--disable-*` flags keep timers/rAF/rendering at FULL speed while the window sits behind your work (verified: rAF at the display's native 120fps while backgrounded, focus never moved).
- **`--user-data-dir` is REQUIRED, not optional.** Chrome 136+ **silently ignores** `--remote-debugging-port` on the default profile — no error, no port, nothing (verified on Chrome 149).
- **The profile dir IS the persistent login state** — cookies/localStorage survive relaunches (verified). Log into sites once in the agent profile and every agent reuses the authenticated state. Ecosystem convention: ONE shared profile at `~/Library/Application Support/chrome-profiles/agent` across all four frameworks.
- **One Chrome instance per profile dir — but MANY agents per instance.** CDP is multi-client (verified): agents attach to the SAME port, each drives its own tab, all share the logins. A second launch with the same dir joins the existing instance and ignores the new port — attach instead. A second profile + port is only for a different IDENTITY (different account = different cookie jar) or hard isolation.
- **Quit by profile match, never by app name**: `pkill -f "chrome-profiles/agent"`.
- Port conventions: **9222** = the Electron app, **9223+** = Chrome instances. The `mgr cdp` toolkit drives either — it reads `EM_CDP_PORT` per invocation: `EM_CDP_PORT=9223 npx mgr cdp eval "example.com" 'document.title'`. For rich interaction (click/fill/network/traces) use the `chrome-devtools` MCP (`CHROME_CDP_PORT`, set BEFORE launching `claude`).
- **Navigating to a brand's UJM dev site (the local marketing site)?** It is NEVER `localhost:4000` — BrowserSync serves on the machine's local network IP over HTTPS, and the port varies (4001, …) when multiple sites run. Read the exact URL from `.temp/_config_browsersync.yml` at the root of the WEBSITE project being served (the UJM consumer — e.g. `<brand>-website/.temp/_config_browsersync.yml`, NOT this app repo).

## What CDP exposes

- **Renderer processes only** — one "page" target per BrowserWindow. Main process is NOT exposed (use `--inspect=9229` for that, which is a separate V8 inspector protocol).
- Each BrowserWindow appears as a separate page target. MCP tools with `list_pages`/`select_page` can switch between them.
- Chromium silently ignores flags it doesn't recognize, so gulp's own flags (`--cwd`, `--gulpfile`) pass through harmlessly.

## MCP setup (Claude ↔ Electron)

A `chrome-devtools-electron` MCP upstream is configured at `~/.claude/mcp-server/servers/chrome-devtools-electron.json`. It reads `EM_CDP_PORT` from the environment at spawn time (defaults to 9222), so the same upstream works for any Electron app — just set the env var.

```json
{
  "enabled": true,
  "command": "sh",
  "args": ["-c", "exec npx -y chrome-devtools-mcp@latest --browserUrl=http://127.0.0.1:${EM_CDP_PORT:-9222} --usage-statistics=false"]
}
```

This runs alongside the regular `chrome-devtools` upstream (which reads `CHROME_CDP_PORT`, defaults to 9223). Tools are namespaced:
- `chrome-devtools__take_screenshot` → Chrome browser
- `chrome-devtools-electron__take_screenshot` → Electron app

Multiple Claude sessions can debug different apps simultaneously — each terminal sets its own `EM_CDP_PORT`. See `~/.claude/mcp-server/README.md` for the full multi-instance setup.

### Available MCP tools (29)

Screenshots, click, fill, type, hover, drag, evaluate JS, list/read console messages, list/inspect network requests, navigate, resize, keyboard input, accessibility snapshots, Lighthouse audits, performance traces, heap snapshots, dialog handling.

### Session setup

If the upstream was added/enabled after a Claude session started, its tools won't appear until next session. To enable mid-session:

```
# From shell
mcp enable chrome-devtools-electron

# From inside Claude (if upstream is enabled on disk but not in session)
router__enable_upstream { name: "chrome-devtools-electron" }
```

## Port conventions

| Port | Protocol | Usage |
|------|----------|-------|
| 9222 | CDP (HTTP + WebSocket) | Electron renderer debugging (standard CDP port) |
| 9229 | V8 Inspector | Node.js / Electron main process debugging (`--inspect`) |

Use 9222 for `--remote-debugging-port` (industry standard). Avoid 9229 — that's the Node.js inspector port and a different protocol.

## Security

CDP gives full control of the renderer — any local process can connect and read/modify anything. **Never ship with `--remote-debugging-port` baked in.** It's dev-only, gated behind `EM_CDP_PORT` which is never set in production.

## How it works

`src/gulp/tasks/serve.js` collects extra args in two ways:

1. **CLI flags**: `process.argv.slice(2).filter(arg => arg.startsWith('--'))` — forwards all `--` flags from the gulp process to Electron
2. **`EM_CDP_PORT` env var**: if set and no `--remote-debugging-port` is already in the args, appends `--remote-debugging-port=${EM_CDP_PORT}`

The args are passed to `spawn(electronBin, ['.', ...extraArgs])`. The main process boot log shows the received argv:

```
[info] (main) Initializing electron-manager (main)... argv=[".","--remote-debugging-port=9222"]
```
