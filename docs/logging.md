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

## What EM logs automatically

Beyond what you write yourself, EM emits a fixed set of high-signal lifecycle lines so post-mortem debugging works without redeploying:

**At boot (`manager.initialize()`):**

```
(main)     Initializing electron-manager (main)... pid=12345 platform=darwin arch=arm64 packaged=true argv=["--em-launched-at-login"]
(startup)  startup boot summary — RAW inputs:
(startup)    process.argv:            ["--em-launched-at-login"]
(startup)    process.platform:        darwin
(startup)    process.arch:            arm64
(startup)    app.isPackaged:          true
(startup)    app.getLoginItemSettings(): {"status":"enabled","openAtLogin":true,"openAsHidden":false,"restoreState":false,"wasOpenedAtLogin":false,"wasOpenedAsHidden":false}
(startup)    EM_/electron/node env:   {}
(startup)  startup boot summary — RESOLVED values:
(startup)    config.startup.mode:     normal
(startup)    config.startup.openAtLogin: {enabled:true, mode:hidden}
(startup)    isDev:                   false
(startup)    hasLoginArg:             true
(startup)    wasLaunchedAtLogin():    true (via argv-flag)
(startup)    isLaunchHidden():        true
```

The boot summary has two parallel blocks: **RAW inputs** (what the OS / shell gave us) and **RESOLVED values** (what EM decided to act on). Use it to debug both directions:
- "Why is EM behaving like X?" → check resolved values
- "Why did EM decide X?" → check raw inputs

The `via:` annotation on `wasLaunchedAtLogin()` distinguishes a real login launch (`via:macos-wasOpenedAtLogin`) from a flag-based simulation (`via:argv-flag` — i.e. the user passed `--em-launched-at-login`).

**App lifecycle events** (logged from `main.js`):

```
app event: before-quit (entering quit sequence — close events bypass hide-on-close)
app event: will-quit
app event: quit code=0
app event: window-all-closed
app event: activate (macOS — dock click or app re-launch)
app event: open-url url=myapp://auth/token?...
app event: render-process-gone reason=crashed exitCode=139
app event: child-process-gone type=GPU reason=killed exitCode=9
process exit code=0
uncaughtException: <stack>
unhandledRejection: <stack>
```

**Window lifecycle events** (per named window, logged from `window-manager`):

```
createNamed: building "main" (show=false, hideOnClose=true)
createNamed: loaded /path/to/app.asar/dist/views/main/index.html for "main"
window "main": ready-to-show — staying invisible (show:false at create)
window "main": ready-to-show — surfacing
window "main": show event
window "main": hide event
window "main": focus event
window "main": minimize event
window "main": restore event
window "main": close intercepted (hide-on-close) — hiding instead
window "main": close allowed (hideOnClose=true, allowQuit=false, isQuitting=true, force=false)
window "main": closed (destroyed)
```

**Re-surface handlers**:

```
activate (macOS) — surfacing main (visible=false, minimized=false)
_ensureDockVisible — calling dock.show()
_ensureDockVisible — dock already visible
second-instance — argv=["..."] cwd=/...
second-instance — surfacing main (visible=false, minimized=false)
```

These cover everything you'd want when debugging "why did the app go invisible / crash / fail to surface" without needing to attach a debugger.

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
