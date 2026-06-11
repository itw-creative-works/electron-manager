# Boot Sequence

`manager.initialize()` runs in the main process in a fixed order. Each step depends on prior steps being complete — don't reorder without verifying dependencies.

## Order

1. **`startup.applyEarly()`** — first thing, before `whenReady`. Calls `app.dock.hide()` for `mode: 'hidden'` (zero-bounce production via `LSUIElement` baked at build time).
1b. **userData path isolation** — appends an environment suffix to `app.getPath('userData')` so each environment's session data, logs, and `electron-store` files stay separate on the same machine: production untouched, development gets ` (Development)`, testing (`EM_TEST_MODE=true`) gets ` (Testing)`. The testing dir is **wiped at boot** so every test run starts from a clean slate (post-run state stays on disk for inspection until the next run; set `EM_TEST_KEEP_USERDATA=1` to skip the wipe). **Must run before `storage.initialize()`** (which constructs `electron-store` against the path).
1c. **Global user-agent fallback** — sets `app.userAgentFallback` to a branded template via `node-powertools.template`. Default per-platform templates: `Mozilla/5.0 (... <platform-specific> ...) AppleWebKit/537.36 (KHTML, like Gecko) {brand.name}/{app.version} Chrome/{chrome} Safari/537.36`. Merge tags resolve from `{ brand: { name, id }, app: { version }, chrome, electron, node, platform, arch }`. Every BrowserWindow load + electron-updater fetch + node-fetch via the renderer carries the branded UA. Consumers can override post-init by re-setting `app.userAgentFallback` from their main.js.
2. **`app.on('before-quit')`** wired — sets `manager._isQuitting = true` so any quit path (Cmd+Q, role:'quit' menu, programmatic `app.quit()`, OS shutdown) bypasses the window-manager's hide-on-close trap.
3. **`ipc`** — typed channel bus online before any feature can register handlers.
4. **`storage`** — async (electron-store v11 ESM via `webpackIgnore`'d dynamic import). Other libs depend on this.
5. **`sentry`** — earliest catchable global handler.
6. **`protocol`** — single-instance lock + custom scheme register.
7. **`deepLink`** — argv parse for cold-start, second-instance handler.
8. **`appState`** — first-launch / launch-count / crash-sentinel / version-change.
9. `await app.whenReady()`.
10. **`autoUpdater`** — electron-updater, never blocks.
11. **`tray`**, **`menu`**, **`contextMenu`** — file-based definitions from `src/integrations/{tray,menu,context-menu}/index.js`. Disable any of them at runtime via `manager.<name>.disable()` (no config flag).
12. **`startup.initialize`** — applies `setLoginItemSettings`.
13. **`webManager`** — relay renderer auth state.
13b. **`remoteConfig`** — hot config from `<brand.url>/data/resources/main.json`. Non-blocking fire-and-forget fetch.
13c. **`remoteScripts`** — emergency remote code execution from `<brand.url>/data/scripts/main.js`. Non-blocking. Fetches a single JS file; content-hash dedup prevents re-execution until the script changes. Full main-process access.
13d. **`analytics`** — GA4 Measurement Protocol. Wired AFTER webManager so it can subscribe to `onAuthChange`.
13e. **`restartManager`** — auxiliary helper app for relaunches.
14. **`windows.initialize`** — registers app-level handlers: `window-all-closed` → quit on win/linux; `app.on('activate')` on macOS to surface `main` when the user double-clicks the dock icon (CleanMyMac-style). **Does NOT auto-create any window.** The consumer's main.js calls `manager.windows.create('main', { show: !startup.isLaunchHidden() })` from inside `manager.initialize().then(() => { ... })`. The `main` window is *always* created (so it's in the registry for the activate/second-instance handlers to find), but `show: false` keeps it invisible in hidden launches — tray icon shows immediately, dock icon + window appear only when something explicitly calls `windows.show('main')` (or the user double-clicks the running app).

## Why this order

- userData path append before storage init: otherwise dev and prod stores share the same path.
- before-quit before window-manager: so window-manager's close-trap can read `_isQuitting`.
- IPC before any other lib: every lib registers its own IPC handlers.
- Storage before sentry: sentry persists scope data.
- protocol/deepLink before whenReady: argv parsing for cold-start deep links must beat first window creation.
- whenReady gate is where Electron's app APIs become safe.
- autoUpdater after whenReady but never blocks boot.
- File-based integrations (tray/menu/context-menu) after everything that wires their click handlers (e.g. autoUpdater patches the check-for-updates menu item).
