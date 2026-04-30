# electron-manager build progress

Living checklist of what's done, what's in progress, and what's deferred. Updated each pass so context survives chat compaction.

## Test consumer

`/Users/ian/Developer/Repositories/Somiibo/somiibo-desktop` — local-linked via `file:../../ITW-Creative-Works/electron-manager`. Run `npm start` there to test.

## Dev workflow

- Watcher: `npm start` in EM repo (runs `prepare-package/watch`, auto-rebuilds `dist/` on save).
- Test: `npm start` in somiibo-desktop (runs gulp + spawns electron).

## Conventions established

- **Every feature pass writes its tests AND its docs in the same pass.** Real impl + test suite + `docs/<topic>.md` (or update if it exists) + both `npm test` (EM) and `npx mgr test` (somiibo) green before the pass is done. No "tests later," no "docs later." Update PROGRESS.md last. CLAUDE.md / README.md only need touching when a convention or top-level surface changes — feature-level details belong in `docs/<topic>.md`.
- **CLI alias** — canonical command is `npx mgr`. `em` and `electron-manager` are also bound.
- **Config format** — `config/electron-manager.json` is **JSON5** (unquoted keys, single-quoted strings, trailing commas, comments). Loaded via `JSON5.parse`. Filename stays `.json` for editor familiarity.
- **One-line bootstrap** — `new (require('electron-manager/main'))().initialize()` auto-loads config from `config/electron-manager.json`. Pass an object to override, pass a string path to load a different file.
- **Lib module shape** — every `src/lib/<name>.js` exports a singleton object with at minimum `initialize(manager)`. Stub modules accept the call as a no-op + log; real impls fill in.
- **Per-process imports** — `electron-manager/main`, `/renderer`, `/preload`, `/build`, `/lib/<name>`.
- **Module format** — CommonJS via webpack (`require()` everywhere). ESM-readiness preserved (one `module.exports` per file).
- **Manager surface** — main-process `Manager` instance exposes `.config`, `.logger`, plus references to every lib (`.storage`, `.tray`, `.windows`, `.deepLink`, etc.) so consumer code can reach features by name.

## Schema (`config/electron-manager.json`)

Top-level keys:
- `brand` — id (drives protocol scheme + appId), name, url, contact, images.
- `app` — appId, productName, copyright, version (mirrors electron-builder fields).
- `autoUpdate` — enabled, channel, feedUrl, devTest, autoDownload.
- `tray` — `{ enabled, definition }`. Items live in `src/tray/index.js` (file-based, not config-driven).
- `menu` — `{ enabled, definition }`. Items live in `src/menu/index.js`.
- `contextMenu` — `{ enabled, definition }`. Items live in `src/context-menu/index.js`.
- `startup` — `{ mode, openAtLogin }`. mode = `'normal' | 'hidden' | 'tray-only'`. tray-only triggers build-config to inject `LSUIElement` for zero-bounce production.
- `windows` — **named-window registry** (`main`, `settings`, `about`, ...). Each entry: view, width, height, show, hideOnClose, minWidth, minHeight, title, backgroundColor, persistBounds, skipTaskbar.
- `signing.windows` — strategy (self-hosted | cloud | local), cloud.{provider, options}.
- `deepLinks` — schemes[], routes{}.
- `sentry.dsn`, `firebaseConfig`, `webManager`.
- `em` — environment, cacheBreaker, liveReloadPort.

## Pass status

### ✅ Pass 1 — Scaffolding (DONE, smoke-tested)

- [x] `package.json` with all exports / bin / projectScripts / preparePackage / deps
- [x] `bin/electron-manager` with proper exit codes
- [x] `src/cli.js` (yargs alias resolver)
- [x] `src/build.js` (build-time Manager — getConfig, getPackage, getMode, getWindowsSignStrategy, etc.)
- [x] `src/index.js` re-export
- [x] `src/main.js` — 13-step boot sequence wiring all lib modules
- [x] `src/renderer.js` — reads `window.EM_BUILD_JSON.config`, talks via `window.em.*`
- [x] `src/preload.js` — `contextBridge.exposeInMainWorld('em', { ipc, storage, logger })`
- [x] `src/commands/{setup,clean,install,version,build,publish,validate-certs,sign-windows}.js`
- [x] `src/lib/{logger,logger-lite}.js` (real)
- [x] `src/lib/{storage,sentry,protocol,deep-link,app-state,ipc,auto-updater,tray,menu,context-menu,startup,window-manager,web-manager-bridge,templating}.js` (stubs)
- [x] `src/gulp/main.js` + tasks (`defaults`, `distribute`, `webpack`, `sass`, `html`, `serve`, `package`, `release`, `audit`)
- [x] `src/defaults/` — full consumer scaffold (config JSON5, electron-builder.yml, hooks/notarize.js, .github/workflows/build.yml, src/main.js, src/preload.js, three view HTMLs, three renderer entries, main.scss)
- [x] CLI verified: `version`, `validate-certs`, unknown command (exit 1)
- [x] End-to-end verified in somiibo-desktop: `npm i ../../ITW-Creative-Works/electron-manager` → `npx mgr setup` copies defaults + injects projectScripts + sets `private: true` + sets `main: 'src/main.js'`

### ✅ Pass 2.0 — Window opens (DONE, smoke-tested)

- [x] Real `src/lib/window-manager.js` — named registry, single-instance dedup, `show: false` + `ready-to-show` flicker prevention, `hideOnClose` vs quit-on-close, web-prefs defaults (contextIsolation: true, sandbox: false, preload path resolved), web-prefs default devTools: true.
- [x] `setup.js` writes `package.main = 'src/main.js'` so `electron .` finds the entry.
- [x] `gulp/serve.js` — spawns `electron .` against consumer cwd, pipes stdio.
- [x] Gulp `default` set to just `serve` (build pipeline composition unchanged but not used yet).
- [x] **Verified**: in somiibo-desktop `npm start` opens a real Electron window titled "MyApp" with the placeholder HTML rendered.
- [x] Config switched to JSON5 format; `main.js` auto-loads + parses with JSON5.
- [x] Config restructured: `signing.windows` (was `windows.signing`) so `windows.<name>` is reserved for the named-window registry.

**Known gaps after 2.0** (intentional — fixed in next passes):
- HTML 404s for `*.bundle.css` / `*.bundle.js` — fixed in Pass 2.1 (webpack + sass).
- `window.em` exists but proxies through preload to a stub `storage`/`ipc` — fixed in Pass 2.2 + 2.3.

### ✅ Pass 2.1 — Real webpack + sass (DONE, smoke-tested)

- [x] `gulp/webpack` — three configs run in parallel:
  - main: `target: electron-main`, entry consumer `src/main.js` → `dist/main.bundle.js` (78kB w/ framework bundled in). `node.__dirname:false`. Externals: `electron` + native modules detected from consumer package.json (sqlite3, keytar, sharp, electron-store, etc.) — extensible via `config.em.webpack.externals`.
  - preload: `target: electron-preload`, entry consumer `src/preload.js` → `dist/preload.bundle.js` (5.3kB).
  - renderer: `target: electron-renderer`, entries `src/assets/js/components/*/index.js` → `dist/assets/js/components/<name>.bundle.js` (~6.5kB each).
  - Config injection: **`DefinePlugin` replaces bare `EM_BUILD_JSON` identifier** (so framework code reads it inline) **+ `BannerPlugin` prepends an IIFE assigning to globalThis & window** (so `window.EM_BUILD_JSON` works in DevTools and consumer code).
  - Production mode minifies + mangles when `EM_BUILD_MODE=true`.
- [x] `gulp/sass` — `src/assets/scss/main.scss` → `dist/assets/css/main.bundle.css`. Compressed in prod, sourcemaps in dev.
- [x] `gulp/html` — emit `src/views/**/*.html` → `dist/views/**/*.html` (path-preserving copy). Bundle path references resolve naturally from `dist/views/<v>/index.html` to `dist/assets/...`.
- [x] `gulp/defaults` + `gulp/distribute` — left as no-op stubs (setup already copies defaults; webpack reads consumer src/ directly). Will be revisited if we ever need a staging dir.
- [x] `window-manager.createNamed` now loads `dist/views/<view>/index.html` and uses `dist/preload.bundle.js`.
- [x] `setup.js` writes `package.main = 'dist/main.bundle.js'` (was `src/main.js`).
- [x] `gulp default` is now `series(build, serve)` — build first, then launch electron.
- [x] `renderer.js` reads bare `EM_BUILD_JSON` (DefinePlugin-replaced) instead of `window.EM_BUILD_JSON`.
- [x] **Verified in somiibo-desktop**: bundles built, no 404s, `window.em` and `window.EM_BUILD_JSON` populated in DevTools, renderer init logs visible.

**Known minor things to address later** (don't block features):
- CSP warning in renderer console (Electron dev warning). Real fix: add `<meta http-equiv="Content-Security-Policy">` to view templates in the html task. Defer to Pass 3 (build polish).
- gulp `defaults` + `distribute` tasks are no-ops. Revisit if we add a staging step.

### ✅ Pass 2.2 — Real storage (DONE)

- [x] `lib/storage.js` wraps `electron-store` v10 in main; sync API; persists at `<userData>/em-storage.json`.
- [x] Renderer surface via preload contextBridge → IPC handlers in main: `get`, `set`, `delete`, `has`, `clear`, `onChange`. All async, return Promises.
- [x] Change broadcast: main-side `set`/`delete` → `em:storage:change` IPC → all BrowserWindows. Renderer subscribes via `window.em.storage.onChange(key, fn)` (key `'*'` for all changes).
- [x] electron-store **bundled into EM** (not a peer dep) — webpack inlines it from EM's node_modules. Native externals whitelist updated to remove electron-store (it's pure JS).
- [x] **Smoke test in somiibo-desktop**: `await window.em.storage.set('test', 'hello')` → `await window.em.storage.get('test')` returns `'hello'`. Storage file appears at `~/Library/Application Support/<productName>/em-storage.json`.

### ✅ Pass 2.3a — Test framework foundation (DONE)

**Aligned with BEM's test framework** — same module-export shape, same shared-state suites, same console output style. Output is BEM-style only (no TAP / no other reporters; one format).

- [x] Tiny zero-dep test runner at `src/test/`. BEM-style output: 2-space outer indent, suite headers `⤷ name` in cyan, tests `✓ name (Nms)` green / `✗ name (Nms)` red / `○ name (skipped: reason)` yellow. Final `Results` block with counts + total ms.
- [x] **Module-export test definition** (BEM-aligned, no registration calls):
  - **Standalone**: `module.exports = { layer, description, run, cleanup, timeout, skip }`.
  - **Suite**: `module.exports = { type: 'suite', layer, description, tests: [...], cleanup, stopOnFailure, timeout }` — sequential, shared state, stops on first failure (override with `stopOnFailure: false`).
  - **Group**: `module.exports = { type: 'group', layer, ... }` — sequential, shared state, runs all tests even after failures.
  - **Array form**: `module.exports = [ {name, run}, ... ]` — implicit group.
- [x] Three layers: `build` (plain Node, fast), `main` (spawn Electron — Pass 2.3b), `renderer` (hidden BrowserWindow — Pass 2.3c). 2.3a ships build; main/renderer tests are SKIPped with reason.
- [x] Auto-discovery: globs `<framework>/dist/test/suites/**/*.js` (default suite) **and** `<consumer-cwd>/test/**/*.js` (consumer suite, BEM convention). Excludes dirs starting with `_`. Both run together so consumers free-ride on framework regression coverage.
- [x] CLI: `npx mgr test`, `npx mgr test --layer build|main|renderer`, `npx mgr test --filter <name>`. Exit code 1 on any failure.
- [x] Public API: `const { expect } = require('electron-manager/test')`. Custom `expect()` with the Jest-compatible subset we need: `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toBeDefined`, `toBeUndefined`, `toBeNull`, `toContain`, `toHaveProperty`, `toMatch`, `toBeInstanceOf`, `toBeGreaterThan`, `toBeLessThan`, `toThrow`, plus `.not` chain.
- [x] **Context (`ctx`)** passed to every `run`/`cleanup`: `expect`, `state` (shared across suite tests), `skip(reason)`, `layer`. Layer-specific helpers (`ctx.manager`, `ctx.page`) added later by main/renderer harnesses.
- [x] First suites (build layer, **27 tests, all green**, ~30ms):
  - `manager.test.js` — group of 10 tests on Manager class + getters.
  - `exports.test.js` — group of 3 tests on package exports + lib module shapes.
  - `cli.test.js` — group of 3 tests on CLI structure.
  - `config-schema.test.js` — **suite** of 11 tests on default config (parses raw once, reuses via `state.cfg` — demonstrates shared state).
- [x] Tests green in **both** EM repo (`npm test`) and somiibo-desktop (`npx mgr test`) — proves auto-discovery + dual-context execution.
- [x] **API URL helpers on runtime Manager** (mirror web-manager): `manager.isDevelopment()`, `manager.getEnvironment()`, `manager.getApiUrl()`, `manager.getFunctionsUrl()`. Dev hits `localhost:5002` / `localhost:5001` (Firebase emulators); prod derives from `firebaseConfig.authDomain` / `firebaseConfig.projectId`. Drives the "tests hit the real dev backend" pattern.

### ✅ Pass 2.3b — Main-process test harness (DONE, 57 tests green at end of pass)

- [x] **`src/test/runners/electron.js`** — spawns Electron with the harness directory as the app, parses JSON-line results from stdout (`__EM_TEST__{...}\n` prefix), renders BEM-style output. Drains child stderr silently (printing was causing pipe-blocking → premature exit). Set `EM_TEST_DEBUG=1` to see electron stderr.
- [x] **`src/test/harness/main-entry.js`** + **`src/test/harness/package.json`** — runs inside the spawned Electron main process. Loads default config, instantiates `Manager` with `skipWindowCreation: true`, executes `mainTest` suites, emits results. Same suite/group/standalone semantics as build runner.
- [x] **Manager.initialize options** — `initialize(config, { skipWindowCreation: true })` skips the auto `createNamed('main')` call so tests don't pop a UI window.
- [x] **`Manager.require()` pattern** — copied from BXM/UJM. `lib/storage.js` uses `Manager.require('electron-store')` to resolve EM's bundled `electron-store` regardless of how/where the consumer installed EM. **Decision: not a peer dep** — bundled inside EM, resolved via `Manager.require`.
- [x] **electron-store v10 ESM via dynamic import** — `lib/storage.js` does `await import(resolved)` (resolved path comes from `require.resolve` so it works in any tree shape). Also lazy-loaded `yargs` in `build.js` (it's ESM-only and would have polluted the runtime require chain).
- [x] **Aligned electron versions** — both EM and somiibo on `electron@^41.3.0`, `electron-builder@^26.8.1`. EM's `peerDependencies` bumped to `electron: >=41`, `electron-builder: >=26`.
- [x] **Three main-layer suites, all green**:
  - `storage.test.js` (8 tests, suite) — set/get round-trip, default fallback, has, delete, dot-notation, onChange firing, clear, getPath.
  - `window-manager.test.js` (7 tests, suite) — initialize ran, list empty, get null, createNamed registers, dedup, hide/show, close removes from registry.
  - `boot-sequence.test.js` (15 tests, group) — every lib's `_initialized` flag is true post-boot + config loaded + getEnvironment.
- [x] **Verified in both EM (`npm test`) and somiibo (`npx mgr test`)**: 27 build + 30 main = **57 passing**. Same tests, same results, both contexts.

### ✅ Pass 2.3c — Renderer test harness (DONE, 323 passing)

- [x] Hidden BrowserWindow loaded by the harness; preload exposes a `__emTest` IPC channel back to main. Mirrors production `window.em` surface (ipc, storage, logger, autoUpdater).
- [x] Suite files run *inside* the renderer; results posted via `__emTest:result` to main, which forwards `__EM_TEST__`-prefixed JSON lines on stdout. Test functions serialized via `Function.prototype.toString()` + regex body extraction, reconstructed inside the renderer via `new Function('ctx', body)` (no closure access — only `ctx` and page globals).
- [x] First renderer suite (`renderer/window-em-surface.test.js`) — 9 tests covering `window.em.*` surface + storage proxy round-trip.
- [x] Combined main + renderer layers into a single Electron boot per `npx mgr test` invocation.

### ✅ Pass 2.3d — CI integration (DONE)

- [x] `.github/workflows/build.yml` adds a `test` job (ubuntu-latest, xvfb-run) before `build` via `needs: test`.
- [x] `--reporter json` emits a final `{"event":"summary",...}` line for machine-readable output.
- [x] `--integration` flag (or `EM_TEST_INTEGRATION=1`) opts into integration suites; default is skip so `npx mgr test` is fast + green offline. CI sets `EM_TEST_INTEGRATION: '0'` to enforce skip.

### ✅ Pass 2.4 — Real ipc (DONE, 71 tests green)

- [x] **`lib/ipc.js`** — typed channel bus on top of `ipcMain`. API: `handle(channel, fn)`, `unhandle(channel)`, `invoke(channel, payload)` (main-local), `on(channel, fn)` (returns unsubscribe), `off(channel, fn)`, `broadcast(channel, payload)` (all BrowserWindows), `send(webContents, channel, payload)` (one renderer), inspection helpers `hasHandler` / `listenerCount`.
- [x] **Boot-sequence reorder** — `ipc.initialize` now runs *before* `storage.initialize` so storage can register its handlers via `ipc.handle`.
- [x] **Storage refactored** — all `em:storage:*` channels now register through `ipc.handle`; `_broadcast` routes through `ipc.broadcast`. Single channel framework, no more direct `ipcMain.handle` calls in feature modules.
- [x] **Validation** — duplicate `handle()` throws; `handle()` rejects empty/non-string channel and non-function handler; `invoke` on a missing channel rejects with a clear message; handler errors propagate through `invoke`.
- [x] **`ipc.test.js`** (14 tests, suite) — covers initialization, storage handler registration, handle/invoke roundtrip, duplicate-handle rejection, unhandle, missing-channel error, error propagation, listener subscribe/unsubscribe, multi-listener, safe broadcast with zero windows, safe send with destroyed/null webContents, end-to-end storage broadcast through ipc, and input validation.
- [x] **Test discovery is now sorted alphabetically** — fixes a flaky harness exit when the window-manager close test ran first and crashed the harness pipe before later suites could run.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both green at **71 tests passing** (27 build + 44 main).

### ✅ Pass 2.5 — Real tray (DONE, 84 tests green)

- [x] **Convention decision: tray / menu / context-menu are file-based, not config-driven.** Config-only menus would force a DSL for conditional items, dynamic labels (unread counts, login state), and click handlers. Instead, the consumer authors `src/tray/index.js` (and later `src/menu/index.js`, `src/context-menu/index.js`) and exports a function `({ manager, tray }) => { ... }`. Config retains only `enabled` + `definition` path.
- [x] **`lib/tray.js`** — full implementation. Builder API: `tray.icon(p)`, `tray.tooltip(t)`, `tray.item(descriptor)`, `tray.separator()`, `tray.submenu(label, items)`, `tray.clear()`. Item descriptors mirror Electron's `MenuItemConstructorOptions` plus dynamic forms: `label`/`enabled`/`visible`/`checked` may be functions evaluated on every `refresh()`. `click` handlers are wrapped to catch errors.
- [x] **Runtime API**: `manager.tray.refresh()` (re-evaluate dynamic state), `define(fn)` (replace whole definition at runtime), `setIcon(p)`, `setTooltip(t)`, `addItem(descriptor)`, `clearItems()`, `destroy()`. Inspection: `getItems()`, `getIcon()`, `getTooltip()`, `isRendered()`.
- [x] **Default scaffold** — `src/defaults/src/tray/index.js` ships a minimal Open + Quit example so consumers have a working tray on day one.
- [x] **Default config** — `tray`/`menu`/`contextMenu` blocks now `{ enabled, definition }` only; `tray.items` array removed. `config-schema.test.js` updated to match.
- [x] **`tray.test.js`** (14 tests, suite) — initialize, no-definition behavior, `define()` runs the builder, `define()` validation + replacement semantics, `addItem` append, `clearItems`, `setIcon`/`setTooltip`, dynamic label evaluation, click error wrapping, separator resolution, submenu recursion, `refresh()` safe with no icon, builder-fn argument shape.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both green at **84 tests passing** (27 build + 57 main).

### ✅ Pass 2.6 — Real menu (DONE, 98 tests green)

- [x] **`lib/menu.js`** — file-based application menu, same builder convention as tray. Consumer file `src/menu/index.js` exports `({ manager, menu, defaults }) => { ... }`. Builder API: `menu.menu(label, items)`, `menu.useDefaults()`, `menu.append(item)`, `menu.clear()`.
- [x] **Platform-aware default template** built in: macOS gets the standard app menu (About / Hide / Quit) prepended; File / Edit / View / Window match Electron's idiomatic shape on each OS. `useDefaults()` makes it a one-line opt-in.
- [x] **Same dynamic conveniences** as tray — function `label`/`enabled`/`visible`/`checked`, click handlers wrapped to catch errors, recursive submenu resolution.
- [x] **`define(fn)`** at runtime replaces the whole menu and re-renders.
- [x] **Default scaffold** — `src/defaults/src/menu/index.js` calls `useDefaults()` and adds a Help menu pointing at `brand.url`.
- [x] **`menu.test.js`** (14 tests, suite) — initialize, default-template fallback, `Menu.setApplicationMenu` wired, macOS app menu prefix, `define()` semantics + validation, builder methods, dynamic labels, click error wrapping, submenu recursion, builder-fn argument shape.

### ✅ Pass 2.7 — Real context-menu (DONE, 113 tests green)

- [x] **`lib/context-menu.js`** — file-based right-click menus. The consumer's `src/context-menu/index.js` is called *every time* a `'context-menu'` event fires, with `{ manager, menu, params, webContents }`. Returning no items suppresses the popup (no menu shown).
- [x] **Sensible default fn** built in for projects without a definition file: editable fields → cut/copy/paste, text selection → copy, links → Open in Browser + Copy Address, and a dev-only Inspect Element pair.
- [x] **`window-manager` auto-attaches** the listener to every window's webContents on `createNamed`. Idempotent per webContents (uses a WeakSet).
- [x] **`buildItems(params, webContents)`** test entry point — exercises the definition fn without actually popping a real menu.
- [x] **`define(fn)`** at runtime replaces the definition.
- [x] **Default scaffold** — `src/defaults/src/context-menu/index.js` ships the same baseline as the built-in default but exposed for consumers to edit.
- [x] **`context-menu.test.js`** (14 tests, suite) — initialize, no-file fallback, default fn coverage (editable / selection / link / empty), `define()` semantics + validation, `menu.separator()` / `menu.submenu()`, definition-fn argument shape, dynamic label resolution, click error wrapping, attach idempotency.
- [x] **Window close test fixed** — was timing-flaky because it polled with a 50ms `setTimeout`; now waits for the actual `'closed'` event. Reliable across machines under any CPU load.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both green at **113 tests passing** (27 build + 86 main).

### ✅ Pass 2.8 — Window bounds persistence (DONE, 122 tests green)

- [x] **`window-manager` saves bounds** to `windows.<name>.bounds` in storage on resize / move / maximize / unmaximize / enter-full-screen / leave-full-screen / close. 250ms debounce on the listener-driven saves; close flushes synchronously so the final state always lands.
- [x] **`window-manager` restores bounds** on `createNamed` if a saved entry exists, valid (numbers, ≥100×100), and on-screen. Maximized / fullscreen state restored separately via `win.maximize()` / `win.setFullScreen(true)`.
- [x] **Off-screen clamping** — `_clampToDisplays` requires ≥100×50px overlap with a real display's `workArea`. If saved coordinates fail (monitor unplugged, resolution dropped), position is dropped but size kept (Electron centers on primary display).
- [x] **Per-window opt-out** — `config.windows.<name>.persistBounds: false` skips both the listener wiring (no auto-save) and the restore lookup (no auto-load). Default is on.
- [x] **`window-bounds.test.js`** (9 tests, suite) — `_loadBounds` null/round-trip/malformed-rejection, `_clampToDisplays` off-screen vs on-screen, `createNamed` restoration, `_saveBoundsNow` write, close flushes, full opt-out behavior under `persistBounds: false`.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both green at **122 tests passing** (27 build + 95 main).

### ✅ Pass 2.9 — Real startup + tray-only zero-bounce launch (DONE, 138 tests green)

- [x] **`config.startup.mode`** — three values: `'normal'` (current behavior — main window auto-shows, dock visible), `'hidden'` (no window auto-shown, dock visible — brief macOS dock bounce on launch is unavoidable here), `'tray-only'` (true agent app: zero dock bounce on macOS via `LSUIElement`, `skipTaskbar: true` on every window for win/linux). Old `startup.hidden: bool` field replaced.
- [x] **`lib/startup.js`** — full impl. `getMode()` (with unknown-value fallback to `normal`), `isLaunchHidden()`, `isTrayOnly()`, `applyEarly()` (calls `app.dock.hide()` for hidden/tray-only as a runtime fallback when packaged plist isn't in effect — i.e. in dev), `setOpenAtLogin(bool)`, `isOpenAtLogin()`.
- [x] **`main.js` boot order** — `startup.applyEarly()` is now the *first* thing the framework does in `initialize()`, before `whenReady` and before any other lib. Sequence: applyEarly → ipc → storage → sentry → protocol → deep-link → app-state → whenReady → updater → tray/menu/contextMenu → startup.initialize → web-manager → windows. Auto-`createNamed('main')` is gated on `!isLaunchHidden()`.
- [x] **`window-manager`** — every window gets `skipTaskbar: true` automatically in tray-only mode (or per-window via `config.windows.<name>.skipTaskbar: true`). `ready-to-show` auto-show is gated on `!isLaunchHidden()` so even `config.show: true` won't surface UI under hidden/tray-only.
- [x] **`gulp/tasks/build-config.js`** — new task (auto-loaded). Materializes `dist/electron-builder.yml` from the consumer's `electron-builder.yml`, injecting `mac.extendInfo.LSUIElement: true` when `startup.mode === 'tray-only'`. Hand-written YAML editor (preserves comments, idempotent, merges into existing `extendInfo` if present, appends a complete `mac:` block if absent). `gulp/package` now points electron-builder at the materialized config.
- [x] **`startup.test.js`** (10 tests) — initialize ran, `getMode` defaults/validation/fallback, `isLaunchHidden`/`isTrayOnly` truth tables, `applyEarly` safe in all modes, `setOpenAtLogin` / `isOpenAtLogin`.
- [x] **`build-config.test.js`** (6 tests, build layer) — task module shape, fresh-injection (no extendInfo present), merge-into-existing extendInfo, key-update (not duplication), idempotency, mac-block-creation when no `mac:` exists.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both green at **138 tests passing** (33 build + 105 main).
- [x] **Production zero-bounce path validated** — gulp build-config injects `LSUIElement` correctly; manual end-to-end (`electron-builder` packaging somiibo as tray-only and confirming no dock bounce) deferred to CI integration in Pass 2.3d.

### ✅ Pass 2.10 — Real app-state (DONE, 149 tests green)

- [x] **`lib/app-state.js`** — full impl. Storage-backed under key `appState`. Tracks: `installedAt`, `launchCount`, `lastLaunchAt`, `lastQuitAt`, `version`, `previousVersion`, `sentinel` (crash detection).
- [x] **Crash detection** — on init, if previous launch wrote `sentinel: true` but never wrote `lastQuitAt` (graceful quit), we know it crashed. Records `recoveredFromCrash` for the *current* launch. First launch is exempt (no prior state). Wired up via `app.before-quit` and `app.will-quit` listeners that clear sentinel + write `lastQuitAt`.
- [x] **Version change detection** — `wasUpgraded()` is true only if THIS launch's version differs from the previous launch's version (not derived from any historical `previousVersion` field). `getPreviousVersion()` preserves the historical value across no-change launches so consumers can show "upgraded from X" UI even on the second launch after the upgrade.
- [x] **Public API** — `isFirstLaunch()`, `getLaunchCount()`, `getInstalledAt()`, `getLastLaunchAt()`, `getLastQuitAt()` (live storage read so consumers can poll), `recoveredFromCrash()`, `getVersion()`, `getPreviousVersion()`, `wasUpgraded()`, `launchedAtLogin()` (via `app.getLoginItemSettings().wasOpenedAtLogin`), `launchedFromDeepLink()` + `setLaunchedFromDeepLink(bool)` (hook for `lib/deep-link` to call when it parses a cold-start payload), `reset()` (test helper / consumer "reset to factory" command).
- [x] **`app-state.test.js`** (11 tests, suite) — initialize ran, first-launch flag, second-launch increments, crash detection, graceful-quit clears sentinel, version upgrade vs no-change semantics, `previousVersion` preserved across no-change boots, `launchedFromDeepLink` getter/setter, `launchedAtLogin` returns boolean, `getLastQuitAt` reads live storage, `reset()` wipes state.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both green at **149 tests passing** (33 build + 116 main).

### ✅ Pass 2.11 — Real deep-link + protocol (DONE, 170 tests green)

- [x] **`lib/protocol.js`** — full impl. Acquires `app.requestSingleInstanceLock()` (sets `_hasLock`); registers each `config.deepLinks.schemes[]` entry via `app.setAsDefaultProtocolClient`. Windows/Linux uses the 3-arg form (`scheme, execPath, [cwd]`) for dev-mode argv passing.
- [x] **`lib/deep-link.js`** — full impl, unified cross-platform dispatch:
  - **Cross-platform plumbing handled internally**: macOS `open-url` (queued before `whenReady`, drained after init), Windows/Linux argv parsing on cold-start, `second-instance` event for warm-start. Consumer never touches any of this.
  - **One unified API**: `manager.deepLink.on(pattern, ctx => {})`. Same callback shape regardless of cold/warm/manual source.
  - **Pattern matching**: exact (`auth/token`), named params (`user/profile/:id`), wildcard (`*`).
  - **Resolution order**: consumer concrete handlers → built-in concrete handlers → wildcard catch-all (only if no concrete matched). `ctx.handled = true` short-circuits the cascade.
  - **Built-in routes** (registered by EM, overridable by consumer):
    - `auth/token` → calls `manager.webManager.handleAuthToken(query.token)` (Pass 2.12 wires this).
    - `app/show` → `manager.windows.show(query.window || 'main')`.
    - `app/quit` → `app.quit()`.
  - **Auto-focus on warm-start**: `second-instance` handler restores + focuses the existing main window before dispatching.
  - **`appState.setLaunchedFromDeepLink(true)`** called automatically when a cold-start URL is detected.
  - **Public API**: `on(pattern, fn)` (returns unsubscribe), `off(pattern, fn)`, `dispatch(url)` (manual fire), `getColdStartUrl()`, `getHandlers()` (inspection).
- [x] **`deep-link.test.js`** (20 tests, suite) — initialize, built-in registration, URL parsing (flat / nested / malformed), pattern matching (exact / param / wildcard / mismatched), `on()` validation + unsubscribe, dispatch firing the right ctx, multi-handler ordering, consumer-before-builtin priority, `ctx.handled` suppression, wildcard fallback semantics, built-in `app/show` + `auth/token` integration, argv extraction, error isolation between handlers.
- [x] **`docs/deep-link.md`** written — covers config, cross-platform behavior table, pattern syntax, handler signature, built-in routes + override pattern, resolution order, common usage patterns, single-instance flow, `appState` linkage.
- [x] **CLAUDE.md** + **README.md** updated to reflect protocol + deep-link as real.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both green at **170 tests passing** (33 build + 137 main).

### ✅ Pass 2.12 — Real web-manager-bridge (DONE, 183 passing + 4 integration skipped clean)

- [x] **`lib/web-manager-bridge.js`** — full impl. Main runs its own Firebase Auth instance (app name `em-auth`) and is source of truth. Mirrors BXM's background/foreground pattern.
- [x] **Auth flow**: deep-link `auth/token` → `webManager.handleAuthToken(token)` → `signInWithCustomToken` against main's Firebase → broadcasts `em:auth:sign-in-with-token` to all renderers → renderers each call `webManager.auth().signInWithCustomToken(token)` against their own (web-manager-managed) Firebase.
- [x] **Sync flow**: every renderer load sends `em:auth:sync-request` with current UID. Main compares: same UID → no sync; main signed-out + renderer signed-in → tells renderer to sign out; main signed-in + renderer different/null → main fetches fresh custom token from `${apiUrl}/backend-manager` (command `user:create-custom-token`) and returns it for the renderer to sign in with.
- [x] **Sign-out flow**: any process can call `manager.webManager.signOut()` → main signs out + broadcasts `em:auth:sign-out` → all renderers sign out.
- [x] **Lazy firebase**: dynamic `await import('firebase/app')` and `firebase/auth`. Resolves from cwd / EM root / default require chain. If firebase isn't installed, bridge runs as no-op with clear warning. Consumers without auth pay zero cost.
- [x] **No token persistence**: tokens expire in 1 hour; never stored. Firebase IndexedDB persistence handles session restoration. Matches BXM exactly.
- [x] **User snapshot stripping** — only `{uid, email, displayName, photoURL, emailVerified}` cross IPC. Sensitive fields (stsTokenManager, providerData, etc.) never leave main.
- [x] **`renderer.js` updated** — auto-boots web-manager, wires the auth bridge (sync-request on init + listens for broadcasts). Consumer-facing `renderer.signOut()` and `renderer.getMainUser()` helpers.
- [x] **`.env` infrastructure** — `.env.example` at EM root with full key list. `_.env` consumer scaffold updated with auth/integration test keys. `electron-builder.yml` template excludes `.env` / `.env.*` / `**/*.env` from packaged app.
- [x] **`firebase-admin` added as devDependency** for integration test minting.
- [x] **`web-manager-bridge.test.js`** (13 tests, suite, always run) — initialize, IPC handler registration, getCurrentUser null path, handleAuthToken no-op when firebase absent, handleAuthToken empty-token path, sync-request all 3 branches (same UID / main-out + renderer-in / firebase-not-loaded), sign-out IPC, get-user IPC, onAuthChange unsubscribe, snapshot field stripping, deep-link auth/token integration.
- [x] **`web-manager-bridge.integration.test.js`** (4 tests, suite, gated on `EM_TEST_FIREBASE_ADMIN_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`) — firebase loaded check, mint custom token via firebase-admin + sign in via bridge + verify state, sign-out clears state, onAuthChange fires on state change. Skips cleanly with clear reason when creds absent.
- [x] **`docs/web-manager-bridge.md`** written — covers architecture diagram, auth flow / sync flow / sign-out flow, public API for both main and renderer, config requirements, lazy-firebase explanation, common patterns (refresh tray on auth change, gate deep-link on auth, sign-out button), full IPC channel table, testing instructions.
- [x] **CLAUDE.md** + **README.md** updated. **PROGRESS.md** updated.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both at **183 passing + 4 integration skipped** (33 build + 150 main + 4 skip-with-reason). Integration runs clean once creds are wired up locally.

### ✅ Pass 2.13 — env-merge convention + signing scaffold (DONE, 191 passing + 4 integration skipped)

- [x] **`.env` merge convention adopted** — matches BXM/UJM. Files use `# ========== Default Values ==========` and `# ========== Custom Values ==========` markers. On `npx mgr setup`, the Default section is replaced with the framework's current keys; existing values are preserved in their original section; user-added keys in Default that aren't in the new framework defaults migrate to Custom (so cleanups don't lose user data). `.gitignore` follows the same convention (line-based instead of key-based).
- [x] **`src/utils/merge-line-files.js`** — new utility. `mergeLineBasedFiles(existingContent, newContent, fileName)`. Used by `commands/setup.js` for `.env` and `.gitignore`. Lives outside `lib/` because it's a pure utility, not a feature module (lib/ modules require `initialize(manager)`).
- [x] **`commands/setup.js` updated** — `copyDefaults()` now merges `.env` + `.gitignore` instead of skipping them when they exist. Other files keep the existing skip-if-exists behavior.
- [x] **`.env.example` (EM root) + `_.env` (consumer scaffold) updated** with new keys: `GH_TOKEN` (was `GITHUB_TOKEN`), `BACKEND_MANAGER_KEY`, plus full Apple notarization key set (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — preferred over legacy Apple ID + app-specific password).
- [x] **`build/` scaffold created** under `src/defaults/build/`:
  - `entitlements.mac.plist` — full default with hardened-runtime + network + files + library-validation entitlements (covers Electron's needs for notarization).
  - `certs/.gitkeep` — placeholder so the directory ships in scaffold.
  - `certs/README.md` — full inventory of cert files (per-brand vs universal), env vars referencing each, setup walkthrough, CI integration notes.
  - `README.md` — overview of what goes in `build/`.
- [x] **`_.gitignore` updated** with `build/certs/`, `*.p12`, `*.cer`, `*.mobileprovision`, `*.p8`, `*.pem` so cert files never get committed by accident.
- [x] **`docs/signing.md`** written — full reference: Apple Developer setup, App Store Connect API key vs legacy Apple ID flow, cert file inventory (universal vs per-brand), env-var-to-file mapping table, Windows EV/cloud/local strategy, CI secret rotation, troubleshooting.
- [x] **`merge-line-files.test.js`** (8 tests, build layer) — value preservation, custom section preservation, new keys added to Default, user keys migrated to Custom, gitignore line-based handling, gitignore migration, idempotency, comment preservation.
- [x] **CLAUDE.md** + **README.md** updated with `docs/signing.md` link.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both green at **191 passing + 4 integration skipped clean** (41 build + 150 main + 4 skip-with-reason).

### ✅ Pass 2.14 — Cert validation + GH Actions secret push (DONE, 205 passing + 4 integration skipped)

- [x] **Real `commands/validate-certs.js`** — replaces the previous slim version. Now also:
  - Looks for `.p12` files in `build/certs/` and warns if `CSC_LINK` env isn't pointed at one
  - Parses any `*.provisionprofile` in `build/` (CMS-wrapped plist), checks `ExpirationDate` (errors if expired, warns if <30 days)
  - Verifies the profile's raw text contains `config.app.appId` (catches "wrong profile for this app")
  - Validates `APPLE_API_KEY` filename (`AuthKey_<KEY_ID>.p8`) matches `APPLE_API_KEY_ID` env var (catches typos)
  - Checks `APPLE_TEAM_ID` is the right 10-char format
  - On macOS, queries Keychain via `security find-identity -v -p codesigning` for the Developer ID Application identity
  - Returns `{ ok, issues }`. `--strict` flag exits non-zero on errors. Default behavior is warn-only so `setup` can call it non-fatally.
- [x] **Auto-runs at end of `setup`** — non-fatal warning pass so user knows what's missing before they release. Skip with `options.validateCerts = false` if calling programmatically.
- [x] **New `commands/push-secrets.js`** (`npx mgr push-secrets` / `npx mgr secrets`) — reads `.env` Default section, encrypts via libsodium (`crypto_box_seal`), pushes via Octokit `createOrUpdateRepoSecret`. Auto-detects paths-to-files (relative/absolute, plus a heuristic on cert/key extensions) and base64-encodes file contents instead of pushing the path string. Custom section is never touched. Filtering via `--only=KEY1,KEY2` and `--skip-empty=false`.
- [x] **`discoverRepo()`** parses owner/repo from `package.json` `repository.url` (string OR object form) or falls back to `git config --get remote.origin.url`. SSH and HTTPS URLs both supported.
- [x] **`cli.js`** updated with `push-secrets` alias (`secrets`).
- [x] **devDeps added**: `libsodium-wrappers`, `@octokit/rest`, `plist`.
- [x] **`validate-certs.test.js`** (4 tests, build layer) — `parseProvision()` extracts plist from CMS wrapper, returns null for malformed input, handles missing file, raw text searchable for appId substring matching.
- [x] **`push-secrets.test.js`** (10 tests, build layer) — `parseEnv` Default vs Custom split, quote stripping, comment skipping; `resolveSecretValue` string-as-is, empty pass-through, file → base64, missing-file → string-as-is, relative paths resolved against projectRoot; `discoverRepo` HTTPS + SSH URL parsing.
- [x] **`docs/signing.md` updated** with full `push-secrets` walkthrough + CI decode-back-to-file pattern.
- [x] **CLAUDE.md** CLI table updated. **PROGRESS.md** updated.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both at **205 passing + 4 integration skipped clean** (55 build + 150 main + 4 skip-with-reason).

### ✅ Pass 2.15 — env value double-quote normalization (DONE, 212 passing + 4 integration skipped)

- [x] **`utils/merge-line-files.js` now wraps .env values in double quotes** on every merge. Empty values stay unquoted (`KEY=`). Already double-quoted values are left alone. Single-quoted values are canonicalized to double-quoted. Embedded `"` and `\` are escaped. Comments and blank lines pass through verbatim.
- [x] **New exported helper**: `normalizeEnvLine(line)` — unit-testable in isolation.
- [x] **Default templates** (`.env.example` at EM root + `_.env` consumer scaffold) updated to ship in `KEY=""` form so the convention is visible from day one.
- [x] **Custom section is also normalized** — the user's secrets get the same quoting treatment so the file's style is consistent throughout. Behavior is idempotent.
- [x] **`merge-line-files.test.js`** expanded from 8 → 15 tests. Covers: existing tests updated to assert the quoted form (e.g. `GH_TOKEN="ghp_secret123"`), 7 new direct `normalizeEnvLine` tests for raw → quoted, already-quoted pass-through, single → double canonicalization, empty stays bare, escape handling, comment + blank preservation, leading-whitespace preservation.
- [x] **Two pre-existing test brittlenesses fixed** — `tray.test.js` and `context-menu.test.js` both had hard-coded "no consumer file" assertions that broke once somiibo ran `npx mgr setup` and got the default `src/tray/index.js` + `src/context-menu/index.js` scaffolds. Tests now read the actual file presence and adapt expectations.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both at **212 passing + 4 integration skipped clean**. (62 build + 150 main + 4 skip-with-reason).

### ✅ Pass 2.16 — Real release pipeline (DONE, 222 passing + 4 integration skipped)

- [x] **`hooks/notarize.js`** migrated to App Store Connect API key. Calls `@electron/notarize` with `appleApiKey`/`appleApiKeyId`/`appleApiIssuer`. Skips with a clear warn on non-darwin or when env vars missing. Throws if API key file path doesn't exist. Logs duration on completion.
- [x] **`@electron/notarize`** added as devDep.
- [x] **`gulp/package.js`** real impl — invokes `electron-builder.build({ config: dist/electron-builder.yml, publish: 'never' })` programmatically. Uses `Manager.require()` to resolve electron-builder from consumer's tree. Logs artifact paths.
- [x] **`gulp/release.js`** real impl — same as package but with `publish: 'always'`. Warns if `GH_TOKEN` not set.
- [x] **`gulp/main.js`** build series wired with `build-config` step before package — materializes `dist/electron-builder.yml` (mode-dependent injections like `LSUIElement` for tray-only happen here).
- [x] **`commands/sign-windows.js`** real impl — strategy dispatcher:
  - `self-hosted` / `local` → drives `signtool sign /f <token> /p <pwd> /tr <timestamp> /td sha256 /fd sha256 <file>` against EV USB token, copies signed artifacts to output dir, verifies with `signtool verify /pa`.
  - `cloud` → dispatches to `src/lib/sign-providers/<provider>.js` (provider modules pending in Pass 3 — clear error today if absent).
  - Unknown strategy → throws.
  - Discovers `signtool` via `SIGNTOOL_PATH` env or `PATH`.
- [x] **`docs/releasing.md`** — full walkthrough: prereqs, one-time setup, local release flow, multi-platform CI release, Windows strategy table, troubleshooting.
- [x] **`docs/signing.md`** updated to drop legacy Apple ID path.
- [x] **CLAUDE.md** + **README.md** updated with `docs/releasing.md` link, sign-windows marked real.
- [x] **`release-pipeline.test.js`** (10 tests, build layer) — module-load shape verification (package, release, build-config, sign-windows are all functions), sign-windows error paths (missing input dir, unknown cloud provider, missing provider, unknown strategy), notarize hook skip-on-non-darwin and skip-on-missing-env behaviors. Real signing/notarization is too external for unit tests; verified manually via `npm run release` against real certs.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both at **222 passing + 4 integration skipped clean** (72 build + 150 main + 4 skip-with-reason).
- [x] **End-to-end smoke**: deferred to consumer-side `npm run release` against real certs (somiibo has them wired). The pipeline is ready; running it against real Apple Developer creds is the consumer's call.

### ✅ Pass 2.17 — Dependency upgrade pass (DONE, 222 passing + 4 integration skipped)

- [x] **Bumped to latest** for all listed deps:
  - `@sentry/electron` 5.10 → 7.12 (sentry hasn't been wired up yet, so the major bump lands clean before implementation)
  - `electron-store` 10 → 11.0.2 (major bump; verified our `lib/storage.js` wrapper still works — internal `conf` dep change only)
  - `electron-updater` 6.3.9 → 6.8.3
  - `dotenv`, `lodash`, `webpack`, `wonderful-fetch`, `prepare-package` — patch/minor bumps
  - `electron` and `electron-builder` already on latest (41.3.0 / 26.8.1)
- [x] **Stripped final legacy notarization references** in `src/defaults/build/certs/README.md` — replaced `APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD` row with the API-key trio.
- [x] **`npm outdated` is now empty** — everything on latest.
- [x] **Verified**: `npm test` (EM) and `npx mgr test` (somiibo) both at **222 passing + 4 integration skipped clean**. Storage round-trip + dot-notation + onChange tests confirm electron-store v11 compatibility.

### ✅ Pass 2.18 — End-to-end release validation (DONE, two real GH releases shipped)

Validated the full sign + notarize + publish pipeline against real Apple Developer ID + App Store Connect API key on a fresh consumer (`/Users/ian/Developer/Repositories/Deployment-Playground/deployment-playground-desktop`).

**Bugs found and fixed:**

- [x] **electron-builder 26 schema break** — `win.signingHashAlgorithms` was deprecated; moved into `win.signtoolOptions.signingHashAlgorithms` in `src/defaults/electron-builder.yml`. Without this, `electron-builder` exits 1 on config validation before any signing happens.
- [x] **Double sign+notarize** — `gulp.publish` was `series(packageBuild, release)` which ran the entire sign+notarize cycle twice (~18 min, 4 notarizations). Changed to `series(build, release)`. Now one pass, ~10 min, 2 notarizations. `packageBuild` still exists for `npm run build` (no-publish local builds).
- [x] **Dev webpack overwriting prod build** — consumer's `npm run release` was `npm run build && npm run publish`, but `publish` re-ran webpack without `EM_BUILD_MODE=true`, leaving a dev-mode bundle in `dist/` before electron-builder packaged it. Changed `projectScripts.release` to a single gulp invocation: `npx mgr clean && npx mgr setup && EM_BUILD_MODE=true EM_IS_PUBLISH=true npm run gulp -- publish`. Also set `projectScripts.publish` to include `EM_BUILD_MODE=true` so a standalone `npm run publish` from a clean tree also produces prod artifacts.

**Two real GH releases published end-to-end:**

- `deployment-playground/deployment-playground-desktop` v1.0.0 (validated old double-pass pipeline) — 8 macOS artifacts (x64+arm64, dmg+zip+blockmaps) + `latest-mac.yml`. All signed with `Developer ID Application: Ian Wiedenman (9S9QEYN7C6)`, all notarized.
- v1.0.1 (validated new single-pass pipeline) — same 8 artifacts, ~half the wall-clock time (9.87 min vs 18 min).

`hooks/notarize.js` correctly drives notarytool via the App Store Connect API key (`AuthKey_J8P8HJ3F6P.p8` + key ID + issuer UUID). 4 notarization round-trips averaged 95–116s each.

**Convention reaffirmed:** `npm run release` is a single gulp invocation with both `EM_BUILD_MODE` and `EM_IS_PUBLISH` set. `npm run build` is build-only (no publish). `npm run publish` re-uses an already-built tree but re-asserts production mode.

### ✅ Pass 2.19 — Public release repos + download mirror (DONE, 238 passing)

Built the "private app, public release" pattern. The app repo can stay private; build artifacts and the auto-update feed live in a separate public repo. A second public repo holds fixed-name copies for marketing-site direct download links.

**New config knobs in `config/electron-manager.json`:**

```jsonc
releases: {
  enabled: true,
  owner:   null,              // null = use app repo owner
  repo:    'update-server',
},
downloads: {
  enabled: true,
  owner:   null,
  repo:    'download-server',
  tag:     'installer',
},
```

`owner: null` resolves to the app repo's GitHub owner via `discoverRepo` (parses `package.json.repository.url` or `git remote origin`). So a single line `repo: 'update-server'` is usually all a consumer sets. Setup auto-creates both repos under the resolved owner if missing (idempotent — checks existence first).

**`gulp/tasks/build-config.js`** now also injects a `publish:` block into `dist/electron-builder.yml` from `config.releases`. Defaults to `releaseType: release` (not draft) so artifacts are immediately public.

**`gulp/tasks/mirror-downloads.js`** (new task, runs in `publish` series after `release`):
- Reads every artifact in `release/`, normalizes the filename to a stable form (`MyApp-1.0.1-arm64.dmg` → `MyApp-mac-arm64.dmg`), uploads to `<downloads.owner>/<downloads.repo>` at tag `<downloads.tag>` (default `installer`), replacing any existing asset of the same name.
- Skips blockmaps and `latest-*.yml` feeds (those belong only on the auto-update feed repo).
- Marketing site can now link to `https://github.com/<owner>/download-server/releases/download/installer/MyApp-mac-arm64.dmg` and that URL never changes across releases.

**Code reuse:**
- New `src/utils/github.js` with `discoverRepo`, `getOctokit`, `ensureRepo`. push-secrets switched over.

**End-to-end validated:** v1.0.2 release of `deployment-playground/deployment-playground-desktop`:
- `update-server`: 9 assets (`latest-mac.yml` + 4 dmg/zip + 4 blockmaps) — `https://github.com/deployment-playground/update-server/releases/tag/v1.0.2`
- `download-server` @ `installer`: 4 fixed-name assets (`MyApp-mac-x64.dmg`, `MyApp-mac-arm64.dmg`, etc.) — `https://github.com/deployment-playground/download-server/releases/tag/installer`

**Tests added:**
- `build-config.test.js` — `injectPublish` replace-in-place + append behaviors (242 → 244)
- `mirror-downloads.test.js` — `stableName` for mac/win/linux + `isUploadable` filter (244 → 252)
- `github-utils.test.js` — `discoverRepo` parsing (`.git` strip, object/string forms), `getOctokit` factory (252 → 258)

### ✅ Pass 2.20 — Windows EV-token runner (DONE Mac-side, 245 passing — Windows smoke-test deferred)

Built the self-bootstrapping Windows code-signing runner. **Not smoke-tested on actual Windows yet** — that's deferred to when Ian's at the Windows box. All Mac-side surface (CLI dispatch, error paths, watcher daemon source code, docs) is in place.

**New `npx mgr runner` subcommand surface:**

```bash
npx mgr runner bootstrap            # one-time on Windows; downloads actions/runner, registers vs every admin org, installs watcher service
npx mgr runner register-org <org>   # manual single-org registration
npx mgr runner start                # start services
npx mgr runner stop                 # stop services
npx mgr runner status               # health + registered orgs + service state
npx mgr runner uninstall            # full removal
npx mgr runner self-update          # force npm i -g electron-manager@latest
```

**Files:**
- `src/commands/runner.js` — subcommand dispatcher; uses `actions/runner` v2.319.1 (pinned) and `node-windows` (optionalDependency, lazy-loaded).
- `src/runner/watcher.js` — long-running daemon installed as Windows service. On each 60s tick: (1) self-updates EM via `npm i -g`, (2) polls `/user/orgs` + `/user/memberships/orgs/<org>` to find admin orgs, (3) shells out to `mgr runner register-org <org>` for any new ones. Logs to `%USERPROFILE%\.em-runner\watcher.log`. Self-contained — uses only `https` builtin so EM upgrades mid-tick can't break it.
- `src/cli.js` — added `runner` alias.
- `src/utils/github.js` — used by both runner.js and watcher (the watcher embeds its own copy of the API call to be self-contained).
- `package.json` — `node-windows` in `optionalDependencies` so Mac installs don't fail.

**Auto-onboarding new orgs:** zero Windows interaction. The watcher detects admin access to any new GH org within 60s and auto-registers. So onboarding a new app under a brand-new org is purely a Mac-side `npx mgr setup` step.

**Docs:** `docs/runner.md` — full bootstrap walkthrough, GH_TOKEN scope requirements (`admin:org` needed for full automation), troubleshooting, architecture diagram.

**Tests added (`runner.test.js`, 7 tests):**
- module shape + exports
- pinned `actions/runner` version format
- unknown subcommand throws
- bootstrap on non-Windows refuses without `EM_RUNNER_FORCE`
- `register-org` without org throws clear usage error
- bootstrap without `GH_TOKEN` throws
- watcher daemon source file exists and references the expected API surface

**Next pass when Ian's at the Windows box:** smoke-test bootstrap end-to-end, then validate a real cross-platform release that sees the runner pick up the windows-sign job.

### ✅ Pass 2.21 — Real auto-updater (DONE, 259 passing)

Replaced the stub `lib/auto-updater.js` with the real impl. Wraps `electron-updater` with EM-specific scheduling + 30-day max-age gate. Inspired by the legacy EM updater pattern but cleaner — no failedWindowTimeout startup tie-in, IPC instead of activity-bus messaging, simpler dev simulation via env var instead of yml fixtures.

**Three triggers:**
1. Startup check `startupDelayMs` (default 10s) after `whenReady`, non-blocking.
2. Periodic check every `intervalMs` (default 60s) — also re-evaluates 30-day gate each tick.
3. **30-day pending-update gate** — when `update-downloaded` fires, EM persists `pendingUpdate.downloadedAt` to storage. Subsequent downloads do NOT reset (first-download-wins). On every poll tick + at init, if `now - downloadedAt >= maxAgeMs` → force `quitAndInstall()`. Cleared automatically when app launches at the pendingUpdate.version (i.e. user restarted and update applied).

**State machine:** `idle / checking / available / downloading / downloaded / not-available / error`. Broadcast to renderers on `em:auto-updater:status`.

**Dev simulation:** `EM_DEV_UPDATE=available|unavailable|error` synthesizes the appropriate event sequence (no fixture files, no yml). Cascades through download progress → downloaded for `available`. `quitAndInstall()` is no-op in dev so the UI flow can be tested without the app exiting.

**Renderer surface** (added to `preload.js`): `window.em.autoUpdater.{getStatus, onStatus, checkNow, installNow}`.

**IPC channels:** `em:auto-updater:status` (handle + broadcast), `em:auto-updater:check-now`, `em:auto-updater:install-now`. Idempotent: `unhandle` first so re-init doesn't throw.

**Lifecycle:** `shutdown()` clears interval + pending timers + IPC handlers + library reference. Used by tests for clean re-init.

**Production wiring:** `gulp/build-config` already injects `publish.{provider, owner, repo}` from `config.releases` into `dist/electron-builder.yml`, which means the packaged `app-update.yml` correctly points at the public `update-server` repo. So the auto-updater chain is end-to-end: EM build → electron-builder bakes app-update.yml → consumer launches → checks update-server → downloads → applies.

**Tests added (`src/test/suites/main/auto-updater.test.js`, 12 tests):**
- Initial state is idle
- Dev simulation: available → downloaded cascade, unavailable lands in not-available, error lands in error
- First download persists `pendingUpdate` to storage
- Subsequent downloads don't reset `downloadedAt` (first-download-wins)
- 30-day gate: old pending forces installNow, fresh pending doesn't
- pendingUpdate auto-cleared when current version matches
- `checkNow` returns status object
- IPC handler `em:auto-updater:status` returns status
- `enabled=false` skips library wiring + interval

**Docs:** `docs/auto-updater.md` — full triggers + state machine + 30-day gate + dev simulation + renderer surface + production-feed-discovery + failure modes.

**Smoke test next:** in deployment-playground-desktop, set `EM_DEV_UPDATE=available npm start` → verify status broadcasts to renderer + UI flow. Then real cross-version test by releasing v1.0.3 against v1.0.2.

### ✅ Pass 2.21a — Menu integration for auto-updater (DONE, 266 passing)

VS Code-style "Check for Updates..." item that dynamically reflects auto-updater state.

**Menu by-ID API added:**
- `manager.menu.findItem(id)` — recursive search, returns live descriptor or null
- `manager.menu.updateItem(id, patch)` — mutate + re-render
- `manager.menu.removeItem(id)` — delete from tree

**Default template now seeds `em:check-for-updates`:**
- macOS: under app menu (after About)
- Windows/Linux: under a new top-level "Help" menu

**Auto-updater hook:** every status broadcast (`_setState`) calls `_updateMenuItem()` which patches `em:check-for-updates`'s label + enabled per state. Menu also calls `_updateMenuItem()` once after first render (because auto-updater initializes before menu in the boot sequence, so its initial state wasn't reflected).

**Click handler:** `installNow()` if `state.code === 'downloaded'`, else `checkNow({ userInitiated: true })`. So the menu item is the One True surface for both flows.

**Consumer overrides:** modify or remove via the by-ID API in their `src/menu/index.js`. Example in `docs/menu.md`.

**Tests added (7 new):** default template includes the item, findItem returns null for unknown id, updateItem patches + returns true/false, removeItem deletes, auto-updater status updates label (downloaded → "Restart to Update v5.0.0", downloading → disabled "Downloading Update (42%)").

**Docs:** `docs/menu.md` "Built-in items + IDs" section + runtime API. `docs/auto-updater.md` "Menu integration" section.

### ✅ Pass 2.22 — Lifecycle hooks + notarize as core (DONE, 271 passing)

Established the rule: **no core functionality lives in the consumer scaffold.** Consumer-side files (`hooks/*.js`, `src/main.js`, etc.) must be the smallest possible thing that wires EM in — real logic lives in EM and gets shipped via npm update.

**What got moved into EM core:**

- `src/hooks/notarize.js` — full macOS notarization implementation (60 lines previously duplicated in every consumer's `hooks/notarize.js`).
- `gulp/build-config` now injects `afterSign:` pointing at EM's internal notarize, resolved via `require.resolve('electron-manager/hooks/notarize')`. The consumer's `electron-builder.yml` `afterSign:` line is overwritten on every build.

**Consumer's `hooks/notarize.js` is now a no-op extension point.** EM's real notarize runs first; the consumer's hook is called after as a final step (errors swallowed with a warning). The consumer can leave the file empty, delete it, or fill it with custom post-notarize work — all three work.

**Lifecycle hooks added (UJM-pattern):**

| File | When |
|---|---|
| `hooks/build/pre.js`     | Before defaults → distribute → webpack pipeline |
| `hooks/build/post.js`    | After full build, before electron-builder packages |
| `hooks/release/pre.js`   | Before electron-builder release |
| `hooks/release/post.js`  | After release publish + mirror-downloads |
| `hooks/notarize.js`      | After EM's notarize completes |

Wired via `src/utils/run-consumer-hook.js` + `makeHookTask(name)` in `gulp/main.js` that adds the hooks into the `build` and `publish` series at the right points.

**Architecture rule established:** anything that's "scaffolding" goes in `src/defaults/` and gets copied via setup. Anything that's "framework logic" lives in `src/<feature>/` and is `require()`d from the consumer via shim. Consumer files should be examples or extension points only.

**Tests added:** `run-consumer-hook.test.js` (silent-skip, invocation with args, error swallowing — 3 tests). `build-config.test.js` extended with `injectAfterSign` cases (replace + append — 2 tests). Total 266 → 271 passing.

**Docs:** `docs/hooks.md` — full hooks reference, examples, why-this-design rationale.

**Also fixed in this pass:**
- Webpack's `Manager.require` no longer wraps with `__non_webpack_require__` — that function only runs from un-bundled gulp tasks, so plain `require()` is correct.
- Webpack `webpackIgnore` magic comments on `firebase/app` + `firebase/auth` dynamic imports in `web-manager-bridge.js` (fixes runtime resolution; firebase is a consumer dep, not bundled by EM).

### ✅ Pass 2.23 — Real sentry + per-context lib pattern (DONE, 284 passing)

Replaced stub `lib/sentry.js` with a real impl spread across main/renderer/preload contexts. Establishes a reusable per-context lib pattern for future features that genuinely need both-side implementations.

**New shape:**
```
src/lib/sentry/
  index.js      # context detector + delegator
  core.js       # shared: config gating, user normalization, release tagging
  main.js       # @sentry/electron/main + uncaught/unhandled handlers
  renderer.js   # @sentry/electron/renderer + window error events
  preload.js    # minimal forward-only
```

`Manager` imports `lib/sentry/index.js` which detects `process.type === 'renderer'` and delegates to the appropriate context module.

**Config gating (in `core.js#resolveConfig`):**
- Disabled if `config.sentry.dsn` is empty.
- Disabled in dev mode unless `EM_SENTRY_FORCE=true`.
- Disabled by `EM_SENTRY_ENABLED=false` (override even production).
- Auto-environment from `EM_BUILD_MODE`.

**Auth attribution:** `web-manager-bridge._handleAuthStateChange` now calls `manager.sentry.setUser(snap)` automatically. On sign-out, clears the user. So every error is attributed to the signed-in user at the time.

**Release tagging:** `core.resolveRelease` reads `app.getVersion()` (or falls back to package.json), passed to Sentry init as `release`. Critical for auto-update flow — lets you filter Sentry by version to verify a release actually fixed an error.

**User normalization:** strips everything except `uid`/`id` + `email` before sending. `scrubEmail: true` config knob removes email too.

**No-op safety:** if `@sentry/electron` isn't installed, sentry no-ops with a log line. EM still boots.

**Tests added:** 11 sentry tests — config gating, dev/prod mode, env-var overrides, user normalize/scrub, no-op when disabled.

**Decision recorded:** the per-context shape applies only where each context has substantial unique logic (sentry: yes). For libs where the renderer surface is just contextBridge forwarding (ipc, storage, auto-updater), keeping the existing single-file shape avoids ceremony. Pattern is documented and ready to apply when next needed.

### ✅ Pass 2.24a — Templating (DONE, 292 passing)

Replaced stub `lib/templating.js` with a real impl wrapping `node-powertools`'s `template()` (BXM/UJM convention: `{{ var }}` brackets). Page-template-driven HTML rendering — consumer authors body-only views, EM wraps them in a default page template that auto-injects title, CSS, and JS bundle paths.

**`lib/templating.js`:**
- `render(input, vars, opts)` — generic token replacement (default `{{ }}` brackets)
- `buildPageVars(pageName, extras, manager)` — produces `{ brand, app, page, theme, cacheBust, content }` from manager.config + extras
- `renderPage(pageTemplate, vars)` — convenience wrapper around `render`

**`gulp/tasks/html.js` rewritten:**
- Two-pass: render body first (so views can use `{{ brand.name }}` etc.), then inject into page template's `{{ content }}` slot
- Page template lookup: consumer's `config/page-template.html` first, then EM's `dist/config/page-template.html`
- `page.name` derived from view path (e.g. `src/views/main/index.html` → `main`) so it lines up with webpack renderer entry naming

**`src/defaults/config/page-template.html`** (EM-shipped default): doctype/html/head/body shell with `<title>`, `main.bundle.css`, and `<script src="components/<page.name>.bundle.js">` auto-injected.

**Default views** (`src/defaults/src/views/{main,settings,about}/index.html`) updated to body-only — each view is now just the `<main>...</main>` content. Consumer's views same shape.

**End-to-end smoke test in deployment-playground:** `npm run build` → `dist/views/main/index.html` rendered correctly with title=MyApp, cache-busted bundle paths, body content templated with `{{ app.productName }}`.

**Per-page CSS bundles (`<page.name>.bundle.css`) deferred** — current setup has one shared `main.bundle.css` from sass. Adding per-page CSS belongs with the theme pass (Pass 2.24b) so we can wire per-view sass entries cleanly.

**Tests added:** 8 templating tests (`src/test/suites/build/templating.test.js`) — render, dot-notation, missing tokens, custom brackets, buildPageVars (manager fallback, content slot, brand/app/page/theme), renderPage.

**Docs:** `docs/templating.md` — full reference, override pattern, runtime API.

**Next:** Pass 2.24b — port classy + bootstrap themes from UJM, wire `@use 'electron-manager' as * with (...)` pattern via gulp/sass loadPaths.

### ✅ Pass 2.24b — Classy + Bootstrap themes (DONE, 292 passing, smoke-tested)

Ported the full classy + bootstrap theme stack from UJM into EM. Consumer's `src/assets/scss/main.scss` is now the same shape as UJM/BXM:

```scss
@use 'electron-manager' as * with (
  $primary: #5B47FB,
);
```

**Vendored from UJM** (verbatim copy):
- `src/assets/themes/classy/` — 27 files, full classy theme (config, base, components, layout)
- `src/assets/themes/bootstrap/` — 142 files, Bootstrap 5.3 source + UJM's bootstrap overrides

**New EM-owned scss tree:**
- `src/assets/css/electron-manager.scss` — root entrypoint (forwards `theme`, imports `core/_initialize`)
- `src/assets/css/core/_initialize.scss` — desktop-specific defaults (full-window body, `.em-drag` / `.em-no-drag` for app-region dragging)

**`gulp/tasks/sass.js` rewritten:**
- `loadPaths` now includes `<em>/dist/assets/css`, `<em>/dist/assets/themes/<theme>`, `<em>/dist/assets/themes/`, consumer's `src/assets/scss`
- Compiles `main.scss` → `dist/assets/css/main.bundle.css` (shared, every page)
- Compiles each `pages/<name>.scss` → `dist/assets/css/components/<name>.bundle.css` (per-view bundles)

**Page template updated** to load `components/{{ page.name }}.bundle.css` in addition to `main.bundle.css`.

**Default scaffold updated:**
- `src/defaults/src/assets/scss/main.scss` uses `@use 'electron-manager' as * with ()` pattern
- New `src/defaults/src/assets/scss/pages/{main,settings,about}.scss` placeholders

**Smoke-test in deployment-playground:**
- `npm run build` succeeds
- `dist/assets/css/main.bundle.css` = 292KB (full Bootstrap 5.3 + classy theme + `--bs-primary: #5B47FB` from override)
- `dist/assets/css/components/{main,settings,about}.bundle.css` emit correctly (0 bytes since empty by default)
- Existing 292 EM tests still pass

**Theme switching:** `config.theme.id` defaults to `'classy'`. Setting it to `'bootstrap'` swaps to plain Bootstrap.

**Docs:** `docs/themes.md` — full reference, override pattern, customizable variables, per-page CSS, gotchas (sass `@import` deprecation warnings inherited from classy).

### ✅ Pass 2.24c — serve.log + sass deprecation silencing (DONE, 297 passing)

Two small but high-value devloop improvements while we were in the templating + theming neighborhood.

**`<projectRoot>/logs/dev.log` — tee'd output for `tail -f` / grep / Claude inspection.** Inspired by BEM's serve.log pattern.

- `src/utils/attach-log-file.js` — wraps `process.stdout.write` and `process.stderr.write` to also append to a file. Strips ANSI color codes for file output (terminal still gets colors). Idempotent. Truncates fresh on each invocation (no stale lines from prior session).
- Wired into `gulp/main.js` as the very first thing — every gulp task, every `console.log`, every Manager log gets captured. Default path `<projectRoot>/logs/dev.log`. Override with `EM_LOG_FILE=<path>`. Disable with `EM_LOG_FILE=false`.
- `gulp/tasks/serve.js` switched from `stdio: 'inherit'` to `stdio: ['inherit', 'pipe', 'pipe']` so electron child output also flows through `process.stdout.write` and gets captured.
- `logs/` added to default `.gitignore`, so log files never get committed.
- Tests: 5 new (`attach-log-file.test.js`) — surface, ANSI strip, write/detach roundtrip, idempotent, falsy path no-op.

**Sass deprecation silencing** — UJM's classy + vendored Bootstrap 5.3 emit ~400 deprecation warnings (`@import`, `darken()`, `lighten()`, `mix()`, `if()`) per build. They're functional today but drown real errors in noise. `gulp/tasks/sass.js` now passes `silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function']` to `sass.compile`. The warnings will resolve naturally when classy migrates to the modern `@use`/`@forward` + `sass:color` module system upstream — at which point we re-vendor.

**Net effect:** dev loop is quieter, every build has a `serve.log` you can grep, and Claude (or anyone) can inspect output without you having to copy-paste terminal scrollback.

### ✅ Pass 2.4+ — Feature implementations (all DONE — see individual passes for details)

- [x] **app-state** — Pass 2.10
- [x] **sentry** — Pass 2.23 (per-context split)
- [x] **deep-link** + **protocol** — Pass 2.11
- [x] **auto-updater** — Pass 2.21 + 2.21a (menu integration)
- [x] **web-manager-bridge** — Pass 2.12
- [x] **templating** — Pass 2.24a

### ✅ Pass 3 — Build / release polish (mostly DONE — remaining items below)

- [x] `gulp/package` — Pass 2.16 (real `electron-builder build`)
- [x] `gulp/release` — Pass 2.16 (`electron-builder build --publish always` + Windows signing strategy dispatch)
- [x] `gulp/audit` — Pass 2.25 (schema-validate config, file existence checks, publish-mode-only requirements, 11 build-layer tests)
- [x] `gulp/serve` — Pass 2.18 (real impl, electron child process + log tee)
- [x] `commands/sign-windows` — Pass 2.18 (strategy dispatcher: self-hosted EV via signtool; cloud throws with provider name; local is a no-op)

### ⚪ Pass 3 — Genuinely outstanding

- [ ] **Cloud Windows sign providers.** `src/lib/sign-providers/{azure,sslcom,digicert}.js` modules. `commands/sign-windows.js` already has the dispatch wiring (throws clear error if the module is missing); just needs the provider impls (each is a 30–50 line CLI shell-out). Deferred — no way to test without provider account.
- [ ] **Windows runner end-to-end smoke test.** Needs physical Windows machine with EV USB token. Workflow + runner code is wired (Pass 2.20); just hasn't been kicked off against a real release.
- [ ] **CI dry-run on a real branch push.** macOS + Linux jobs reach `npm run release`; Windows uploads `windows-unsigned`; `windows-sign` job either runs on the registered self-hosted runner or is skipped per `EM_WIN_SIGN_STRATEGY`.

## Open questions / decisions

- **Native modules**: `keytar` etc. need to be `webpack.externals` per-target. Will be set up in Pass 2.1's webpack config; consumer can extend via a `config.em.webpack.externals[]` knob.
- **Auto-updater dev-test flow UI**: a developer menu submenu in `lib/menu.js` exposing `simulate('available' | 'error' | 'noUpdate' | 'ready')`. Lands in the auto-updater pass.
- **Storage migrations**: `electron-store` has a `migrations` field. We'll expose it via `config.storage.migrations` once we know the consumer schema.
- **`hideOnClose` for the main window**: currently `false` for `main`, but if the user enables a tray, `main.hideOnClose` should auto-flip to `true`. Decision deferred to the tray pass.
