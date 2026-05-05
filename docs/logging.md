# Logging

EM ships a runtime logger that writes to **both the console and a file on disk**, so production issues are inspectable without remoting into the user's machine.

## What you get

- **One log file**, `runtime.log`, populated by all three Electron processes (main / preload / renderer)
- **Live console output** during development (DevTools console for renderer, terminal stdout for main)
- **Automatic rotation** at 10 MB → `runtime.old.log`
- **Cross-process timestamps** so log lines from main + preload + renderer interleave in arrival order

## Where the file lives

| Mode | Location |
|---|---|
| Dev (`npm start`, `app.isPackaged === false`) | `<projectRoot>/logs/runtime.log` |
| Prod (installed `.dmg` / `.exe` / `.deb`, `app.isPackaged === true`) | OS log dir: `~/Library/Logs/<AppName>/runtime.log` (macOS), `%APPDATA%\<AppName>\logs\runtime.log` (Windows), `~/.config/<AppName>/logs/runtime.log` (Linux) |

This is `app.getPath('logs')` in production — Electron's standard logs location, the same place users (and crash reports) look for app logs.

## How to write logs

In **main process** (uses the same `manager.logger` you've always had):

```js
const Manager = require('electron-manager/main');
const manager = new Manager();
await manager.initialize();

manager.logger.log('booted');
manager.logger.warn('connection slow');
manager.logger.error(new Error('boom'));
```

In **preload**:

```js
const Manager = require('electron-manager/preload');
const manager = new Manager();
await manager.initialize();
manager.logger.log('preload ready');
```

In **renderer** (use the contextBridge surface, which forwards to main → file):

```js
window.em.logger.log('user clicked Save');
window.em.logger.warn('IPC slow');
window.em.logger.error(new Error('ui blew up'));
```

All three end up in the same `runtime.log`, prefixed with their scope (`main`, `preload`, `renderer`):

```
[2026-05-05 14:32:11.045] [info] main manager.initialize
[2026-05-05 14:32:11.122] [info] main ipc ready
[2026-05-05 14:32:11.187] [info] preload contextBridge exposed
[2026-05-05 14:32:11.401] [info] renderer auth.listen attached
[2026-05-05 14:32:12.998] [warn] main auto-updater check failed: network
```

Grep one context with:

```bash
grep ' main ' logs/runtime.log
```

## CLI: `npx mgr logs`

For dev-loop convenience. From the consumer project root:

| Command | Effect |
|---|---|
| `npx mgr logs` | Print path, then `tail -50` of the file |
| `npx mgr logs --tail` (or `-f`) | Follow mode (like `tail -f`). Ctrl+C to stop. Cross-platform. |
| `npx mgr logs --path` (or `-p`) | Print the resolved path only (pipe-friendly) |
| `npx mgr logs --open` | Open the log file in OS default editor |
| `npx mgr logs --lines=100` | Default mode with custom tail length |

`mgr logs` only resolves the dev path (`<cwd>/logs/runtime.log`). To find the production log on a user's machine, use the table above or call `getLogFilePath()` from app code.

## How to find the file path from app code

```js
const LoggerLite = require('electron-manager/lib/logger-lite');
const filePath = LoggerLite.getLogFilePath();
// → '/Users/<user>/Library/Logs/MyApp/runtime.log' in production
```

Useful for:
- "Send us your log" buttons in your settings UI
- Programmatic log shipping (e.g. POSTing the file to your support backend)
- Crash reporters that want to attach the runtime log

## Log levels

Standard: `log`, `info`, `warn`, `error`, `debug`. All levels are written to both transports by default.

To dial down via env vars (useful in CI to silence verbose framework noise):

| Var | Effect |
|---|---|
| `EM_LOG_LEVEL_FILE=warn` | Only `warn` + `error` reach the file |
| `EM_LOG_LEVEL_CONSOLE=error` | Only `error` reaches stdout/stderr |

Default is `silly` (everything) on both.

## How it works under the hood

EM's runtime logger (`lib/logger-lite.js`) detects which process it's in:

- **Main**: writes to `runtime.log` directly via [electron-log](https://github.com/megahertz/electron-log)'s file transport. Sets up an IPC listener on channel `em:log:forward` to receive forwarded calls from preload + renderer.
- **Preload**: writes to console (DevTools) AND forwards each call via `ipcRenderer.send('em:log:forward', ...)` to main.
- **Renderer**: same as preload via `window.em.logger` (contextBridge surface).
- **Outside Electron** (build/CLI tools that happen to require this module): falls back to console-only.

File path resolution in main:
1. Read `app.isPackaged`.
2. If packaged → `app.getPath('logs')`.
3. If dev → `<cwd>/logs/`.
4. `mkdirSync` the dir, point electron-log at `<dir>/runtime.log`.

The transport is set up lazily on first `log()` call, so importing `LoggerLite` in build/CLI contexts that have no Electron is harmless.

## Coexisting with `dev.log` and `build.log`

Three separate logs in `<projectRoot>/logs/`:

| File | Source | Lifetime |
|---|---|---|
| `runtime.log` | Packaged-app runtime in dev mode | Persistent (rotates at 10 MB) |
| `dev.log` | Gulp pipeline + spawned Electron child stdout | Truncated each `npm start` |
| `build.log` | GH Actions release run output (streamed locally during `npm run release`) | Truncated each release run |

They serve different purposes and don't overlap — `dev.log` shows you "is webpack still bundling?", `runtime.log` shows you "is my app's auto-updater finding the right release feed?". Both useful.

In production: only `runtime.log` exists (no project, no gulp, no GH Actions stream).
