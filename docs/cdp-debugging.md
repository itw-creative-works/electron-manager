# CDP Debugging (Claude ↔ Electron)

EM's `serve` task forwards all `--` CLI flags to the Electron child process. This enables Chrome DevTools Protocol (CDP) debugging, which lets Claude (or any CDP client) interact with the running Electron app — take screenshots, click elements, type text, evaluate JS, read console logs, inspect network requests, etc.

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
