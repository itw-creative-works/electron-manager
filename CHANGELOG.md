# CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## Changelog Categories

- `BREAKING` for breaking changes.
- `Added` for new features.
- `Changed` for changes in existing functionality.
- `Deprecated` for soon-to-be removed features.
- `Removed` for now removed features.
- `Fixed` for any bug fixes.
- `Security` in case of vulnerabilities.

---
## 1.8.3 — runtime.log truncates on boot

### Changed
- **`runtime.log` now truncates on every boot**, matching `dev.log`, `build.log`, `test.log`, and `ci.log`. Every `Manager.initialize()` call clears the file before the first log write so each session starts fresh.

---
## 1.8.2 — Fix EPIPE cascade and signing log path

### Fixed
- **EPIPE cascade in `uncaughtException` handler.** When stdout's pipe was broken (CLI consumer hung up), the handler re-logged the error via the console transport, triggering another EPIPE in an infinite loop — filling `runtime.log` to its 10MB rotation limit with thousands of identical stack traces in under a second. Now detects EPIPE and exits cleanly with code 0 (standard Unix behavior).
- **Signing log landing in project root.** The local dev fallback for `sign-events.js` wrote `em-signing.log` to `process.cwd()` instead of `logs/`. Now writes to `logs/signing.log`, matching `dev.log`, `build.log`, `test.log`, and `ci.log`. CI paths (`EM_RUNNER_HOME`, `RUNNER_TOOLSDIRECTORY`, etc.) unchanged.

### Added
- Main-layer test for the EPIPE handler (`src/test/suites/main/epipe-handler.test.js`).

---
## 1.8.1 — `electron-store` no longer a peer dep

### Added
- **`src/utils/import-esm.js` — reusable ESM-only dep loader.** Tries the consumer's `node_modules/` first, then falls back to EM's own `node_modules/`. Use `importESM(specifier)` in any EM lib that needs an ESM-only transitive dep — consumers no longer need to install it. Documented in `docs/common-mistakes.md` (item 16) and `CLAUDE.md` (File Conventions).

### Changed
- **`electron-store` is no longer a peer dependency.** It stays in EM's `dependencies` and is resolved at runtime via the new `importESM()` fallback — consumers no longer need to `npm install electron-store`. The webpack external for `electron-store` was also removed (unnecessary since the only import is a `webpackIgnore`'d dynamic `import()`).

---
## 1.8.0 — `npx mgr cdp` toolkit, system-aware `manager.theme`, test-mode stealth windows

### Fixed
- **Empty-string signing env placeholders no longer break packaging.** The consumer `.env` template ships `CSC_LINK=""` (and friends) as placeholders; dotenv injects them as set-but-empty, and app-builder-lib only null-checks — `importCertificate('')` resolves `''` to the **project root** and every `package`/`package:quick`/`release` died with `"<projectRoot> not a file"` on machines without certs wired. New `src/utils/sanitize-signing-env.js` (called right after the gulp `.env` load) deletes empty/whitespace `CSC_*` / `WIN_CSC_*` / `APPLE_*` vars so electron-builder's own auto-discovery/skip logic applies; real values are never touched. Build-layer suite + a note in `docs/signing.md`.

### BREAKING
- **`theme.appearance: 'auto'` is renamed `'system'`** (matching `nativeTheme.themeSource`), and the config default changed from `'auto'` (inert — nothing ever resolved it) to `'system'` (live OS-follow). Configs setting `'light'`/`'dark'` behave as before — now enforced at runtime by the applier rather than only stamped at build. Configs still saying `'auto'` fall back to `'system'` at runtime but fail the new schema enum at build — rename the value.

### Added
- **`npx mgr cdp` — a CDP toolkit for driving the running dev app.** Zero-dependency subcommands that see, act, and iterate against the live app over `EM_CDP_PORT`: `status` (targets/window/theme), `eval <match> '<expr>'` (run JS in ANY webContents — BrowserWindow or WebContentsView, matched by URL substring; promises awaited, JSON out, user gesture), `shot` (one renderer's own pixels), `capture` (the COMPOSITED window via screencapture, sRGB-normalized — macOS embeds the monitor's ICC profile and many viewers misrender it; `--window-id` for occlusion-proof captures), `theme <dark|light|system>` (live flip via `manager.theme`), `relaunch` (quit → `npm start` → wait for boot — EM dev has no watch, this is the iterate loop), and `quit` (waits for the full process tree to drain so `npx mgr test` is safe the moment it returns). Config-aware: packaged-app process names from `app.productName`; a new `cdp.readySignal` schema key overrides the relaunch boot signal for apps whose boot completes later than first paint (e.g. an overlay view created last). Born and validated in the Somiibo glass rework, upstreamed so every consumer gets it. Build-layer tests (target matching, config resolvers, dispatch); full reference in `docs/cdp-debugging.md`.
- **`docs/cdp-debugging.md`: "Launching a controllable Chrome" section (mirrored across UJM/BEM/BXM/EM).** The canonical Chrome launch (CDP port + REQUIRED dedicated `--user-data-dir` — Chrome 136+ silently ignores the debug port on the default profile, verified on 149) + the persistent agent profile (`~/Library/Application Support/chrome-profiles/agent`, one-time logins; CDP is multi-client — agents share the one logged-in instance, one tab each) for driving regular web flows; `mgr cdp` drives Chrome too via per-invocation `EM_CDP_PORT`.
- **System-aware dynamic theme: `manager.theme`.** EM now owns appearance at runtime instead of stamping `data-bs-theme` once at build. New `lib/theme.js` rides Electron's `nativeTheme.themeSource` — `'system'` (the new default) **follows the OS preference live**, `'light'`/`'dark'` are explicit overrides, and a user's runtime choice (`manager.theme.set(...)`) persists in storage and wins over the config default on every boot. Propagation needs no IPC fan-out: setting `themeSource` flips `prefers-color-scheme` in **every renderer — BrowserWindows AND embedded WebContentsViews** — and the preload's new theme applier rewrites `<html data-bs-theme>` to the resolved value live (opt-in by presence: pages without the attribute, e.g. external sites in a consumer's web views, are never touched). Surfaces: main `manager.theme.{get,set,resolved,onChange}` + `em:theme:{get,set}` IPC + `em:theme:changed` broadcast; renderer `window.em.theme.{get,set,onChange}` (matchMedia-powered) + declarative `[data-em-theme-set="system|light|dark"]` controls wired by the renderer Manager. Tests at main (9), renderer (7), boot (2, live-flip on the real bundle) layers; documented in `docs/themes.md` (new Appearance section), `docs/boot-sequence.md`, `docs/css.md`, `docs/templating.md`, config schema entry for `theme.appearance`. The scaffolded consumer config (`npx mgr setup`) now declares the default explicitly — `theme: { appearance: 'system' }`.
- **`config.windows.<name>.trafficLightPosition` (macOS).** Inset-titlebar windows can now reposition the native traffic lights via `{ x, y }` — for apps whose chrome floats inside the window (e.g. a glass chrome panel with margins) and the lights should sit inside that panel instead of the OS default corner inset. Passed through to the BrowserWindow only in `'inset'` mode on mac; covered by a `getWindowButtonPosition()` round-trip test in `window-manager.test.js`; documented in `docs/windows.md` (per-window keys + inset-titlebar section).
- **Test runs no longer interrupt you: stealth window surfacing in Testing mode.** Under `npx mgr test`, every window-manager surfacing path (`ready-to-show`, `windows.show()`, the create-dedup focus) now surfaces windows **invisibly**: `showInactive()` so keyboard focus never leaves your editor, `setOpacity(0)`, and `setIgnoreMouseEvents(true)` so a stray real click physically can't land in the app (synthetic test input — `executeJavaScript`, `sendInputEvent` — is unaffected), with no `win.focus()`/dock surfacing. Deliberately NOT `hide()`/`minimize()`: occluded windows get throttled by Chromium (rAF pauses, `document.visibilityState` flips to `hidden`) — tests would exercise a different runtime, whereas an opacity-0 shown-inactive window renders and behaves identically to a visible one (proven by a 322-test consumer boot suite running green through invisible windows, including focus/selection/drag assertions). Set **`EM_TEST_SHOW=1`** to surface windows normally and watch a run live. New stealth assertions in `window-manager.test.js`; documented in `docs/test-framework.md` + `docs/windows.md`. **App-level activation is suppressed too (macOS):** window flags can't stop macOS from activating a freshly *launched* app — the menu bar + keyboard focus switched to each spawned test process (harness, boot-layer consumer app) even with every window inactive, yanking focus from your editor mid-typing. Under the same stealth predicate (new SSOT `src/utils/test-stealth.js`, shared by `_isStealth()`), `main.js` (step 1a, pre-ready) and the test harness flip the app to the **accessory activation policy** (`app.dock.hide()` — the `LSUIElement` switch): test processes never activate, never show a dock icon, never steal focus; windows still render identically. The in-suite `EM_TEST_SHOW=1` probe was also de-fanged (`focusable: false` + non-activating `setActivationPolicy('regular')` instead of the activating `dock.show()`). Verified by frontmost-app sampling across full runs: **zero focus changes, down from four steals per run**. Tests at build (`test-stealth.test.js` predicate table), main (dock-hidden assertion), and boot (real consumer bundle) layers.
- **Stealth now covers RAW BrowserWindows too.** The stealth-surfacing recipe moved to a shared util (`src/utils/stealth-window.js` — opacity 0, click-through, `show()` rerouted to `showInactive()`, `focus()` no-op'd) and `main.js` registers a global `browser-window-created` hook (step 1a-ii, Testing mode only) that applies it to **every** window — including ones created with `new BrowserWindow()` outside window-manager (e.g. a consumer's automation popup), which previously surfaced visible and could steal focus mid-run. `window-manager._surface()` now consumes the same util (SSOT). The stealth predicate is evaluated per window, so `EM_TEST_SHOW=1` still opts a run back into visible windows even when flipped mid-process. New `suites/main/stealth-window.test.js`; documented in `docs/test-framework.md` + `docs/windows.md`.
- **The main-layer test harness exposes a CDP endpoint.** `test/harness/main-entry.js` appends `--remote-debugging-port=0` at require time (loopback-only, OS-assigned) and publishes the resolved port as `process.env.EM_CDP_PORT` before suites run — read from Chromium's `DevToolsActivePort` file in the require-time userData dir (captured before the Manager re-paths userData), overwriting any value inherited from the shell (that one points at a dev app, not the harness). Consumer suites can now drive real browser automation against the harness Electron itself (e.g. `playwright-core` `connectOverCDP`). New `suites/main/harness-cdp.test.js`; documented in `docs/test-framework.md`.

### Fixed
- **Remote-config / remote-scripts fetch failures no longer dump entire HTML pages into the logs.** wonderful-fetch puts the full response body in `error.message` — when the brand site lacks `/data/resources/main.json` or `/data/scripts/main.js`, that's the site's whole HTML 404 page (~26KB, starting `<!doctype html><html aria-busy=true …`) spammed to the console + `runtime.log` on every boot and hourly poll. New shared `src/utils/format-fetch-error.js` flattens fetch errors to one log-safe line — HTTP status prefix, HTML bodies named instead of printed (`HTTP 404: response was an HTML page, not the expected resource`), whitespace collapsed, 200-char cap — applied to all four fetch-failure warnings (initial + periodic in both libs). Validated against a live UJM-site 404. Build-layer suite `format-fetch-error.test.js` (9 tests); failure-mode notes in `docs/remote-config.md` + `docs/remote-scripts.md`.
- **Test discovery now excludes `_`-prefixed directories at ANY depth.** The discovery globs ignored only top-level `_` entries (`['_**']`), so files nested under an underscore directory — e.g. a consumer's `test/_fixtures/packages/x/index.js` fixture tree — were picked up as suites and failed with "not a valid suite". Both discovery globs (framework + consumer) now share the exported `DISCOVERY_IGNORE = ['**/_*.js', '**/_*/**']` (runner.js), matching the documented convention: `_`-prefixed files AND everything under `_`-prefixed directories are skipped. New build-layer self-test (`test-discovery.test.js`) proves the pattern against a real temp tree; `docs/test-framework.md` → Test discovery documents the convention.

---
## 1.7.1 — Audit check catalog, IPC zero-trust payload rules, npm keywords

### Added
- **`docs/audit.md` — full-audit check catalog (`/omega:em audit`) + `docs/ipc.md` "Zero-trust payloads" section.** The audit doc carries ID'd, severity-graded checks with scope auto-detect (consumer vs framework via package.json): mirrored universal checks (U-01..U-14 — tests at every layer, renderer XSS escaping, secrets/certs, schema-validated config canon, doc parity, dead code, dep health, …), EM-specific checks (EM-01..EM-08 — `sanitize-url.js` gating on dynamic URLs, `app.getAppPath()` over `process.cwd()`, awaited `windows.create()` + always-create `main`, zero-trust IPC payloads, icon conventions, file-based integrations, presence-driven flags, renderer a11y), and framework-repo checks (F-01..F-04). Findings persist to `.temp/audit/claude-audit.md`; fixes run as a severity-ordered TodoWrite loop ending with a green `npx mgr test`. `docs/ipc.md` gains the payload-content rules EM-04 enforces (validate shape/values before acting, sanitize IPC-delivered URLs, never feed raw payloads into fs paths/shell/`executeJavaScript`) — payload content was previously undocumented (only channel registration was). Wired to the `omega:em` router's Audit process; `docs/audit.md` is mirrored across UJM/BEM/BXM. Indexed in CLAUDE.md.

### Changed
- **package.json `keywords` improved** — added the discovery terms `desktop-app`, `cross-platform`, `auto-update`, `sass` and dropped the generic `framework` (now: `electron`, `desktop-app`, `cross-platform`, `electron-builder`, `electron-updater`, `auto-update`, `gulp`, `sass`, `webpack`). npm-listing metadata only; no behavior change. Mirrored across UJM/BEM/BXM.

---
## 1.7.0 — Boot-layer self-test, test targeting + extended mode, log parity

### Added
- **Dev-process guidance relaxed: only `npm start` is off-limits.** The "NEVER run" rule in CLAUDE.md now prohibits only the long-running dev process (instruct the user to start it if it isn't running; read `logs/*.log`, never tail/attach) — `npx mgr test` is fine to run. CLAUDE.md also names the **designated test consumer** — `../../Deployment-Playground/deployment-playground-desktop` — as the consumer for validating framework changes end-to-end.
- **`docs/lib-modules.md`**: lib authoring guide migrated from the `omega:em` skill into the repo — the lib initialization contract (singleton + `initialize(manager)` + idempotent `disable()`), the adding-a-new-lib checklist, and the flat-file-vs-directory-split convention. Indexed in CLAUDE.md (Architecture → Lib modules + Documentation). Part of the skills-as-routers refactor: framework facts live in repo docs (version-matched via `node_modules`); the skill now only routes + carries Claude-workflow rules and process checklists.
- **`docs/config-schema.md` — presence-driven feature flags section**: documents the BEM-convention credential-presence flags (sentry/analytics/firebaseConfig) and the explicit-`enabled` exceptions that toggle behavior rather than credentials (`remoteConfig`/`autoUpdate`/`releases`/`downloads`/`restartManager`/`openAtLogin`/`snap`). Also fixed the conditional-`required` example, which referenced a nonexistent `analytics.enabled` flag.
- **Boot-layer framework self-test (bundled fixture + `EM_TEST_BOOT_PROJECT`)**: `npx mgr test` run from the electron-manager repo now boots a committed minimal consumer fixture (`src/test/fixtures/consumer-app/`) — webpack-built into a real `dist/main.bundle.js` and booted headlessly — and runs the `src/test/suites/boot/` smoke (manager init + all core libs, main window created from the fixture `main.js`, built view loaded, real bundle on disk). The boot runner resolves `EM_TEST_BOOT_PROJECT` (auto-set when EM self-tests; set explicitly to boot a real consumer like `deployment-playground-desktop` without `cd`), symlinks the fixture's `electron-manager` + `electron` deps at runtime — created per run and **removed after** (a leftover repo-root link inside `dist/` forms an infinite directory cycle that crashes the next prepare-package walk / `npm publish` with `ENAMETOOLONG`; the fixture `.gitignore` covers crashed runs) — and otherwise resolves via the upward `node_modules` walk. Complements the existing `isFrameworkSelfTest` gate that excludes framework `boot/**` from consumer runs. Brings EM into parity with BEM's `BEM_TEST_BOOT_PROJECT`, BXM's `BXM_TEST_BOOT_PROJECT`, and UJM's `UJ_TEST_BOOT_PROJECT`. Documented in `docs/test-boot-layer.md` (new "Self-test from the framework repo" section).
- **Docs parity — new `docs/css.md` + `docs/common-mistakes.md`**: `css.md` documents the SCSS architecture (main entry, theme `@use` config, per-window bundles, Bootstrap-first convention — fills the gap vs BXM/UJM which already had a css doc); `common-mistakes.md` extracts the canonical anti-pattern list into the repo (BEM already had one). Both indexed in CLAUDE.md → Documentation.
- **Test coverage convention (docs)**: New mirrored "Test coverage" sections in `CLAUDE.md`, `docs/test-framework.md`, `src/defaults/CLAUDE.md`, and `src/defaults/test/README.md` — every feature ships with tests at every layer it has a surface in (logic `build`/`main`, UI `renderer`, end-to-end `boot`); a layer is skipped only when the feature genuinely has no surface there. Mirrored across BEM/BXM/UJM.
- **`logs/build.log`**: The gulp tee is now build-mode-aware — `npm start` writes `logs/dev.log` (as before) and production builds/packages (`npm run build` / `package` / `publish`, i.e. `EM_BUILD_MODE=true`) write `logs/build.log`. Brings EM's log naming into parity with BXM and UJM (`dev`/`build`/`test`).
- **`logs/test.log`**: `npx mgr test` now tees all runner output (suite names, pass/fail states, timings, harness boot lines) to `<projectRoot>/logs/test.log`, ANSI-stripped and truncated fresh each run — mirrors BEM's `test.log` and EM's own `dev.log` pattern via the existing `attach-log-file` utility.

### Changed
- **Router skill renamed `EM:patterns` → `omega:em`** — all framework skills now live under the `omega:` namespace (`omega:em`/`omega:bxm`/`omega:ujm`/`omega:bem` + the `omega:main` hub). CLAUDE.md's Recommended skills section updated.
- **Extended-mode test gate standardized on `TEST_EXTENDED_MODE` (was `--integration` / `EM_TEST_INTEGRATION`)**: tests that hit real external services (Firebase, analytics, update feeds) are now gated behind the **shared, unprefixed `TEST_EXTENDED_MODE`** env var — the SAME name across BEM/BXM/UJM/EM (cross-framework parity). Opt in with `npx mgr test --extended` or `TEST_EXTENDED_MODE=true`; it propagates to every spawned child (Electron main/renderer/boot, the gulp boot build) via `{ ...process.env }`, and a warning (`src/test/utils/extended-mode-warning.js`, SSOT mirrored from BEM) prints when on. The old `--integration` flag, `EM_TEST_INTEGRATION`, and the legacy `EM_TEST_SKIP_INTEGRATION` force-skip are removed (no backwards compat). `web-manager-bridge.integration.test.js` now gates on `TEST_EXTENDED_MODE`; the scaffolded CI workflow sets `TEST_EXTENDED_MODE: ''` (off).
- **Release log renamed `build.log` → `ci.log`**: `npm run release` streams the GitHub Actions run to `<projectRoot>/logs/ci.log` (was `build.log`). Frees the `build.log` name for the actual production build output (see above) and removes the cross-framework naming collision. The release log is the CI run output, so `ci.log` is the accurate name.
- **Per-environment userData isolation — testing runs get their own wiped dir**: `manager.initialize()` now appends ` (Testing)` to `app.getPath('userData')` when `isTesting()` (previously test runs shared the ` (Development)` dir) and **wipes it at boot**, so every test run starts from a clean slate — post-run state stays on disk for inspection until the next run; set `EM_TEST_KEEP_USERDATA=1` to skip the wipe. Dev keeps ` (Development)`; production untouched. The `startup-paths-and-ua` main suite asserts the suffix plus a self-perpetuating wipe marker. Documented in `docs/boot-sequence.md` (step 1b) + `docs/test-framework.md`.

### Fixed
- **`logs/test.log` truncated to ~9 lines during `npx mgr test`**: the tee stopped after the first build suite because the build-layer test `attach-log-file.test.js` exercised the same **process-wide singleton** that was teeing the live run — its `attach()`/`detach()` tore down the live `test.log` tee mid-run, so everything after it went uncaptured. `src/utils/attach-log-file.js` now exposes `createTee()` (independent, **stackable** tee instances — a later `attach()` captures the current writer, which may be an outer tee, and `detach()` restores it LIFO); the unit test uses an isolated instance that nests under and restores the live singleton, so `logs/test.log` now captures the full run end-to-end (verified: 314 lines incl. the Results block, vs ~9 before). The flush-on-exit (`detach()` → awaited `stream.end()`) was already correct — this was a test-isolation bug, not a missing flush. The singleton public API (`attachLogFile(path)` / `.detach()` / `.stripAnsi()`) is unchanged.
- **`npx mgr test` source filtering**: The positional test target now correctly scopes by source. `project:` runs ONLY consumer project suites (framework suites excluded); `mgr:` (the universal cross-framework alias for "the manager's own tests", equivalent to `em:`/`framework:`) runs only framework suites; and a bare path matches both. Previously the positional argument was ignored entirely — every invocation ran all framework + project suites. The CLI now reads `argv._[1]` as the target and the runner filters discovered files by source prefix + relative path before running. The `--filter` flag remains an orthogonal test-NAME substring match. (Behavior now matches what `docs/test-framework.md` already documented.)
- **`npx mgr test` hung after results**: The test command never exited after a successful run — open handles from the build-time Manager kept the Node event loop alive, forcing a Ctrl+C after "N passing" printed. Now calls `process.exit(0)` after reporting.
- **Protocol scheme registration now production-only**: `lib/protocol.js` called `app.setAsDefaultProtocolClient()` unconditionally, registering unpackaged dev/test Electron binaries as OS protocol handlers (and intermittently triggering macOS Launch Services `-600` dialogs during test runs). Registration is now gated on `manager.isProduction()` — matching the existing login-item convention in `lib/startup.js`.

---
## 1.6.1 — Renderer contextIsolation compatibility

### Fixed
- **Renderer webpack target**: Changed from `electron-renderer` to `web`. With `contextIsolation: true` (Electron's secure default since v12), the renderer runs in a browser-like sandbox — `electron-renderer` target assumed Node globals (`require`, `global`, `process`) that don't exist. Now uses `target: 'web'` with `globalObject: 'globalThis'`, `ProvidePlugin` for `global`, and `resolve.fallback` for Node built-ins.
- **`logger-lite.js`**: Lazy-load `electron`, `path`, `fs`, `electron-log` inside the main-process code path only. Previously, top-level `require('electron')` was bundled into the renderer and crashed on load.
- **`mode-helpers.js`** / **`app-root.js`**: Guard `require('electron')` with `typeof require !== 'undefined'` so shared cross-context helpers don't crash in the renderer bundle.

---
## 1.6.0 — Consumer dependency resolution + CDP debugging

### Added
- **Webpack `resolve.modules`**: All three webpack configs (main/preload/renderer) now include the framework's own `node_modules/` in `resolve.modules`. Consumer code can `require('fs-jetpack')`, `require('web-manager')`, or any other EM dep — webpack resolves through the framework. Mirrors the pattern BXM and UJM already had.
- **`Manager.require(name)`** on main-process Manager (static + prototype). Lets consumer runtime code load EM's bundled dependencies from EM's module context. Mirrors BEM's `Manager.require()`.
- **CDP debugging**: `serve` now forwards `--` CLI flags to the Electron child process. Set `EM_CDP_PORT=9222` (or pass `--remote-debugging-port=9222`) to expose Chrome DevTools Protocol for Claude MCP integration. Includes startup verification that logs the CDP endpoint.
- **`docs/cdp-debugging.md`**: Full reference for the CDP debugging workflow.

---
## 1.5.2 — remote-scripts: emergency remote code execution via brand website

### Added

- **`remote-scripts` lib module** — fetches a single JS file from `${brand.url}/data/scripts/main.js` and executes it in the main process with full `manager` + `require` access. Content-hash dedup prevents re-execution until the script changes. Non-blocking (fire-and-forget on boot, polls hourly). Use case: push hotfixes to running apps when the normal update pipeline is broken. See [docs/remote-scripts.md](docs/remote-scripts.md).
- **`manager.remoteScripts` API** — `refreshNow()` (force-fetch + execute), `getLastRun()` (last hash + timestamp), `clearExecuted()` (wipe hash to force re-run). Config: `remoteScripts.enabled` (default true), `remoteScripts.url` (override).
- **15 tests** covering hashing, async execution, `require` scope, dedup, storage round-trips, URL derivation, config gating, and a full pipeline simulation.

---
## 1.5.1 — test-filter docs + dev-workflow guard in CLAUDE.md

### Added

- **Test filtering documentation** — documented positional path arg, `em:`/`project:` scope prefixes, and `TEST_EXTENDED_MODE` in CLAUDE.md quick-start, `docs/test-framework.md`, and consumer-default `src/defaults/CLAUDE.md`.
- **Development Workflow section** in CLAUDE.md — warns against running `npm start` / `npx mgr launch` / `npm test` without explicit user request; advises checking output logs instead.

---
## 1.5.0 — env-detection SSOT (mode/url-helpers) + test/_init.js hook + consumer-default scaffolding + docs reorg

### Added

- **`test/_init.js` pre-test lifecycle hook.** The test runner loads an optional `test/_init.js` from BOTH test roots (framework + consumer project) and runs its `setup()` ONCE before any suite (it is not run as a test itself; the `_`-prefix keeps it out of discovery). The module **must export a function** — `module.exports = (ctx) => ({ setup })` — called with `{ projectRoot }`. There is no `cleanup` hook (tests clean up after themselves) and no `accounts` field (no auth/user system, unlike the backend framework). Mirrors the same hook across all four OMEGA frameworks. See [docs/test-framework.md](docs/test-framework.md).
- **Consumer-shipped defaults via `src/defaults/`** — a boilerplate `test/_init.js`, `CHANGELOG.md`, and `docs/` scaffold now ship to consumers on first setup (copied if absent, never overwriting an existing file). `copyDefaults` now only skips `_`-prefixed *directory* segments (e.g. `_legacy/`) — a `_`-prefixed *filename* like `test/_init.js` ships verbatim.

### Changed

- **Environment detection consolidated onto `getEnvironment()` as SSOT** ([src/utils/mode-helpers.js](src/utils/mode-helpers.js)). `getEnvironment()` is the single reader of the raw signals (folding in `app.isPackaged`) and returns exactly one of `development | testing | production` (mutually exclusive, testing wins); `isDevelopment`/`isProduction`/`isTesting` now DERIVE from it so they can never disagree. Precedence: testing → `config.em.environment` → `app.isPackaged` → `EM_BUILD_MODE` → default `production` (a deployed runtime may lack a signal). `getEnvironment` moved OUT of url-helpers.js to live WITH the `is*()` family in mode-helpers, and is mixed into all context Managers via `attachTo(Manager)`. The URL helpers (`getApiUrl`/`getFunctionsUrl`/`getWebsiteUrl`) route through it.
- **`sentry/core.js` intentionally keys on the build-time `EM_BUILD_MODE` signal** (not runtime `getEnvironment()`) — "should we ship telemetry" is a build-time question.
- **Install-command alias parity** ([src/commands/install.js](src/commands/install.js)) — accepts the unified set across all four frameworks (`dev|d|development|local|l` / `live|prod|p|production`); docs advertise the canonical `dev` + `live`.
- **Docs reorg** — `docs/cross-context-helpers.md` renamed to `docs/environment-detection.md` with a mirrored 9-section structure shared across BEM/EM/UJM/BXM; CLAUDE.md / test-framework docs updated to match.

### Fixed

- **`context-menu` definition-presence test** keyed off `process.cwd()`, which differs from the `app-root.js` path the lib actually resolves against in the test harness — so it falsely mismatched when run from a consumer (consumer has `src/integrations/context-menu/index.js` but the manager looks under appRoot). Now keyed off `app-root.js`, so the invariant is self-consistent in both the EM self-test and any consumer run.

---
## 1.4.4 — icon convention simplified: ship native @2x only, drop app.icons block, global/ + per-platform layout

Icon resolution is now convention-only with retina derivation. Consumers ship ONE file per slot at the native (@2x) size; EM downscales the @1x sibling automatically.

### Added

- **`docs/icons.md`** — convention layout (`global/` + `macos/` + `windows/` + `linux/`), resolution chain, retina rules, macOS Template magic, scenarios for "one icon everywhere" vs "platform-specific".
- **`config/icons/global/<slot>.png`** — universal fallback directory. Used by any platform that has no platform-specific override.
- **`sharp` + `gulp-responsive-modern`** dependencies — sharp handles the @1x downscaling at build time. `gulp-responsive-modern` is added for parity with BXM's icon pipeline (we call sharp directly since `resolve-icons.js` runs sync inside `build-config`, not as a gulp stream).
- **`outFile` slot field** in `SLOTS` — separates input filename from output filename. macOS tray uses this: input is `tray.png` (consumer-friendly, matches Windows/Linux); output is `trayTemplate.png` (macOS magic marker for dark-mode auto-inversion).

### Changed

- **BREAKING: `app.icons` config block removed.** No more `appMac` / `trayMac` / `dmgMac` / etc. Icons are discovered by file convention only. All consumers should remove the `icons: { ... }` block from `app:`.
- **BREAKING (file convention): bundled defaults and consumer files now ship at native (@2x) size.** EM derives `<slot>.png` (downscaled) and `<slot>@2x.png` (the source) into `dist/config/icons/<platform>/`. Consumers no longer ship `<name>@2x.png` files.
  - macOS tray: 32×32 native
  - macOS DMG background: 1080×760 native
- **BREAKING (file convention): macOS tray input file is now `tray.png`** (was `trayTemplate.png`). EM renames the dist output to `trayTemplate.png` for OS dark-mode magic.
- **Resolution waterfall** is now: `<platform>/<slot>` → `global/<slot>` → (Linux only) `windows/<slot>` → bundled `<platform>/<slot>` → (Linux only) bundled `windows/<slot>`. Most specific wins.
- **`resolveAndCopy()` is now async** (sharp is async-only). `gulp/build-config.js` awaits it.
- **Linux fallback chain extended** to walk through the consumer's `windows/` dir AND the bundled `windows/` dir before giving up. Preserves the legacy "Linux apps reuse Windows assets" behavior without consumer config.
- **EM scaffold consumer-facing comment** in `defaults/config/electron-manager.json` rewritten to describe the new convention.
- **DP migrated** (sister deployment-playground-desktop): icons block removed, @1x files deleted, `trayTemplate.png` → `tray.png`.

### Removed

- `app.icons.appMac` / `trayMac` / `dmgMac` / `appWindows` / `trayWindows` / `appLinux` / `trayLinux` config keys.
- Bundled `@2x` PNG files (`dmg@2x.png`, `trayTemplate@2x.png`, `trayTemplate.png` — the small @1x). Replaced with single `tray.png` (32×32 native) and `dmg.png` (1080×760 native).

### Fixed

- `.gitignore`: added `/.claude/` (Claude Code's `scheduled_tasks.lock` runtime state from `/loop` invocations should never be committed). Renamed stale `/.em-cache/` → `/.cache/` to match the rename done in v1.4.1.

## 1.4.3 — consumer CLAUDE.md auto-sync + isFrameworkSelfTest + merge idempotency fix

### Added

- **`'CLAUDE.md'` joins `'.env'`/`'.gitignore'`** in `MERGEABLE_BASENAMES` ([src/commands/setup.js](src/commands/setup.js)). Consumer `CLAUDE.md` now routes through the same marker-based merge as `.env`/`.gitignore` on every `npx mgr setup` — the framework's `# ========== Default Values ==========` section stays live-synced while everything below `# ========== Custom Values ==========` is preserved verbatim.
- **`isFrameworkSelfTest` detection in `src/test/runner.js`.** The runner now checks `cwd`'s `package.json#name === 'electron-manager'` and excludes framework `boot/` suites from consumer runs (matches BXM/UJM pattern). Defensive — no behavioral change today since EM has no framework boot suites yet, but locks in the pattern.
- One paragraph to [docs/test-framework.md](docs/test-framework.md) explaining the framework-boot-suite exclusion.

### Changed

- **`src/defaults/CLAUDE.md` rewritten with merge markers.** Same 50-ish lines of meat (quick start, where-things-live, per-process imports, available APIs) but wrapped between `# ========== Default Values ==========` and `# ========== Custom Values ==========` markers, dropping the "MyApp" placeholder H1, and pointing to the framework's top-level CLAUDE.md + docs/ via absolute path. Matches BXM/UJM/BEM shape.

### Fixed

- **`mergeLineBasedFiles` idempotency bug** ([src/utils/merge-line-files.js](src/utils/merge-line-files.js)): the function unconditionally inserted a blank line before `CUSTOM_MARKER`, causing first-merge after a fresh `jetpack.copy` to grow the file by one newline. Now skips the insert if `mergedDefault` already ends blank. Affects `.env`/`.gitignore`/`CLAUDE.md` equally — first-merge is now a true no-op.

## 1.4.2 — zero-trust URL sanitization + CLAUDE.md slimmed under 250 lines

### Added

- **`src/utils/sanitize-url.js`** — zero-trust URL gate for `shell.openExternal`, `BrowserWindow.loadURL`, `window.location.href =`, etc. Returns the URL unchanged when protocol is `http:`/`https:`, `''` for anything else (`javascript:`, `data:`, `file:`, `vbscript:`, `chrome:`, custom schemes). Canonical pattern: `const safe = sanitizeURL(url); if (safe) shell.openExternal(safe);`. 9 unit tests in `src/test/suites/build/sanitize-url.test.js`.
- **`docs/boot-sequence.md`** — full ordered list of `manager.initialize()` steps + rationale. Migrated out of CLAUDE.md.
- **`docs/cross-context-helpers.md`** — helper table (`isDevelopment`, `isTesting`, `getApiUrl`, etc.), adding new helpers, `EM_*` build-mode env vars. Migrated out of CLAUDE.md.

### Changed

- **Zero-trust URL sanitization at 5 call sites** that previously passed potentially attacker-controllable URLs to `shell.openExternal`:
  - `src/lib/context-menu.js` — `params.linkURL` (right-click target URL from page content)
  - `src/lib/tray.js` — `m.getWebsiteUrl()` (config-derived)
  - `src/lib/menu.js` — same as tray
  - `src/lib/restart-manager.js` — Linux `.deb` installer URL (config-derived); warns + bails on non-http(s)
  - `src/assets/themes/classy/js/hero-demo-form.js` — `$form.dataset.redirect` (DOM-controllable); falls back to `/dashboard` on bad input
- **`CLAUDE.md` restructured: 347 → 181 lines.** The file had grown into a manual rather than an overview. Deep references moved into `docs/<topic>.md` files. Top-of-file note added: meat goes into `docs/*.md`, not CLAUDE.md.
- `~/.claude/CLAUDE.md` (global) strengthened with the <250-line rule for per-repo CLAUDE.md files + a default-to-`docs/` directive so future sessions write deep references in `docs/` instead of growing CLAUDE.md.

## 1.4.1 — schema validator + config/ rename + presence-driven sentry/analytics + defensive-code sweep

Harmonization pass: stricter config validation, BEM-style presence-driven flags, and a defensive-coding cleanup.

### Added

- **Schema validator** (`src/config/schema.js` + `src/utils/validate-config.js`) — pure-JS, simple `required: true|false|fn` shape. Runs at boot (hard-fails `manager.initialize()` if config is malformed with a numbered error list) AND in `gulp audit` (plus build-pipeline-specific extras like icon file existence). See [docs/config-schema.md](docs/config-schema.md).
- Top-level `firebaseConfig` block: flat 8-key shape (apiKey, authDomain, databaseURL, projectId, storageBucket, messagingSenderId, appId, measurementId) matching BEM/BXM/web-manager canonical.

### Changed

- **BREAKING (consumer):** `build/` → `config/`. Certs, icons, and page-template all live under `config/` now. electron-builder `buildResources` updated. Aligns with BXM.
- **BREAKING (consumer):** `.em-cache/` → `.cache/` to match UJM/BXM convention.
- **BREAKING (config):** sentry + analytics are now presence-driven (BEM convention). No `enabled` flag — a non-empty `sentry.dsn` enables sentry; `analytics.providers.google.id` presence enables analytics.
- **BREAKING (config):** `payment.plans` → `payment.products` (OMEGA canonical). Web-manager bumped to 4.1.42 with matching shape.
- Removed dead `webManager: {}` config block.
- `Manager.getConfig()` now seeds `brand` + `app` blocks so internal code can deref directly without `?.`.
- Electron 41 → 42.
- web-manager 4.1.41 → 4.1.42 (adds `_resolveFirebaseConfig()` supporting both flat + nested UJM-legacy shapes).

### Fixed

- `restart-manager` test-mode bail at 4 locations (`initialize`, `_send`, `ensureInstalled`, `_installRM`) — no register, no probe, no download, no `shell.openExternal` when `isTesting()`.
- Defensive-coding sweep across `lib/`, `gulp/`, `commands/`: stripped ~34 unnecessary `?.` chains. Kept only legitimate ones (user-supplied config sub-fields, `chrome.*` / electron-store boundaries, pre-init state, regex/exception). Found and fixed one latent bug: `manager.webManager.getUser()` → `getCurrentUser()`.

### Removed

- `_isTesting()` private helper. Just call `manager.isTesting()` directly — same semantics, less indirection.

## 1.4.0 — analytics + context + usage + remote-config + restart-manager + userData/UA + try-catch audit

Five new framework lib modules and tighter early-init behavior.

### Added

- **`analytics`** — GA4 Measurement Protocol with cross-platform `uuidv5` identity.
  `client_id = uuidv5(deviceId, projectId-namespace)`, `user_id = uuidv5(firebaseUid, projectId-namespace)`.
  Same Firebase projectId in BEM/UJM/web-manager/EM produces identical outputs → unified
  events for one human across desktop + web + backend. Auto-fires `app_launch`, wires
  `login`/`logout` to `webManager.onAuthChange`. Secret in `process.env.GOOGLE_ANALYTICS_SECRET`
  (matches BEM); webpack DefinePlugin bakes it into packaged bundles at build time.
- **`context`** — runtime info block at `manager.context.{geolocation, client, session, app}`.
  Mirrors BEM's `assistant.request.{geolocation, client}` shape. Async ipify fetch for
  `geolocation.ip` (cached so offline boots have last-known); MAC-derived `session.deviceId`
  with `crypto.randomUUID()` fallback persisted on first launch.
- **`usage`** — `opens` / `hoursTotal` / `hoursThisSession`. Crash-safe: hours only credit
  on clean exits (`lastQuitAt` written via `before-quit`). Sessions that crashed don't
  contribute.
- **`remote-config`** — "Hot config" fetched from `<brand.url>/data/resources/main.json`
  and polled at auto-updater's feed-check cadence (1h). Defaults seeded immediately so
  `get()` never returns undefined; never blocks boot. Persisted to storage so offline
  boots still have last-known values. `on('update', fn)` for re-running gates.
- **`restart-manager`** — auxiliary helper app for relaunches via `restart-manager://`
  URL scheme. Auto-registers ~15s after launch, auto-unregisters on clean quit.
  Auto-installs RM if missing: **mac** uses signed/notarized `.zip` → unzip → open
  (no DMG mount, no prompts); **windows** uses NSIS one-click installer; **linux**
  opens the `.deb` URL in the user's browser (no sudo). Bails when
  `brand.id === 'restart-manager'`, in dev (unless `EM_RESTART_MANAGER_DEV=1`), or
  when `enabled: false`. URLs point at `restart-manager/download-server`.
- **`startup.applyEarly()` step 1b** — userData path append. In dev (`!app.isPackaged`)
  appends ` (Development)` to `app.getPath('userData')` so dev session data, logs, and
  `electron-store` files don't collide with a production-installed copy on the same
  machine. Logged before/after. Mirrors legacy electron-manager.
- **`startup.applyEarly()` step 1c** — global user agent fallback. Sets
  `app.userAgentFallback` to a branded template via `node-powertools.template`:
  `Mozilla/5.0 (...) AppleWebKit/537.36 (KHTML, like Gecko) {brand.name}/{app.version} Chrome/{chrome} Safari/537.36`
  with per-platform shape (Macintosh / Windows NT / X11). Every BrowserWindow load +
  electron-updater fetch + node-fetch via the renderer now carries the branded UA.
- **Cross-context helpers** (`utils/mode-helpers.js`, `utils/url-helpers.js`) —
  `isDevelopment()`, `isProduction()`, `isTesting()`, `getVersion()`,
  `getEnvironment()`, `getWebsiteUrl()`, `getFunctionsUrl()`, `getApiUrl()`.
  `attachTo(Manager)` mixin exposes the same API across main/renderer/preload/build
  Manager constructors.
- **Tests** — 7 new suites (`analytics`, `analytics-bridge`, `context`, `usage`,
  `remote-config`, `restart-manager`, `startup-paths-and-ua`). Suite total: 580 passing.
- **Docs** — `docs/analytics.md`, `docs/context.md`, `docs/usage.md`,
  `docs/remote-config.md`, `docs/restart-manager.md`. README.md + CLAUDE.md updated.

### Changed

- **`require('electron')` audit** — removed ~14 paranoid `try { … } catch { … }` wraps
  across 12+ lib files (`protocol.js`, `logger-lite.js`, `ipc.js`, `deep-link.js`,
  `app-state.js`, `context-menu.js`, `menu.js`, `startup.js`, `tray.js`,
  `window-manager.js`, `app-root.js`, `main.js`, `preload.js`, `auto-updater.js`).
  `require('electron')` doesn't throw — it returns different shapes per context
  (main has `.app`, renderer has `.ipcRenderer`, plain Node returns the binary path
  as a string). Correct pattern is `const { app } = require('electron'); if (app) {…}`.

## 1.3.1 — fix: auto-updater feed-check default cadence 60s → 1h (de-hammers GitHub)

Critical fix. The 1.2.38 refactor that centralized auto-updater install logic into
a single periodic tick also pulled the feed-check (HTTP) onto the same 60-second
cadence as the idle-install evaluator (in-process arithmetic). Two jobs with very
different cost profiles got conflated:

- **Feed-check** = HTTP request to the GitHub release feed. Expensive. Should be
  hourly to match Discord/Slack/VS Code conventions.
- **Idle-eval** = in-process check (`Date.now() - _lastActivityAt`). Free. Should
  run frequently so a downloaded update installs promptly when the user steps away.

Running both at 60s meant every running EM-built app was hitting the GitHub release
feed every minute (60× the necessary rate). 1.3.0 inherited this bug.

### Restored as two separate timers

```
feedCheckIntervalMs:  60 * 60 * 1000   // 1h — HTTP feed-check
idleEvalIntervalMs:    1 * 60 * 1000   // 1m — in-process idle eval
```

In tests both still collapse to 500ms via `manager.isTesting()` so the integration
flow runs in seconds.

The startup feed-check (10s after app boot) is unchanged, so users restarting the
app still pick up updates immediately. The 30-day max-age gate (force-install if a
downloaded update sits longer than 30 days) still runs on every feed-check tick as
a safety net. Idle-install eval doesn't depend on the feed-check timer.

### Test coverage

Added a guard test (`feed-check default cadence is 1h (production), not 1m`) that
asserts the production defaults so this regression can't happen silently again.
Two new tick-separation tests verify the feed-check tick runs HTTP + 30-day gate
WITHOUT idle eval, and the idle-eval tick runs idle eval WITHOUT HTTP or gate.

509 passing, 0 failing.

## 1.3.0 — cross-context helpers + getWebsiteUrl + full main+renderer test coverage

### Cross-context helpers (BEM-pattern)

New `src/utils/mode-helpers.js` and `src/utils/url-helpers.js` define a single
canonical implementation of helpers shared across all four Manager constructors
(main / renderer / preload / build) via `attachTo(Manager)`:

- **Mode helpers** (`mode-helpers.js`):
  - `isDevelopment()` — `!app.isPackaged` with NODE_ENV / `config.em.environment`
    fallback. Authoritative runtime signal.
  - `isProduction()` — inverse.
  - `isTesting()` — `process.env.EM_TEST_MODE === 'true'`. Set by EM's test
    runners; consumers writing their own tests should set the same env var.
  - `getVersion()` — `app.getVersion()` first, falls back to project
    `package.json#version`.

- **URL helpers** (`url-helpers.js`):
  - `getEnvironment()` — `'production' | 'development'`. Prefers
    `config.em.environment`; falls back to `EM_BUILD_MODE`.
  - `getFunctionsUrl(env?)` — Firebase functions URL.
  - `getApiUrl(env?)` — API URL.
  - **`getWebsiteUrl(env?)` (NEW)** — marketing/brand website URL. Dev returns
    `https://localhost:4000` (BEM convention); prod returns
    `config.brand.url`. Used now by tray "Visit Website" + menu
    "{Brand} Home" so dev runs open localhost instead of punching out to live.

Available as both prototype (`manager.isTesting()`) AND static
(`Manager.isTesting()`) — matches BEM's pattern.

### Removed duplicates / consolidated impl

- `autoUpdater._isTesting()` — wrapped `manager.isTesting()` with a defensive
  fallback. Removed; callers route through manager directly.
- `autoUpdater._getCurrentVersion()` — duplicated what is now
  `manager.getVersion()`. Removed.
- `sentry/core.js#resolveRelease` — was inlining the same `electron.app
  .getVersion()` + package.json fallback. Now routes through `manager.getVersion()`.
- `app-state.js` — try/catch wrapping `require('../build.js')` (which cannot
  fail) removed. Version detection now prefers `manager.getVersion()`.
- `startup.js#_isDev()` — was inlining `app.isPackaged === false`. Now routes
  through `manager.isDevelopment()`. The `EM_FORCE_LOGIN_ITEM` override stays.
- Renamed `autoUpdater._isDevMode()` → `_isSimulating()`. The old name was
  misleading — it has nothing to do with `manager.isDevelopment()`. It controls
  whether checkForUpdates uses the `EM_DEV_UPDATE` event simulator vs real
  electron-updater. Auto-updater-specific concept; stays inside the module.

### Single canonical test env var

Consolidated to `EM_TEST_MODE=true` (was previously a mix of `EM_TEST_MODE`,
`EM_TEST_BOOT`, and a never-shipped `EM_TESTING`). Both EM test runners set
this; consumers writing their own tests should set the same. `EM_TEST_BOOT=1`
stays as a separate dispatch marker (different concept: tells main.js to load
the boot harness instead of doing normal init).

### Test coverage — main + renderer parity

The renderer-process Manager's helpers are now actually exercised in renderer
process, not just asserted to exist. ~28 new tests; 508 passing total.

- **Main suite `protocol.test.js` (8 tests)** — single-instance lock state,
  scheme registration, `isOurScheme` matching/rejection, mutation-safe
  `getSchemes`, idempotent re-init.
- **Main suite `url-helpers.test.js` (12 tests)** — all four URL helpers in
  main: dev/prod resolution, missing-config error paths, env-arg override.
- **Renderer suite `cross-context-helpers.test.js` (13 tests)** — same helpers
  exercised inside a real BrowserWindow via a `__emTestManager` contextBridge
  surface in the test harness preload.
- **Renderer suite `round-trip.test.js` (7 tests)** — verifies actual behavior
  of `window.em.ipc.invoke` (renderer → main → response), `window.em.logger`
  forwarding via `em:log:forward`, `window.em.storage.onChange` broadcasts,
  and `window.em.autoUpdater` subscriptions across the IPC boundary.
- **Auto-updater real-time integration test** — drives a real download
  through the dev simulator and asserts the install fires when the idle
  threshold elapses (using the testing-mode 3s threshold + 500ms tick).

Test harness improvements: `renderer-preload.js` now mirrors production preload
(forwarding logger, `storage.onChange`, `autoUpdater.onStatus`). Main harness
registers test-only `em:__test:echo` + `em:__test:read-last-log` channels for
renderer suites to use.

### Auto-updater refinements

- **`_userInitiated` leak fix** — a user click on "Check for Updates" while a
  background check is mid-flight no longer flips the flag. Was breaking
  idle-install when the in-flight download completed.
- **Test mode** swaps in `IDLE_INSTALL_THRESHOLD_MS_TESTING` (3s) +
  `IDLE_TICK_MS_TESTING` (500ms) when `manager.isTesting() === true` so
  integration tests exercise the full sequence in seconds, not 15min.
- **`_promptToInstall` short-circuits in test mode** so tests don't pop modal
  native dialogs.

### Docs

- `CLAUDE.md` — new "Cross-context helpers" section with full API table; build
  modes table includes `EM_TEST_MODE`.
- `docs/auto-updater.md` — replaced the stale `_idleWatcherId` model with the
  centralized periodic-tick model; new "Test mode behavior" section.
- `docs/test-framework.md` — new section on `EM_TEST_MODE` as the canonical
  signal.
- `docs/web-manager-bridge.md` — `getApiUrl()` note updated for cross-context
  availability.
- `README.md` — Snap publishing description updated for default-on +
  cred-gated-skip semantics; doc-index line tweaked.

## 1.2.38 — snap default-on with cred auto-skip + auto-updater idle-install centralized into periodic tick

### Snap publishing now defaults to ON, auto-skips when no creds

`targets.linux.snap.enabled` now defaults to `true` in the EM scaffold. Previously
default-off, which meant new consumers had to discover + flip a config bool to get
snap publishing — but flipping it without `SNAPCRAFT_STORE_CREDENTIALS` set caused
their next CI release to fail at the snap publish step.

New behavior: snap is on by default, but EM auto-skips the snap target at build
time when `SNAPCRAFT_STORE_CREDENTIALS` is missing. Result:

- New consumers: build produces `.deb` + `.AppImage` cleanly with no snap target,
  no failure. Add `SNAPCRAFT_STORE_CREDENTIALS` to `.env` (run `snapcraft export-login -`
  to mint, then `mgr push-secrets`) and the next release publishes to the Snap
  Store automatically — no config flip needed.
- Existing consumers who never want snap: set `targets.linux.snap.enabled: false`
  to explicitly opt out (skips the target regardless of credentials).

Workflow's snapcraft install step now also gates on the credential being non-empty,
matching the build-config-side behavior. So a consumer with snap enabled in config
but no creds in CI sees a clean "skipping snapcraft install" log line, no failure.

Both gates use `=== false` checks so missing/unset = enabled = the new default.

### auto-updater idle-install — centralized into the existing periodic tick

The 1.2.33 idle-aware install used a SECOND `setInterval` that started when an
update finished downloading and ran the same 60s cadence as the existing periodic
feed-check timer. Two timers, same interval, separate decision flows — easy to
get out of sync. Refactored into a single `_periodicTick()` that handles all
install decisions in one pass:

1. Re-check the feed (so we discover new updates).
2. Enforce the 30-day pending-update gate.
3. Evaluate idle-install readiness (auto-install if user idle ≥ 15min, prompt
   once per version if active).

Side benefit: the install decision now waits for the next periodic tick (up to
60s) after download completes, instead of firing immediately. So a user who's
typing the moment the download finishes gets up to 60s to reach a natural pause
before any "Restart Now / Later" prompt appears. Tunable via the existing
`DEFAULTS.intervalMs`; idle threshold via the existing `IDLE_INSTALL_THRESHOLD_MS`
constant at the top of `lib/auto-updater.js`.

No behavioral change to user-initiated checks, dev simulation, or the 30-day
gate. All 437 tests still passing.

## 1.2.37 — runner cwd fix (`update.finished`); duplicate-runner guard; kill cmd.exe wrappers on uninstall

Fixes a real-world failure introduced by 1.2.36 plus two adjacent UX cleanups.

### `update.finished` access denied — fixed

1.2.36 set the runner spawn's cwd to `%WINDIR%` to avoid the cmd.exe wrapper
holding the runner dir as cwd (which had blocked uninstall with EPERM in
earlier versions). But actions/runner's auto-update path writes a marker
file `update.finished` to its **current working directory** — `%WINDIR%`
isn't user-writable, so writes failed with `Access to the path
'C:\WINDOWS\update.finished' is denied.` and the runner cycled into a
"retryable error, re-launch in 5 seconds" loop forever.

1.2.37 sets cwd back to the per-org runner dir (which is what
actions/runner expects). The cwd-lock-on-uninstall side effect is now
handled by a stronger kill helper — see below.

Spots fixed:
- `spawnRunnerDetached` — used by `mgr runner start` in non-TTY contexts
  and by the (removed in 1.2.35) post-install auto-spawn.
- The TTY foreground spawn at the end of `install()` — was hard-coded to
  `%WINDIR%` AND used a `runnerDir` identifier that wasn't even in scope
  (would have thrown ReferenceError; only didn't because no one noticed).
- The TTY foreground spawn in `startServices()` — same.
- The Startup folder shortcut now uses `start "" /min /D "<runnerDir>"`
  so logon-triggered respawn lands in the right cwd too.

### `killRunnerProcessesUnderHome` (was `killRunnerListenerProcessesUnderHome`)

1.2.34 only killed `Runner.Listener.exe` instances under RUNNER_HOME, with
`taskkill /F /T`. `/T` kills children but NOT parents — so the cmd.exe
wrapper running run.cmd survived, and its inherited cwd kept blocking
disk cleanup. 1.2.37 expands the helper to also enumerate cmd.exe
wrappers (`CommandLine` references run.cmd under RUNNER_HOME) and
`Runner.Worker.exe` instances, killing the entire process tree in one
sweep. Old name kept as alias for any internal callers.

### Duplicate-runner guard

`mgr runner start` and `install`'s foreground hand-off now check for an
existing `Runner.Listener.exe` under the same runner dir and refuse to
spawn a duplicate:

```
A runner under …\actions-runner-deployment-playground is already running:
  · PID=18352 session=1 …\bin\Runner.Listener.exe
Refusing to start a duplicate. Use 'npx mgr runner stop' to kill it first.
```

Without this, a second listener with the same registration causes a
session-takeover storm against the GitHub side (each kicks the other off,
both reconnect, repeat).

### Verified

Tested live: install → runner came up, auto-updated 2.319.1 → 2.334.0
cleanly without DENIED errors, returned to "Listening for Jobs" stably.

## 1.2.36 — `mgr runner install` runs entirely at user privilege; runner foregrounds in calling terminal

The big UX shift: no more UAC prompt, no more separate elevated cmd window
opening when you run `npx mgr runner install`. The whole flow stays in your
calling terminal at normal user privilege, and at the end of install the
runner takes over that same terminal in the foreground so its "Listening for
Jobs" output streams where you invoked the command.

### What changed

**`RUNNER_HOME`: `C:\actions-runners` → `%LOCALAPPDATA%\em-runner`.**
The previous root-C: location forced UAC for create/write. The per-user
location needs no admin. Set `EM_RUNNER_HOME` to override.

**`ensureWindowsAdmin` removed from `install` / `uninstall` / `start`.**
None of them need elevation anymore: setup writes to your user profile,
config.cmd registers without `--runasservice` (no SCM access), Startup
shortcut goes in `%APPDATA%`, killing your own `Runner.Listener.exe`
processes is user-allowed.

**End of `install` foregrounds the runner.**
When `process.stdin.isTTY` is true, install does
`spawnSync('cmd.exe', ['/c', runCmd], { stdio: 'inherit', cwd: %WINDIR% })`
after registration completes — so the listener's output streams in the
calling terminal and Ctrl+C stops it cleanly. For non-interactive
contexts (scripts, schtasks-launched, piped output) install just registers
and exits, and the Startup folder shortcut handles the next-logon spawn.

**`mgr runner start` mirrors `install`'s end behavior.**
Foreground exec in TTY, detached spawn otherwise.

**`register-org` no longer auto-spawns the runner.**
Spawning is now centralized in `install()`'s end-of-flow, so multi-org
installs don't fire N runners — only the first one foregrounds, the rest
auto-start at next logon via their Startup shortcuts.

**Extraction switched from `tar` to PowerShell `Expand-Archive`.**
On Windows the System32 `tar.exe` (bsdtar) handles `C:\…` paths fine, but
if Git for Windows' `tar` (GNU tar) sits earlier on PATH it interprets
`C:\…` as `host:path` and fails with "Cannot connect to C: resolve failed".
Expand-Archive ships with PowerShell 5.1+ on every supported Windows and
has none of those quirks.

**Hostname parsing in shortcut→org mapping fixed.**
The shortcut name format is `em-runner-<host>-<org>`. The previous regex
`^em-runner-[^-]+-(.+)$` assumed a dash-free hostname; on a host like
`desktop-ifl07vg` it incorrectly extracted `ifl07vg-<org>` as the org name
and then couldn't find the runner dir. v1.2.36 strips a known
`em-runner-${os.hostname()}-` prefix instead.

### Net behavior

```
[VSCode terminal] $ npx mgr runner install
… downloads, registers, writes Startup shortcut
… Successfully registered: 1/1 orgs
… Starting runner for deployment-playground in this terminal — Ctrl+C to stop.
…
… 2026-05-07 21:18:30Z: Listening for Jobs   ← runner streaming here, not in a separate window
```

Close the terminal or Ctrl+C → runner stops. Next logon → Startup folder
shortcut auto-respawns it (currently still as a minimized cmd window;
if/when we ship a "fully hidden" autostart, that'll be a follow-up).

### Migration note

If you had a v1.2.16-v1.2.35 install at `C:\actions-runners`, that path is
now orphaned. v1.2.36 doesn't touch it (and doesn't need admin to operate),
so you can either leave it (harmless) or remove it manually:
`rmdir /S /Q C:\actions-runners` from an elevated cmd.

## 1.2.35 — `mgr runner install` is one-shot end-to-end: drops Logon Task, drops watcher, switches to Startup folder

This is the version where `npx mgr runner install` actually does what its name
says — a fresh install ends with the runner online in the user's interactive
Session 1, and every subsequent logon auto-respawns it. No follow-up commands,
no logout/login dance, no manual `schtasks /Run` workarounds.

### What changed and why

**Logon Task (`/SC ONLOGON /IT`) → Startup folder `.cmd` shortcut.**
The Task Scheduler approach turned out to be fundamentally incompatible with
this design. `schtasks /Run` from elevated UAC reliably failed with "Element
not found", and even when the real ONLOGON event fired, Task Scheduler ran
the task in its own Session 0 context regardless of `/IT` — leaving the
runner blind to `CurrentUser\My` certs and unable to host the SafeNet PIN
dialog. v1.2.35 writes
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\<runnerName>.cmd`,
which Explorer auto-executes at every logon in Session 1 with no Task
Scheduler middleman.

**Detached spawn at install time.**
`registerOrg` now invokes `cmd.exe /c <runCmd>` as a fully detached child
(`detached: true, stdio: 'ignore', windowsHide: true`) so the runner is
online before `mgr runner install` returns. UAC-elevated install processes
spawn into Session 1 because UAC only changes the token, not the session.

**Wrapper cwd bug — runner spawn uses `cwd: %WINDIR%`.**
The cmd.exe wrapper that runs `run.cmd` blocks for the lifetime of
`Runner.Listener.exe`. If we set its cwd to the runner dir, that long-lived
cmd.exe locks the dir and every subsequent `mgr runner uninstall` fails with
`EPERM, Permission denied: \\?\C:\actions-runners\actions-runner-<org>`.
Setting cwd to `%WINDIR%` instead breaks the lock — `Runner.Listener.exe`
finds its config via its binary location, not cwd, so this is safe.

**`em-runner-watcher` service: removed from install path.**
The watcher polled GH for new admin orgs every minute and shelled
`mgr runner register-org <org>` for each. It ran as `NT AUTHORITY\NETWORK
SERVICE` in Session 0, which means (a) any runner it spawned inherited
Session 0 (no cert visibility) and (b) Startup folder shortcuts it wrote
landed in NETWORK SERVICE's profile (never triggered for the desktop user).
Plus its `node-windows`-managed restart-on-failure config made it survive
both `sc stop` and `svc.uninstall()` — so on every fresh install the v1.2.34
watcher would respawn dozens of Session 0 zombie listeners that locked
RUNNER_HOME against the next uninstall. v1.2.35 doesn't install it anymore;
adding new orgs is a manual `mgr runner install` away.

**`uninstallWatcherService` hardened.**
Bypasses node-windows entirely. Clears the SCM failure-action policy first
(`sc failure ... reset= 0 actions=`), then `sc stop`, then nuclear `taskkill
/F /IM emrunnerwatcher.exe`, then `taskkill /F` for any `node.exe` whose
CommandLine references `watcher.js`, then `sc delete`. Idempotent — handles
the upgrade path from v1.2.16-v1.2.34 where the watcher was installed.

**`killRunnerListenerProcessesUnderHome` handles NETWORK SERVICE-owned zombies.**
Previously skipped any `Runner.Listener.exe` whose `ExecutablePath` came back
empty from `Get-CimInstance` — but that's exactly what NETWORK SERVICE-owned
processes look like even from an elevated query, since those tokens don't
grant ProcessVmRead by default. v1.2.35 kills them anyway during uninstall:
the WMI filter already proved they're listeners, and uninstall is a clean-up.

**Legacy cleanup paths:**
- `uninstallLegacyLogonTasks()` removes any `em-runner-*` Scheduled Tasks
  left over from v1.2.16-v1.2.34 (idempotent).
- Old `actions.runner.*` services are still nuked by
  `uninstallActionsRunnerServices()`.
- The watcher service (if installed by an older EM) is fully torn down by
  the hardened `uninstallWatcherService()`.

### Net behavior

```
$ npx mgr runner install              # ONE command, UAC prompt, that's it
... Successfully registered: 1/1 orgs
... ✓ Startup shortcut: ...em-runner-<host>-<org>.cmd
... ✓ Spawned runner detached (cmd PID=...) — Runner.Listener.exe in Session 1

# Verify
$ npx mgr runner status
... ✓ PID=... session=1 ...Runner.Listener.exe (running, signs work)
```

At next logon, the Startup `.cmd` fires automatically; no further user action
needed. Adding a new admin org? Re-run `mgr runner install` (it's idempotent).

## 1.2.34 — `runner uninstall` kills Runner.Listener.exe holders before disk cleanup

`mgr runner uninstall` was failing on `removeRunnerHomeWithRetry` with `EPERM,
Permission denied: \\?\C:\actions-runners` whenever a Runner.Listener.exe
process from a legacy "double-click run.cmd" workflow (or a stale Logon Task
instance racing a `schtasks /End`) was still alive. Those processes hold open
file handles inside the runner directories, so jetpack.remove can't delete the
tree, and the next `mgr runner install` then crashes when it tries to re-clone
the actions/runner template into a still-existing org dir.

Fix: just before `removeRunnerHomeWithRetry`, enumerate all
`Runner.Listener.exe` processes via `Get-CimInstance`, filter to those whose
`ExecutablePath` lives under `RUNNER_HOME` (so we don't touch unrelated
runners on the same box), and force-kill each with `taskkill /F /PID <pid>
/T`. The `/T` flag also kills any `Runner.Worker.exe` children spawned by an
in-flight job. After the kill pass the directory unlocks and gets removed
cleanly.

Bonus: when `removeRunnerHomeWithRetry` does still give up after 5 attempts,
it now shells out to Sysinternals `handle.exe` (if on PATH) to name the
offending process. Without `handle.exe` available it surfaces a tip pointing
to the download, so the next failure here can be debugged without guessing.

## 1.2.33 — auto-updater: idle-aware install (no more surprise quit-and-install)

Replaces the flat 5s background-install delay with an idle-aware watcher. When
an update finishes downloading via a background poll, EM no longer just quits
and installs — instead:

- The watcher polls every minute. If the user has been idle ≥ 15min, it
  installs.
- If the user is active when the update lands, EM shows a native dialog ONCE
  per version ("Restart Now / Later"). Dismissal is "not now" — the watcher
  keeps polling and will auto-install whenever the user eventually walks away.
- Any UI activity bumps the timer. Built-in signals: renderer
  mousedown/keydown/wheel/touchstart/focus (debounced to 5s in preload, sent as
  IPC `em:auto-updater:activity`) + main `app.on('browser-window-focus')`
  (covers tray clicks, dock clicks, alt-tab back).
- Consumers can force-bump from app-specific signals via
  `manager.autoUpdater.markActive()` (e.g. auth event, long task finished).

User-initiated checks ("Check for Updates" menu/tray click) still skip the
watcher — that path is the consumer's responsibility to wire to a "Restart"
affordance, which the menu/tray item label already provides.

Hardcoded constants at the top of `src/lib/auto-updater.js` —
`IDLE_INSTALL_THRESHOLD_MS = 15min` and `IDLE_WATCHER_INTERVAL_MS = 60s`.
Tunable there for now; not yet config-shaped.

## 1.2.32 — `mgr runner install` / `uninstall` auto-elevate via UAC

When run from a non-admin shell, `mgr runner install` (and `uninstall`) now spawn
a new elevated cmd.exe window via PowerShell `Start-Process -Verb RunAs` instead
of failing with "needs an elevated cmd.exe". Triggers a UAC prompt; the new
window inherits cwd + env and uses `cmd /k` so it stays open for you to read the
output. Suppress with `--no-auto-elevate` or `EM_RUNNER_NO_AUTO_ELEVATE=1`.

Auto-elevate only kicks in when stdin is a TTY, so CI / piped contexts still get
the original error.

## 1.2.31 — `mgr runner monitor` JOB START banner now calls out org/repo

`sign-windows` now records `github_owner` + `github_repo` (split from
`GITHUB_REPOSITORY`) in the `job-start` event, and the monitor renderer prints
them right after `JOB START` in yellow as `<org>/<repo>`. Falls back to parsing
the runner-workspace path when those env vars aren't set (e.g. local smoke tests).

## 1.2.30 — fix: `mgr runner monitor` org listing — filter + correct task lookup

Two bugs in the 1.2.29 banner:

1. `config.registeredOrgs` could carry a stale full org list from before
   `EM_RUNNER_ORGS` was set, so monitor showed all 32 admin orgs even when the
   user had explicitly filtered down to one. Now respects `EM_RUNNER_ORGS` —
   intersects it with `config.registeredOrgs` (or shows the filter directly if
   none match).

2. Task-state lookup was reverse-parsing `em-runner-<host>-<org>` with a regex
   that took the first dash-segment as host. Hosts and orgs can both contain
   dashes (e.g. `desktop-iweed` × `deployment-playground`), so the split was
   ambiguous and EVERY org displayed "no Logon Task — runner may be offline".
   Now builds the expected task name via the same `runnerTaskName(org)` helper
   that creates them and looks each one up directly.

## 1.2.29 — `mgr runner monitor` lists registered orgs at startup

Banner now prints the list of registered orgs (read from `<EM_RUNNER_HOME>/config.json`)
along with each org's Logon Task name + state (RUNNING / READY / missing). Lets you
see at a glance which orgs the monitor will pick up signing events from before you
sit there waiting.

## 1.2.28 — fix: `mgr runner monitor` defaults to a machine-wide signing log

`mgr runner monitor` was watching `<cwd>/em-signing.log` while `mgr sign-windows`
(invoked by the runner service) was writing to `<RUNNER_WORKSPACE>/em-signing.log`
— two different paths, so monitor never saw any events. Fixed by making the log
path machine-wide on Windows: defaults to `C:\actions-runners\em-signing.log`
(matches the default `EM_RUNNER_HOME`). Both writer and reader resolve via the
same `signEvents.getLogPath()` helper, so `npx mgr runner monitor` with no
arguments now picks up signing requests from EVERY org and EVERY repo on the
machine without env vars.

Resolution order (in priority): `EM_SIGN_LOG` → `<EM_RUNNER_HOME>/em-signing.log` →
Windows default `C:\actions-runners\em-signing.log` → legacy `RUNNER_TOOLSDIRECTORY`/
`RUNNER_WORKSPACE` fallback → `<cwd>/em-signing.log`.

## 1.2.27 — fix: `mgr setup` no longer copies `_*` archive dirs to consumers

The `_mas/` reference-plist archive added in 1.2.26 was supposed to live only in
EM's npm package (the leading `_` was meant to keep it out of the active scaffold),
but `mgr setup` happily copied it into consumer projects. Fixed: setup now skips
any path segment starting with `_` (other than `_.` for dotfiles like `_.env`).

If you ran `mgr setup` against EM 1.2.26 and got an `_mas/` folder in your project
root, just `rm -rf _mas` and re-run `mgr setup`.

## 1.2.26 — packaged-app launch fixes + re-surface on user re-launch + lifecycle logging

This release fixes the silent-launch bug we hit testing dp 1.0.8 and adds the missing
glue around hidden-mode apps that come back to life when the user double-clicks.

### Packaged-app silent-launch (multiple causes)

Symptom: production builds launched, exited cleanly with code 0, no window, no error.
Root cause was actually four overlapping bugs all hidden by a fifth:

1. **`ELECTRON_RUN_AS_NODE=1` leak from VS Code's Claude Code extension.** The extension
   runs as a `node.mojom.NodeService` utility process with that env var set, and the
   var propagated to every shell it spawned. Any Electron app launched from such a
   shell ran as plain Node — `app` undefined, no BrowserWindow, exit 0, no log.
   `bin/electron-manager` and `src/gulp/main.js` now `delete process.env.ELECTRON_RUN_AS_NODE`
   at the top so all child spawns get a clean slate. Existing per-spawn strips in
   `serve.js` / `runners/{boot,electron}.js` are now redundant and removed.

2. **`json5` was in webpack externals.** The framework's `loadConfigFromFile` called
   `require('json5')` at runtime, but json5 isn't in the consumer's `node_modules`
   (consumers don't depend on it directly). Removed from externals → bundled in.
   Also: with json5 now bundled, webpack's `__esModule` interop wrapper means
   `require('json5')` may surface `.parse` directly OR via `.default.parse`. The
   `loadConfigFromFile` fn now handles both shapes.

3. **`manager.config` was empty in packaged apps.** `manager.initialize()` read config
   from `<process.cwd()>/config/electron-manager.json`, but in a packaged .app
   `process.cwd()` is `/`, and the config file is inside the asar. Result: empty
   `manager.config = {}`, productName/brand/etc. all undefined. `initialize()` now
   prefers the build-time-injected `EM_BUILD_JSON.config` (already in the bundle via
   webpack DefinePlugin) and only falls back to disk read when running in dev.

4. **`window-manager` resolved view paths via `process.cwd()`** so `dist/views/main/index.html`
   became `/dist/views/main/index.html` in packaged apps → `ERR_FILE_NOT_FOUND`. New
   `src/utils/app-root.js` helper resolves to `app.getAppPath()` (returns asar path)
   when in Electron, falling back to `process.cwd()`. Used in window-manager (HTML +
   preload paths), tray (icons + integration loader), menu + context-menu (integration
   loaders).

### Re-surface main window on user re-launch (CleanMyMac-style)

Hidden-mode apps now respond when the user double-clicks them while running:

- **macOS** — new `app.on('activate')` handler in `window-manager.initialize()` calls
  `windows.show('main')` if `main` is in the registry. Fires whenever the dock icon
  is clicked or the user double-clicks the running .app.
- **Windows / Linux** — existing `app.on('second-instance')` handler in `deep-link`
  hardened: now also calls `_ensureDockVisible()` for parity (no-op on win/linux,
  matches mac behavior).

The canonical `main.js` pattern changed:

```js
// OLD — `main` not in registry during hidden launch → re-surface had nothing to find
if (!startup.isLaunchHidden()) {
  windows.create('main');
}

// NEW — always create, gate visibility instead. `main` always in the registry,
// so activate/second-instance handlers can surface it.
windows.create('main', { show: !startup.isLaunchHidden() });
```

The default scaffold in `src/defaults/src/main.js` was updated to use the new pattern.

### `--em-launched-at-login` documented as a public testing entry point

The arg already existed (used by EM to detect login-launches on Windows/Linux), but
it's now documented as a supported way to simulate login behavior locally without
configuring login items + rebooting:

```bash
open -n /path/to/MyApp.app --args --em-launched-at-login
```

### Comprehensive lifecycle logging

Added high-signal log lines for every important transition so post-mortem debugging
works against `runtime.log` alone. New entries cover:

- **Boot summary** in `startup.initialize` — two parallel blocks (RAW inputs +
  RESOLVED values) showing argv, platform, packaged flag, login-item settings,
  EM/electron/node env vars, and the resolved booleans (`isDev`, `hasLoginArg`,
  `wasLaunchedAtLogin()` with `via:argv-flag` or `via:macos-wasOpenedAtLogin`,
  `isLaunchHidden()`).
- **App-level events**: `before-quit`, `will-quit`, `quit`, `window-all-closed`,
  `activate`, `open-url`, `open-file`, `render-process-gone`, `child-process-gone`.
- **Process-level**: `uncaughtException`, `unhandledRejection`, `process exit`.
- **Per-window events**: `show`, `hide`, `focus`, `minimize`, `restore`, `closed`,
  `ready-to-show` (with surfacing decision), and `close` handler outcomes
  (`intercepted (hide-on-close)` vs `allowed (hideOnClose=…, allowQuit=…, …)`).
- **Re-surface handlers**: `activate (macOS) — surfacing main`, `second-instance — surfacing main`,
  `_ensureDockVisible — calling dock.show()` / `dock already visible`.

See `docs/logging.md` for the full reference.

### `mgr launch` — clean-env app launcher for manual smoke-testing

New CLI command that wraps `open -n .../MyApp.app` with the `ELECTRON_RUN_AS_NODE`
strip applied. Auto-discovers the produced .app/.exe under
`release/<platform>-<arch>/`, so a single `npx mgr launch` from your project root
launches the most recent `mgr package:quick` output. Forward argv to the app
via `--args="..."` (useful for simulating login launches:
`npx mgr launch --args="--em-launched-at-login"`).

Aliases: `mgr open`, `mgr --launch`.

The CLI entry point (`bin/electron-manager`) and gulp boundary already strip
`ELECTRON_RUN_AS_NODE`, so anything launched THROUGH `mgr` or `gulp` was already
clean. This command extends that protection to the manual-launch flow (where
people previously called `open -n` directly and hit the silent-exit symptom).

### Live signing monitor

- New `npx mgr runner monitor` subcommand on the Windows signing box. Pretty-prints a
  structured JSONL event log with timestamps, durations, byte counts, and color-coded
  status (yellow `→` start, green `✓` done, red `✗` fail, cyan boundaries for
  job-start/job-end). Run it in a separate PowerShell tab during a release to watch
  signtool jobs flow through in real time.
- `sign-windows` now emits structured events (`job-start`, `sign-start`, `sign-done`,
  `sign-fail`, `job-end`) to `<runner-workspace>/em-signing.log` (override path via
  `EM_SIGN_LOG=<path>`). The log persists across job runs — system of record after
  the GH Actions UI rolls off.
- Helper module `src/lib/sign-helpers/sign-events.js`.

### Installer / distribution config (new schema)

Comprehensive per-target installer config with sensible defaults across the board.
The generated `dist/electron-builder.yml` is now driven by:

- **`app.category`** (default `'productivity'`) — generic high-level category EM maps
  to per-platform values (Apple UTI for mac, freedesktop category for linux).
  Allowed: `productivity` | `developer-tools` | `utilities` | `media` | `social` | `network`.
- **`app.copyright`** with `{YEAR}` token (default `'© {YEAR}, ITW Creative Works'`).
  Token expansion happens at YAML generation time — string never goes stale.
- **`app.languages`** (default `['en']`) — applied as `mac.electronLanguages`.
- **`app.darkModeSupport`** (default `true`) — mac honors via `NSRequiresAquaSystemAppearance`.
- **`targets.win.{oneClick, desktopShortcut, startMenuShortcut, runAfterFinish, perMachine}`** —
  Slack-style frictionless install by default (oneClick:true, all shortcuts on, per-user).
- **`targets.win.arch`** — defaults to `['x64', 'ia32']`. Single multi-arch NSIS installer
  ships both 64-bit and 32-bit support. Toggle to `['x64']` to drop 32-bit.
- **`targets.linux.snap.*`** — opt-in Snap Store publishing. Set `enabled: true` and
  put `SNAPCRAFT_STORE_CREDENTIALS` in `.env` (run `snapcraft export-login -` to mint).
  CI workflow conditionally installs snapcraft only when enabled.
- **`targets.mac.mas.*`** — Mac App Store config keys exist but are STUBBED. Setting
  `enabled: true` triggers an audit warning. Reference plists from a working MAS app
  archived at `<em>/src/defaults/_mas/` for the future implementation.
- **`fileAssociations`** + **`protocols`** — optional passthrough fields for OS file-type
  registration + extra URL schemes. EM auto-registers `<brand.id>://` always; `protocols`
  is for additional schemes only. Empty by default — not emitted to YAML when unset.
- **Per-target `arch`** — `targets.{mac,win,linux}.arch` controls the architecture list
  for each platform's targets.

Full reference: `docs/installer-options.md` (new file).

Migration: existing consumers don't need to change anything — all the new fields have
defaults that match (or improve on) the previous behavior. The biggest visible change
is `targets.win.arch` now includes `ia32` — to drop, set it to `['x64']`. The other
default flip (NSIS `oneClick: true`) is consistent with how Slapform, Slack, Discord,
etc. ship; if you specifically want a wizard installer set `targets.win.oneClick: false`.

**Two BREAKING config-shape changes** (cleanups, easy to migrate):

1. `entitlements.mac` (top-level) → `targets.mac.entitlements`. Everything mac-related
   now lives under `targets.mac.*`.
2. `signing.windows.{strategy,cloud}` (top-level) → `targets.win.signing.{strategy,cloud}`.
   Same logic — Windows signing is purely a `targets.win` concern.

Consumers using either old path silently get EM's defaults until they move the keys
into the new location. This is unreleased v1 — migration cost is bounded; the cleaner
schema is worth not carrying the old paths forever. After moving:

```jsonc
// OLD                                       // NEW
entitlements: { mac: { ... } }               targets: { mac: { entitlements: { ... } } }
signing:      { windows: { strategy: ... }}  targets: { win: { signing:    { strategy: ... }}}
```

### Misc

- Comment-accuracy fix in `src/lib/storage.js` (the filename comment said `config.json`,
  the actual filename is `em-storage.json`).

## 1.2.25 — `npm run package:quick` for fast local production builds

Adds a quick-package path for testing production code paths locally without
the full DMG/zip/universal/notarize pipeline. ~20-30s vs ~3min for `package`.

- New gulp task `packageQuick` (delegates to `package-quick.js`).
- New `package:quick` projectScript injected by `mgr setup`.
- Output: `release/<platform>-<arch>/<ProductName>.app` (or `.exe`-folder/linux-unpacked).
  Skips DMG, zip, universal stitching, and notarization. Code signing still runs
  if the cert is in the keychain — the .app launches normally on the dev machine.

Use case: smoke-testing the production main bundle (config loading, packaged-mode
behavior, asar archive contents) without waiting for a full release build.

## 1.2.24 — exclude `logs/` from packaged app; force cmd for Windows build job

Two bugs surfaced when running v1.2.23's universal-mac build end-to-end:

### Mac universal-build failure: "Can't reconcile two non-macho files logs/dev.log"

Root cause: `@electron/universal` builds the universal binary by building x64
and arm64 separately and then merging the two app bundles. For non-mach-O
files (regular files like text/log/etc), it requires the two copies to be
byte-identical. Gulp writes `logs/dev.log` during each build, with different
content each time → merge fails.

Fix: exclude `logs/**` from the electron-builder `files` glob so log files
never make it into the bundle in the first place. They shouldn't have been
shipping to end users anyway — these are dev/build pipeline outputs.

### Windows build job: `npm ci` failing silently in PowerShell

v1.2.12 added `defaults.run.shell: cmd` to the windows-sign job (because
self-hosted runners often have PowerShell ExecutionPolicy=Restricted),
but the windows-build job (hosted runner) was left on its default shell
which is now PowerShell 7. PowerShell 7 wraps each step in a way that
`npm ci`'s output gets swallowed and exit non-zero with no error context.

Fix: explicit `shell: cmd` on every windows-only step in the build job.
mac/linux steps unaffected (the cmd shell is win-only; mac/linux ignore it
or substitute their default bash).

### Net effect

After this version, dp's release pipeline runs end-to-end on universal mac
without merge failures, and Windows-build doesn't silently drop dead at
`npm ci`. v1.2.23 was a real fix conceptually but couldn't ship because of
these two collateral issues.

## 1.2.23 — universal mac binary; mirror-downloads bug fixes

### One mac download, not two

Previously dp produced separate `-x64.dmg` and `-arm64.dmg` (Intel + Apple Silicon).
End users had to know which one their machine was. Switched mac default to
`arch: ['universal']` — one .dmg + one .zip that run on both, via electron-builder's
universal-binary support (Apple-blessed lipo stitch).

Trade-offs:
- File size: ~225MB instead of ~117MB single-arch (both binaries embedded)
- Build time: ~2x for the mac job (build both archs, then stitch)
- Win: ONE "Download for Mac" button. No user choice required.

Filenames after upgrade:
- `Deployment-Playground-1.0.8.dmg` (was `-x64.dmg` + `-arm64.dmg`)
- `Deployment-Playground-1.0.8-mac.zip` (was `-x64-mac.zip` + `-arm64-mac.zip`)

If a consumer wants to keep separate archs, they can override in their
`electronBuilder` config block: `mac: { target: [{ target: 'dmg', arch: ['x64', 'arm64'] }] }`.

### Mirror-downloads bug fixes

Two bugs in `mirror-downloads.stableName` caused stale assets on download-server
(some files 4+ days old while others were fresh):

1. **Linux `x86_64` AppImage misclassified as `ia32`**: arch detection used
   `lower.includes('-x86')` which matched `-x86_64` substring, returning ia32.
   Fixed with proper word-boundary regex + explicit `x86_64`/`amd64` matches first.

2. **Mac `.zip` not recognized after v1.2.19's artifactName change**: detection
   required the `mac.zip` substring, but v1.2.19's mac.artifactName produced
   `-x64.zip` / `-arm64.zip` (no `-mac` suffix). Fix in two places:
   - This release re-adds `-mac` suffix to mac.artifactName so existing detection works
   - Mirror's mac-zip detection now also accepts the no-suffix form (defensive)

After this version, a fresh release fully replaces all stable-name assets on
download-server (no more stale 4-day-old leftovers from misclassified naming).

### Final asset list per release (universal mac)

**update-server v{version}/**:
- `Deployment-Playground-{version}.dmg` (+ blockmap)
- `Deployment-Playground-{version}-mac.zip` (+ blockmap)
- `Deployment-Playground-Setup-{version}.exe` (+ blockmap)
- `Deployment-Playground-{version}-x86_64.AppImage`
- `Deployment-Playground-{version}-amd64.deb`
- `latest.yml`, `latest-mac.yml`, `latest-linux.yml`

**download-server installer/** (stable names):
- `Deployment-Playground.dmg`
- `Deployment-Playground-mac.zip`
- `Deployment-Playground-Setup.exe`
- `Deployment-Playground.AppImage`
- `deployment-playground_amd64.deb`

5 user-facing files instead of 7. Cleaner end-user surface.

## 1.2.22 — runtime logger writes to disk; `mgr logs` CLI

The runtime logger (`lib/logger-lite.js`) gains a file transport via [electron-log].
All three Electron processes (main + preload + renderer) now converge on a
single `runtime.log` file:

- **Dev** (`app.isPackaged === false`): `<projectRoot>/logs/runtime.log`
- **Prod** (`app.isPackaged === true`): `app.getPath('logs')/runtime.log` —
  i.e. `~/Library/Logs/<AppName>/runtime.log` on macOS,
  `%APPDATA%\<AppName>\logs\runtime.log` on Windows,
  `~/.config/<AppName>/logs/runtime.log` on Linux.

### How processes converge

- **Main**: writes directly to file via electron-log's file transport. Sets up
  an IPC listener on channel `em:log:forward` to receive forwarded calls from
  the other contexts.
- **Preload**: writes to console (DevTools) AND forwards each call via
  `ipcRenderer.send('em:log:forward', ...)` to main.
- **Renderer**: same as preload, exposed through `window.em.logger` so
  contextIsolated user code can use it without direct ipcRenderer access.
  `LoggerLite` in renderer also forwards via `window.em.ipc.send` if available.

All three end up in the same file with `[main|preload|renderer]` scope tags
so you can grep one context: `grep ' main ' logs/runtime.log`.

Format is `[YYYY-MM-DD HH:MM:SS.ms] [level] scope text`. File rotates at 10 MB
(→ `runtime.old.log`). Per-transport level overrides via env: `EM_LOG_LEVEL_FILE`,
`EM_LOG_LEVEL_CONSOLE` (defaults to `silly` everywhere).

### `npx mgr logs` command

New CLI for inspecting the runtime log from the consumer project root:

| Command | Effect |
|---|---|
| `npx mgr logs` | Print path + last 50 lines |
| `npx mgr logs --tail` (or `-f`) | Follow live (cross-platform; pure-Node `tail -f`) |
| `npx mgr logs --path` (or `-p`) | Print resolved path only (pipe-friendly) |
| `npx mgr logs --open` | Open in OS default editor |
| `npx mgr logs --lines=100` | Custom tail length for default mode |

### Programmatic path access

```js
const LoggerLite = require('electron-manager/lib/logger-lite');
LoggerLite.getLogFilePath();
// → '/Users/<user>/Library/Logs/MyApp/runtime.log' in prod
// → '<projectRoot>/logs/runtime.log' in dev
```

Useful for "send us your log" buttons or programmatic log shipping.

### Coexistence with dev.log + build.log

Three separate logs serve three separate purposes:

- `runtime.log` — packaged app runtime (this version)
- `dev.log` — gulp pipeline output (existing)
- `build.log` — CI release stream (existing)

Different rotation policies, different writers, different lifetimes — none of
them conflict. See `docs/logging.md` for the full picture.

### What changed

- New: `electron-log@^5.4.3` runtime dep
- New: `lib/logger-lite.js` rewritten — adds file transport + IPC forwarding
- New: `commands/logs.js` for the `mgr logs` CLI
- New: `docs/logging.md` full reference
- Updated: `preload.js` exposes a forwarding logger via contextBridge
- Updated: README + CLAUDE.md
- Tests: 14 new (logger-lite shape + serialization + tryForwardToMain; logs
  command path/default/lines flags)

[electron-log]: https://github.com/megahertz/electron-log

## 1.2.21 — `{{ app.version }}` in templating page vars

`buildPageVars` now exposes the consumer's `package.json` version as `app.version`,
so HTML templates can display the running build's version with `{{ app.version }}`.
Read at build time from `manager.getPackage('project')` — always matches the
exact version that was packaged, signed, and uploaded (same source-of-truth read).

If `config.app.version` is set explicitly in `electron-manager.json`, that wins;
otherwise the package.json version is used.

Useful for verifying auto-updates in the running UI without round-tripping IPC:
the value is baked into the HTML at build time.

## 1.2.20 — Windows auto-updater feed (latest.yml) generated post-sign

Closes the last gap in the Windows auto-update path. After signing the .exe,
`mgr sign-windows` now generates `latest.yml` (and a per-exe `.blockmap` for
delta updates) in the signed-output directory. `finalize-release` then
uploads them alongside the signed .exe to update-server.

### Why this had to happen

electron-builder generates `latest.yml` only as part of its publish flow.
Our pipeline signs Windows out-of-band (separate self-hosted runner,
EV USB token, signtool — see commands/sign-windows.js), so by the time we
have a signed binary, electron-builder is long gone and never wrote a yml.

The yml's `sha512` field MUST match the bytes of the signed binary —
generating it BEFORE signing would produce a hash that doesn't match the
final exe, and electron-updater would reject the update with a checksum
mismatch. So the only correct place to write it is right after signing,
which is what this version does.

### What's new

- `lib/sign-helpers/update-info.js` — pure module that computes sha512
  (raw bytes → base64), generates blockmap via `app-builder-bin`'s
  `blockmap` subcommand (best-effort; warns and skips if not resolvable
  — auto-updater still works without delta), and writes `latest.yml` in
  the canonical schema electron-updater expects.
- `commands/sign-windows.js` — after the signing loop, calls
  `writeUpdateInfo` for all signed `.exe` files. Failure is logged loudly
  but does not fail the sign step (signed binary is still valid).
- 11 new build-layer tests pinning sha512 base64 encoding, schema shape,
  end-to-end yml round-trip via real file IO, and error paths.

### Impact

After this version, a fresh `npm run release` from a Windows-EV-token
consumer produces a fully working auto-update path on Windows for the
first time. `latest.yml` is what electron-updater fetches from the GH
release to discover new versions; without it, Windows clients never see
new releases. Was the silent reason "draft → published" worked but no
Windows machine ever auto-updated.

## 1.2.19 — hyphenated artifact filenames across all platforms

`productName` containing a space (e.g. "Deployment Playground") was producing
inconsistent artifact filenames:

- mac dmg/zip used `${productName}-${version}-${arch}` → `Deployment Playground-1.0.6-arm64.dmg` (with literal space)
- nsis exe collapsed spaces to dots → `Deployment.Playground.Setup.1.0.6.exe`
- linux deb/AppImage varied per target

Fix: set `artifactName` on every target (mac/dmg/nsis/linux) using a sanitized
`safeProductName` where non-filename-safe chars become hyphens. All targets now
produce hyphenated filenames consistently, matching what `mirror-downloads`
already does for download-server stable names. After this:

- `Deployment-Playground-1.0.6-arm64.dmg`
- `Deployment-Playground-1.0.6-mac.zip`
- `Deployment-Playground-Setup-1.0.6.exe`
- `Deployment-Playground-1.0.6-x64.AppImage`
- `deployment-playground_1.0.6_amd64.deb` (Debian convention preserved)

## 1.2.18 — `/IT` flag on Logon Task so it binds to user's interactive session

Critical follow-up to 1.2.17. Without `/IT`, schtasks treats `/SC ONLOGON /RU
<user>` as a non-interactive batch logon — when the task runs, Windows creates
a fresh logon session for that user instead of binding to their already-active
desktop session. That fresh session has its own (empty) view of the user's
cert store and never loads the SafeNet eToken CSP, so `signtool` immediately
fails with "No certificates were found that met all the given criteria"
even though the same cert is visible in the user's actual desktop session.

Fix: pass `/IT` to `schtasks /Create`. `/IT` marks the task as interactive,
which means Windows binds it to the `/RU` user's existing logged-on session
at run time. Cert store, SafeNet driver state, and desktop access all flow
through, so `signtool` sees the cert and the SafeNet PIN dialog renders on
the visible desktop where automately can find and type into it.

Trade-off (already accepted): `/IT` tasks only run while the user is
interactively logged on. With Windows auto-logon configured (one-time setup),
this is a non-issue on a dedicated build box.

## 1.2.17 — `runner install` auto-starts the Logon Task

Follow-up to 1.2.16. After registering each per-org Logon Task, `register-org`
now also fires the task immediately via `schtasks /Run`, so the runner is
`online` on GitHub the moment install finishes — no need to log out and back
in to trigger the ONLOGON event. Previously every fresh install left runners
in `Ready, not Running` state and any queued workflow waited until the user
manually re-logged in or ran `npx mgr runner start`. Auto-start is best-effort:
if `/Run` fails (e.g. perms), we log a warning and leave registration intact;
the user can recover with `schtasks /Run /TN <name>` or by logging out + in.

Applies to both `mgr runner install` (multi-org) and `mgr runner register-org
<org>` (single-org), since the auto-start lives inside `registerOrg`.

## 1.2.16 — runner switched to Logon Task; workflow `platforms` input; draft-on-missing release

### Self-hosted runner: Windows Service → Logon Task

EV-token signing was the blocker for v1.2.13/14/15 — Windows Services run in
Session 0 (no desktop) and can't see the user's `CurrentUser\My` cert store
where SafeNet/eToken EV certs live, even when the service is configured to
run as the user account. The SafeNet "Token Logon" PIN dialog also requires
an interactive desktop to be typed into.

Fix: register each per-org runner as a **Scheduled Task running at logon in
the user's interactive Session 1**, instead of a Windows Service. Same EM
subcommands (`install`/`status`/`start`/`stop`/`uninstall`) — the underlying
mechanism is now Task Scheduler, not the Service Control Manager.

`runnerTaskName(org)` returns `em-runner-<host>-<org>`, matching the
GitHub-side runner name so log/debug correlation stays sane.

The legacy "service" terminology in user-facing strings is preserved where
it doesn't lie (still describes startup/shutdown/restart correctly), but
internals call them tasks.

### Workflow: `platforms` input for partial builds

`workflow_dispatch` now accepts a `platforms` input — comma-separated:
`all` (default), `mac`, `windows`, `linux`, or any combo. New `setup` job
resolves it into a JSON matrix consumed by `build` and per-platform booleans
consumed by `windows-strategy`/`windows-sign`. Lets you re-run JUST the
windows-sign half against an existing release without re-building mac/linux.

### `mgr release` adds `--platforms` flag

`npx mgr release --platforms windows` (or `--platform windows`) forwards
the value as a workflow input. Omitted = default = all platforms. Older
consumer workflows without the input declared continue to work unchanged.

### `finalize-release` creates a draft release if none exists

Previously failed with "Update-server release v1.0.0 not found" when a
partial-platform run kicked off windows-sign before mac/linux had created
the release. Now creates an empty draft if missing, so partial runs can
attach signed Windows assets and the next run fills in the rest. Draft
flips to published only by the `finalize` job once all expected platforms
have built.

## 1.2.15 — runner service runs AS the user (so signtool sees their cert store)

The runner service installed as `NT AUTHORITY\NETWORK SERVICE` by default, which
has its own (empty) Windows cert store. Signtool running under that identity
couldn't see EV USB-token certs imported under `CurrentUser\My`, so signing
failed with "No certificates were found that met all the given criteria"
even when WIN_EV_TOKEN_PATH was set correctly.

Fix: install the runner service to run as a specified Windows user account
via `config.cmd --windowslogonaccount <user> --windowslogonpassword <pass>`.

Three ways to supply credentials, priority order:
1. `WIN_RUNNER_LOGON_ACCOUNT` + `WIN_RUNNER_LOGON_PASSWORD` env vars (CI / .env)
2. DPAPI-encrypted file at `%APPDATA%\electron-manager\runner-logon.json`
3. Interactive prompt during `mgr runner install` (saves to DPAPI file for re-use)

If none of the above, falls back to NETWORK SERVICE (existing behavior).

New subcommand `mgr runner set-credentials` to update saved creds without
re-running install.

Note on security: the DPAPI-encrypted blob can only be decrypted by the same
user on the same machine. Even another admin on the box can't read it.

## 1.2.14 — _.env scaffold: actually include EV signing + EM test keys in Default

v1.2.13 claimed to add `WIN_EV_TOKEN_PATH` / `WIN_CSC_KEY_PASSWORD` / `SIGNTOOL_PATH`
to the default `.env` scaffold but the edit didn't land in `src/defaults/_.env`
(only in the changelog). v1.2.14 actually adds them.

Also moved `EM_TEST_FIREBASE_ADMIN_KEY` and `EM_TEST_USER_UID` from where they
ended up (Custom section, by accident) to Default — they're EM test framework
keys, not user-custom values. Custom section is now empty for new projects.

## 1.2.13 — windows EV signing: wire WIN_EV_TOKEN_PATH / WIN_CSC_KEY_PASSWORD / SIGNTOOL_PATH

Self-hosted Windows EV-token signing was broken end-to-end: the consumer's `.env`
scaffold didn't include the EV signing vars, and the `windows-sign` workflow job
didn't map them from secrets to the job env. Result: `npx mgr sign-windows` ran
but immediately threw "WIN_EV_TOKEN_PATH (or WIN_CSC_LINK) not set — cannot sign."

The old comment in `_.env` claimed signtool credentials "live on the runner machine
itself, not in the consumer's .env" — but the runner runs as `NT AUTHORITY\NETWORK
SERVICE` which doesn't read user-profile env files. The vars HAVE to be plumbed
through GH Actions secrets to reach the job.

Fixes:
1. Added `WIN_EV_TOKEN_PATH`, `WIN_CSC_KEY_PASSWORD`, `SIGNTOOL_PATH` to the default
   `_.env` scaffold (Default section, so `npx mgr push-secrets` picks them up).
2. Added the same three vars to the `windows-sign` job's `env:` block, mapped from
   `secrets.*`. Cloud-provider vars stay in place for when strategy=cloud.
3. Updated `_.env` doc comment to point at `Get-ChildItem Cert:\CurrentUser\My`
   for finding the cert thumbprint (which is what `WIN_EV_TOKEN_PATH` should be —
   signtool's `/sha1` selector matches by thumbprint).

After upgrade, consumers fill `WIN_EV_TOKEN_PATH` (cert thumbprint),
`WIN_CSC_KEY_PASSWORD` (SafeNet token PIN), and `SIGNTOOL_PATH` (full path to
signtool.exe on the runner host) in their `.env` Default section, then run
`npx mgr push-secrets` to push them to GH Actions secrets. The next workflow
run will sign successfully.

## 1.2.12 — workflow: windows-sign job uses cmd.exe (not PowerShell)

Self-hosted Windows runners commonly have PowerShell ExecutionPolicy set to
Restricted, which blocks the wrapper `.ps1` scripts GitHub Actions auto-
generates for every `run:` step:

> File ...c89a6a95-758b-4457-85e9-29bff742cffe.ps1 cannot be loaded because
> running scripts is disabled on this system.

Fix: pin `defaults.run.shell: cmd` for the windows-sign job. cmd.exe has no
ExecutionPolicy and runs the same `npm ci` / `npx ...` commands fine.

The hosted-runner jobs (build matrix) keep PowerShell as their default
because hosted runners ship with `RemoteSigned` policy already configured.

## 1.2.11 — runner: install to C:\actions-runners (escape user profile entirely)

v1.2.10 tried to fix the NETWORK SERVICE permission issue by walking up
ancestors with icacls — but it stopped AT `%USERPROFILE%` (don't grant
broader than needed). actions/runner walks `C:\Users\<user>` itself,
which still denied → still crashed.

Cleaner fix: install runners to `C:\actions-runners\` by default on Windows
instead of `<EM-clone>/.gh-runners`. NETWORK SERVICE has read access to
`C:\` by default, so no icacls walk is needed. The path's also shorter,
which helps with Windows MAX_PATH issues on deep node_modules trees inside
`_work/`.

Override via `EM_RUNNER_HOME` if you genuinely want it elsewhere.

Existing user-profile installs need to be uninstalled before upgrading:
`npx mgr runner uninstall && npx mgr runner install`.

(The icacls grant on the runner dir itself is kept for safety, but no longer
walks ancestors.)

## 1.2.10 — runner: grant NETWORK SERVICE access to runner dir + ancestors

The runner service runs as `NT AUTHORITY\NETWORK SERVICE` by default (no
explicit `--windowslogonaccount`). When the install path lives under the user
profile (e.g. `C:\Users\<user>\Documents\.../.gh-runners`) NETWORK SERVICE has
no read access, and the runner crashes at startup with:

> System.UnauthorizedAccessException: Access to the path '...\.gh-runners' is denied.

actions/runner's `ValidateExecutePermission` walks the entire path hierarchy
on startup, so granting access only on the runner dir isn't enough — every
ancestor up to the user profile must be traversable by NETWORK SERVICE.

Fix: after cloning the runner template into the per-org dir, run `icacls`:
1. Recursive `(OI)(CI)(RX)` on the runner dir itself.
2. Non-recursive `(RX)` on every ancestor up to `%USERPROFILE%` (stops there
   to avoid exposing siblings).

After this, the service starts cleanly and the runner shows as **online** at
GitHub instead of registering then immediately crashing.

## 1.2.9 — runner: delete stale runners before re-register, mirror: hyphen-separated names

### Runner: delete stale GitHub-side runners before re-registering

Re-running `mgr runner install` was leaving accumulated dead runners on the
GitHub org side. Each failed install left an offline runner behind. Each
subsequent install hit "A runner exists with the same name" and actions/runner
auto-suffixed the new name (e.g. `em-runner-...-deployment-p-2872`). The
service was created with the suffixed name, but EM's verify step expected the
clean name and threw "no service was created."

Fix: BEFORE register, list all runners on the org and delete any whose name
starts with `em-runner-<hostname>-<org>` (our convention). Conservative match
prefix means we never touch user-created runners or runners from other hosts.
Re-register then gets the clean name.

Also: the post-install service verify now matches `actions.runner.<org>.*`
instead of pinning the exact name, so even if a suffix slips through, it's
recognized.

### Mirror: hyphenated product names in stable filenames

`mirror-downloads.stableName` was stripping spaces from product names entirely:
`Deployment Playground` → `DeploymentPlayground.dmg`. Switched to replacing
non-filename-safe chars with hyphens: → `Deployment-Playground.dmg`. Matches
both common convention and what's already on update-server's electron-builder
artifacts (e.g. `Deployment-Playground-1.0.1-arm64.dmg`).

Naming examples for `productName: "Deployment Playground"`:

- `Deployment-Playground.dmg` (was `DeploymentPlayground.dmg`)
- `Deployment-Playground-Setup.exe` (was `DeploymentPlaygroundSetup.exe`)
- `Deployment-Playground.AppImage`
- `deployment-playground_amd64.deb` (lowercase + underscore per Debian convention, unchanged)

## 1.2.8 — runner install: stdio inherit so service install actually runs

The piped-stdio capture in v1.2.7 (and every prior version) was the reason
`config.cmd --runasservice` SILENTLY SKIPPED the service-creation step.
When Node's spawnSync captures stdout/stderr via pipes, the child sees no
console, and actions/runner's --runasservice path treats that as "non-
interactive, skip the service install."

Verified by running config.cmd directly from cmd.exe (inherited stdio): the
runner banner + "Service ... successfully installed" / "started successfully"
messages all printed and the service was actually created.

Fix: `stdio: 'inherit'` for the config.cmd spawn. The runner's banner and
progress now stream straight to the user's terminal during install (which
is fine — it looks like running it manually) and the service actually gets
created.

Side-effect: we lose the ability to capture stdout/stderr for surfacing in
error messages on non-zero exit. That's a fair trade — the inherited output
is right there in the terminal so the user can read it directly.

## 1.2.7 — runner install nukes per-org dirs before re-cloning (FOR REAL this time)

The actual root cause of all the runner-install failures: `mgr runner install`
was reusing per-org runner directories if `config.cmd` already existed in them
(this was meant to be an "idempotent skip if already cloned" optimization).
But once a runner has been registered, the dir contains `.runner`, `.credentials`,
and `_diag/` — actions/runner sees these and refuses to re-configure with:

> Cannot configure the runner because it is already configured. To reconfigure
> the runner, run 'config.cmd remove' or './config.sh remove' first.

So every "re-install" silently failed: config.cmd exited non-zero, no service
was ever created, but the registration call to GitHub had already happened
(or not — depending on order of operations).

Fix: always wipe the per-org dir before cloning from `_template`. An "install"
should always produce a fully-fresh state. Cost: ~2-3s extra per org (jetpack
remove + copy of ~120MB). Tradeoff is worth it — the previous "smart" reuse
made install completely unreliable on re-runs.

Also reverts the v1.2.5/v1.2.6 confusion around `svc.cmd`. Verified by hand:
`config.cmd --runasservice` from an elevated shell runs the full register +
service install + service start sequence in one shot. No separate `svc.cmd
install` step is needed. Windows runners don't ship `svc.cmd` at all — that
was an incorrect assumption from the v1.2.5 attempt.

Added a post-config sanity check that runs `sc query actions.runner.<org>.<name>`
and throws with a clear "not running as Administrator?" error if the service
doesn't exist after config.cmd succeeds.

## 1.2.6 — runner service install: actually correct this time

v1.2.5 dropped `--runasservice` from `config.cmd` and tried to call
`svc.cmd install` afterward. Problem: `svc.cmd` is GENERATED by `config.cmd`
ONLY when `--runasservice` is passed. Without it, the file never exists, and
every per-org service install failed with "svc.cmd is not recognized."

Correct flow (verified against actions/runner README):

1. `config.cmd --unattended ... --runasservice` — registers with GitHub AND
   drops `svc.cmd` into the runner dir. The `--runasservice` flag's "install
   the service" side-effect is what's silently skipped without explicit
   `--windowslogonaccount` creds, but its "drop svc.cmd helper scripts"
   side-effect always runs.
2. `svc.cmd install` — explicitly install the service. Defaults identity to
   `NT AUTHORITY\NETWORK SERVICE` (no creds needed). Requires admin.
3. `svc.cmd start` — start it.

Also: explicit existence check after step 1 — if `svc.cmd` is missing, throw
a clear error pointing at admin/elevation rather than leaving the user with
registered-but-orphaned runners.

## 1.2.5 — runner service install fix, status output overhaul, release spinner

### Critical fix: `npx mgr runner install` now actually installs the Windows services

The previous install flow registered each org's runner with GitHub via `config.cmd
--runasservice` — but `--runasservice` is silently ignored by actions/runner
unless `--windowslogonaccount` and `--windowslogonpassword` are also provided.
Result: every install since v1.0.0 created the registrations on GitHub's side
but **left zero Windows services** to actually run them. The runner showed up
in GH for ~30s then went offline because nothing was running it locally.

Switched to the explicit two-step flow:
1. `config.cmd --unattended --url ... --token ...` (without `--runasservice`)
2. `svc.cmd install` — creates the Windows service for that registration
3. `svc.cmd start` — starts it

After v1.2.5, `Get-Service actions.runner.*` should show one running service per
registered org. Before v1.2.5, that command returned nothing.

**Action required on Windows runner host**: re-run `npx mgr runner install` to
pick up the fix. Existing registrations will be uninstalled and re-created with
the missing service install step now included.

### `npx mgr runner status` output overhaul

Was uninformative — called `sc query actions.runner` (not a real service) and
just dumped 1060 errors. Now enumerates all `actions.runner.*` services on the
machine, prints each with state (RUNNING / STOPPED / NOT_INSTALLED) + a status
icon, and clearly tells you to run `install` if no services exist.

`start` and `stop` were similarly broken — now iterate over the discovered
services and emit one line per service with success/failure.

### `npx mgr release` spinner + elapsed + poll counter

Was static between log dumps (poll every 5s, terminal looked frozen for minutes
at a time when no new logs were emitting). Added an animated spinner line at
the bottom that tick at 250ms with: spinner frame, current run status, elapsed
time, poll count, and per-job symbols. Spinner clears before any real log line
prints, then re-renders. TTY-only — falls back to silent in non-TTY contexts
(CI logs, file output).

## 1.2.4 — silent octokit during release stream

`getOctokit({ silent: true })` passes a no-op logger to octokit so transient
404s during `mgr release` polling (in-progress jobs return 404 for log
endpoints until each step completes) don't spam the console. Errors still
surface via thrown rejections.

Cosmetic-only fix — the actual release flow worked end-to-end in v1.2.3.

## 1.2.3 — `npm run release` now triggers CI + streams logs locally

### `npm run release` redefined: trigger CI, stream logs, exit on success

Inspired by browser-extension-manager's local-feels-cloud release flow. Running
`npm run release` (or `npx mgr release`) in a consumer project now:

1. Discovers `owner/repo` from `package.json#repository.url` (falls back to
   `git remote get-url origin`).
2. POSTs `workflow_dispatch` to `<owner>/<repo>` workflow `build.yml` on the
   current git branch (override via `--ref`).
3. Polls every 5s for the new run, then for each job's logs as soon as they
   become fetchable (GH only exposes logs after each step completes — so the
   "stream" is a polite fiction, but a useful one).
4. Prints job-prefixed log lines as they arrive AND tees the full log
   (ANSI-stripped) to `logs/build.log`.
5. Exits 0 on success, 1 on any job failure.

The OLD `npm run release` behavior (local sign + notarize + publish from the
dev's own machine) is preserved as `npm run release:local` for the rare case
you actually want it.

`projectScripts` updated:
- `release` → `npx mgr release` (NEW — triggers CI)
- `release:local` → the old in-process release (signs + publishes locally)
- `package` → `npx cross-env EM_BUILD_MODE=true npm run gulp -- packageBuild`
  (build + electron-builder package, NO publish — used by Windows CI runner)

### CI workflow fixes (uncovered by run #2 in deployment-playground)

- **Windows job now runs `npm run package`** instead of `npm run build`.
  `gulp build` only compiles bundles — it doesn't run `electron-builder`, so
  the previous workflow produced no `release/*.exe` to upload as artifact.
  Switched to `gulp packageBuild` (build + package, no publish).
- **`windows-strategy` job now runs `npm ci`** before requiring `json5` to
  parse the consumer config. Previously it called `node -e "require('json5')"`
  on a freshly-checked-out repo with no node_modules, which crashed with
  MODULE_NOT_FOUND. The job needs full deps to read the JSON5 config without
  resorting to regex.
- **Mac/linux jobs now run `npm run release:local`** instead of
  `npm run release` (the new `release` script triggers CI — using it inside
  CI would be infinite recursion).

## 1.2.2 — fix mac entitlements path + windows env syntax

### Bugfixes uncovered by first end-to-end CI run

- **`build/entitlements.mac.plist: cannot read entitlement data`** — The
  generated `dist/electron-builder.yml` had path `build/entitlements.mac.plist`
  meant as project-relative, but `gulp/build-config.js`'s `rel()` helper was
  resolving it relative to `distRoot` instead of `projectRoot`. electron-builder
  reads paths from cwd (which is projectRoot), so codesign was looking at
  `<project>/build/entitlements.mac.plist` (doesn't exist) instead of
  `<project>/dist/build/entitlements.mac.plist`. Fixed by passing `projectRoot`
  through to `baseConfig()` and preferring it for relative path resolution.
- **`'EM_BUILD_MODE' is not recognized as an internal or external command`**
  on the Windows CI runner — cmd.exe doesn't accept the unix `VAR=value cmd`
  prefix. Switched the consumer-injected `projectScripts.{build,publish,release}`
  to `npx cross-env EM_BUILD_MODE=true ...`. Added `cross-env` as an EM dep
  (pulled in transitively, so `npx cross-env` works without consumer pkg.json
  changes).

## 1.2.1 — release pipeline finalize, manual-trigger workflow, CI test fixes

### Release pipeline — closes the v1.2.0 gap

- **Manual-trigger only** — `src/defaults/.github/workflows/build.yml` now uses
  `on: workflow_dispatch` only. Was triggering on every push to `main` which
  burned self-hosted Windows runner cycles for no reason.
- **Signed Windows binaries now reach the update-server release.** Previously
  `windows-sign` job uploaded via `softprops/action-gh-release@v2` gated on
  `startsWith(github.ref, 'refs/tags/')` — a gate that never fired since the
  workflow doesn't trigger on tag push. Replaced with a deterministic
  `npx mgr finalize-release --signed-dir release/signed` step that finds the
  release by `v${version}` and uploads via Octokit. Idempotent (clobbers
  existing assets with the same name).
- **Windows binaries also mirror to download-server.** Same finalize step
  uploads signed `.exe` to the consumer's `download-server@installer` tag with
  stable filenames (e.g. `Deployment-Playground-Setup.exe`) so marketing
  links never change. Mac/linux already mirrored via `gulp mirror-downloads`
  in their `npm run release` step; windows now matches.
- **Auto-updater feeds (latest.yml / latest-mac.yml / latest-linux.yml) and
  blockmaps are uploaded too** — windows-sign now signs + re-uploads the
  feed metadata so electron-updater can serve it from the same release.
- **Final "ensure published" job** flips the update-server release from
  Draft→Published via `npx mgr finalize-release --publish`. Also sanity-checks
  that all 3 auto-updater feeds are present and prints the release URL.

### `mgr finalize-release` command

New CLI command, two modes:

- `--signed-dir <path>` — upload signed Windows artifacts to update-server
  release (matched by `v${pkg.version}`), then mirror to download-server.
- `--publish` — flip update-server release Draft→Published, sanity-check
  auto-updater feeds.

Reads `config.releases.{owner,repo}` and `config.downloads.{owner,repo,tag}` —
falls back to the consumer's own GitHub owner if not set.

### CI test fixes

- **Audit suite no longer leaks publish-mode env into minimal scaffolds.**
  Workflow sets `EM_BUILD_MODE=true EM_IS_PUBLISH=true` globally — audit
  tests now explicitly clear those before running so they don't fail
  `brand.images.icon` file-existence checks against synthetic configs.
- **`tar can extract zip` test skips on Linux.** GNU tar doesn't support
  zip extraction; the production code path (Windows runner install) only
  ever runs on Windows where bsdtar handles zip natively. macOS also runs
  the test as smoke (bsdtar there too).

## 1.2.0 — windows rewrite, inset titlebar, hide-on-close, boot harness fixes

### Windows — lazy creation + inset titlebar + Discord-style hide-on-close

- **EM no longer auto-creates the main window.** Boot sequence step 13 (the old
  `createNamed('main')`) is gone. The consumer's `main.js` calls
  `manager.windows.create('main')` from inside `manager.initialize().then(() => { ... })`
  — typically gated on `if (!startup.isLaunchHidden())` so the same `main.js`
  works for both `'normal'` and `'hidden'` launch modes.
- **`manager.windows.create(name, overrides?)`** is the canonical entry point.
  Defaults baked in (no JSON config required):
  - `main` → `{ width: 1024, height: 720, hideOnClose: true,  view: 'main' }`
  - any other → `{ width: 800,  height: 600, hideOnClose: false, view: name   }`
  - merge order: framework defaults < `config.windows.<name>` < call-site overrides
- **Inset titlebar by default**:
  - macOS: `titleBarStyle: 'hiddenInset'` — OS-drawn traffic lights inset into
    the chrome region.
  - Windows: `titleBarStyle: 'hidden'` + `titleBarOverlay: { color, symbolColor,
    height: 36 }` — OS-drawn min/max/close buttons in the corner.
  - Linux: native frame.
  - Override per-window via `config.windows.<name>.titleBar = 'inset' | 'native'`
    or pass a custom `titleBarOverlay` object.
- **Page template moved to EM-internal** (`src/config/page-template.html`,
  copied to `dist/config/page-template.html` by prepare-package). Consumer's
  `<consumer>/config/page-template.html` is no longer read.
- **Draggable topbar in template** — `<div class="em-titlebar"><div
  class="em-titlebar__drag"></div></div>` with `-webkit-app-region: drag`.
  Sized per-platform via `themes/classy/css/components/_titlebar.scss` keyed off
  `html[data-platform]` (set by web-manager): mac → `padding-left: 70px`
  (clear traffic lights), windows → `padding-right: 140px` (clear native
  overlay), linux → `display: none` (native frame draws title bar).
- **Discord-style hide-on-close.** `main` window's X button hides instead of
  closes. Real quit only via Cmd+Q / role:'quit' menu / tray Quit / auto-updater
  install / programmatic `manager.quit({ force: true })`. Three escape hatches
  in the close handler:
  - `manager._allowQuit` — set by `manager.quit({ force: true })` and by
    `autoUpdater.installNow()` before `quitAndInstall()`.
  - `manager._isQuitting` — set by `app.on('before-quit')`, so any quit path
    Electron knows about (Cmd+Q, role:'quit' menu, programmatic `app.quit()`,
    OS shutdown) flows through naturally.
  - `win._emForceClose` — per-window override for one-off "close this for real"
    scenarios.
- **`manager.quit({ force })`** and **`manager.relaunch({ force })`** exposed on
  the live manager. `relaunch()` calls `autoUpdater.installNow()` if an update
  is downloaded, otherwise `app.relaunch() + app.quit()`.

### Auto-update background install (legacy parity)

- When a download finishes (`code: 'downloaded'`) AND the check was NOT
  user-initiated (background poll), `_setState` schedules `installNow()` after
  5s. User-initiated checks skip this so the consumer's UI can prompt instead.
  Apps update overnight without bothering the user — Discord-style.

### macOS dock auto-show

- `manager.windows.create()` and `manager.windows.show()` call `app.dock.show()`
  if the dock is hidden (LSUIElement parity). Apps with `startup.mode = 'hidden'`
  launch completely invisible (no dock icon, no Cmd+Tab, no taskbar) — the dock
  icon appears the moment UI is requested.

### Startup mode simplified

- **Removed `'tray-only'`** — was always identical to `'hidden'` (the same
  LSUIElement Info.plist flag). Now folded into `'hidden'`. `getMode()`
  validation rejects `'tray-only'` as unknown and falls back to `'normal'`.
- LSUIElement injection in `gulp/build-config` now keys off `startup.mode === 'hidden'`.
- `startup.isTrayOnly()` removed.

### Default config simplification

- **Removed `windows: {}` block** from defaults config. Windows are now driven
  entirely from `main.js`. Consumer adds the block back only to override
  defaults persistently.
- **Removed `<consumer>/config/page-template.html`** — replaced by
  EM-internal template at `<em>/dist/config/page-template.html`.

### Bug fixes

- **`createNamed` listener-attach order**: all event listeners (`close` /
  `closed` / `resize` / `move` / `ready-to-show` / etc.) now attach BEFORE
  `await loadFile()`. Previously the window could land in the registry but be
  missing listeners during the ms-window between BrowserWindow construction
  and load completion — boot tests + race-prone code would see inconsistent
  state.
- **`config.x` / `config.y` from overrides** now actually flow through to
  BrowserWindow opts. Was silently dropped.

### Boot harness improvements

- Harness defers via `setImmediate` so the consumer's `manager.initialize().then(...)`
  callback runs first (giving `windows.create('main')` time to fire).
- Polls for the main window for up to 3s before starting tests (handles the
  async portion of `windows.create()`).
- Exposes `require` / `process` / `Buffer` to inspect-fn bodies via
  `new Function` arg list (closures don't survive serialization).

### Tests

- **397 framework + 26 consumer boot tests** (was 397 + 25). New tests:
  X-button close behavior, manager.quit/relaunch, autoUpdater installNow flag,
  background install scheduling, page-template EM-internal verification, lazy
  windows.create, defaults-merge-overrides ordering, dock-show wired, startup
  mode validation rejecting tray-only, x/y flowing through overrides.

### Default scaffold polish

- `src/defaults/src/main.js` — three labeled sections with full `windows.create()`
  options reference inline (every supported opt commented with default value)
  + custom-logic examples (deep links, IPC handlers, `manager.<name>.disable()`,
  auto-update onStatus, app-state).
- `src/defaults/src/views/main/index.html` — bootstrap container + lead text +
  two action buttons (replaced the bare `<h1>` placeholder).

### Docs

- **CLAUDE.md** — boot sequence rewritten (added `before-quit` hook, removed
  auto-create), new "Windows (lazy creation, inset titlebar, Discord-style
  hide-on-close)" section, "Notable defaults" updates for windows/startup/titlebar.
- **README.md** — new bullets covering lazy windows + Discord-style hide-on-close,
  zero-bounce hidden launch, auto-update background install. Docs index updated.
- **docs/windows.md** — full rewrite with defaults, merge order, inset titlebar,
  hide-on-close escape hatches, dock auto-show, listener-attach guarantee.
- **docs/startup.md** — full rewrite with `'normal' | 'hidden'` only, typical
  main.js pattern, agent-app pairing.

## 1.1.0 — integrations rewrite, boot test layer, scaffold simplification

### Integrations (tray / menu / context-menu) — unified API

- **Shared id-path mutation API across all three libs** (`src/lib/_menu-mixin.js`):
  `find`, `has`, `update`, `remove`, `enable`, `show`, `hide`, `insertBefore`,
  `insertAfter`, `appendTo`. Available both during definition (on the builder arg)
  and at runtime via `manager.{tray,menu,contextMenu}.*`.
- **All three ship sensible default templates** with stable id-tagged items so
  consumers can target any default item with a single line. Defaults informed by
  legacy electron-manager:
  - **Menu**: full template with `main/about`, `main/check-for-updates`,
    `main/preferences` (hidden), `main/relaunch`, `main/quit` (mac App menu),
    `file/preferences` / `file/relaunch` / `file/quit` (win/linux), standard
    `edit/*` and `view/*`, plus dev-only `view/developer/*` submenu
    (toggle-devtools, inspect-elements, force-reload) and dev-only
    `development/*` top-level (open-exe-folder, open-user-data, open-logs,
    open-app-config, throw test-error). `help/website` auto-added when
    `brand.url` is configured.
  - **Tray**: `title`, `open`, `check-for-updates`, `website`, `quit` (flat ids).
  - **Context-menu**: `undo`/`redo` (gated on `editFlags.canUndo`/`canRedo`),
    `cut`/`copy`/`paste`/`paste-and-match-style`/`select-all` (when editable),
    `open-link`/`copy-link` (when on link), `reload` (always),
    `inspect`/`toggle-devtools` (dev only).
- **Tray auto-resolves icon + tooltip** when not explicitly set. Icon waterfall:
  `app.icons.tray<Platform>` config → `<root>/dist/build/icons/<platform>/<file>`
  (populated by `gulp/build-config`) → consumer file convention. Tooltip falls
  back to `app.productName`. Consumer `src/integrations/tray/index.js` is now
  truly optional.
- **Auto-updater menu+tray hook** — patches both `manager.menu` (`main/check-for-updates`
  on mac, `help/check-for-updates` on win/linux) AND `manager.tray`
  (`check-for-updates`) in lockstep. Label updates dynamically based on update
  status (Checking → Downloading 42% → Restart to Update v1.2.3 → You're up to
  date).
- **Default scaffolds reduced to `useDefaults()` + commented-out examples** —
  `src/defaults/src/integrations/{tray,menu,context-menu}/index.js` now show
  every customization API as commented examples; consumer files don't drift from
  EM defaults until the user explicitly uncomments. Scaffolds moved from
  `src/defaults/src/{tray,menu,context-menu}/` to
  `src/defaults/src/integrations/{tray,menu,context-menu}/`.

### Boot test layer (new)

- **New `boot` test layer** that spawns a real Electron process running the
  consumer's actual built `dist/main.bundle.js` (the production main entry),
  waits for `manager.initialize()` to resolve, runs each test's `inspect(manager)`
  callback against the live runtime, then `app.exit()`s cleanly. Replaces
  shell-level `npm start && sleep && kill` smoke tests with deterministic,
  signal-driven pass/fail.
- Test shape: `{ layer: 'boot', description, timeout, inspect: async ({ manager,
  expect, projectRoot }) => { ... } }`. Inspect bodies are serialized via
  `Function.prototype.toString` and reconstituted in the spawned process —
  same trick as the renderer-suite harness uses.
- **Always rebuilds `dist/main.bundle.js` before running** so tests never see
  stale code (~10s build cost; opt out with `EM_TEST_SKIP_BUILD=1` for CI). Uses
  the same gulp pipeline `npm run build` does.
- Test runner strips `ELECTRON_RUN_AS_NODE` from the child env (matches
  `gulp/serve`'s existing fix) so electron starts in main-process mode regardless
  of the surrounding shell. Without this, electron silently boots as plain Node
  with no `ipcMain` API.
- Plumbing: `EM_TEST_BOOT=1` / `EM_TEST_BOOT_HARNESS=<path>` /
  `EM_TEST_BOOT_SPEC=<path>` env vars; harness in `src/test/harness/boot-entry.js`,
  runner in `src/test/runners/boot.js`. EM's `main.js` opts in via
  `__non_webpack_require__` (typeof-guarded) so the harness loads at runtime
  without webpack inlining test code into production bundles.
- Full docs: [docs/test-boot-layer.md](docs/test-boot-layer.md).

### Quick-mode setup (UJM parity)

- **`Manager.isQuickMode()`** — env-var (`EM_QUICK=true`) OR CLI flag (`--quick` /
  `-q`). When set, skips slow/network-bound setup operations: `checkManager` (npm
  registry hit), `checkNode` (Electron releases feed), `checkPeerDependencies`
  (npm install), `validateCerts` (Keychain), `provisionRepos` (GitHub API),
  `pushSecrets` (GitHub API).
- `npx mgr clean` short-circuits when bundle exists in quick mode (incremental
  inner-loop dev — first run still does a full clean).
- Mirrors UJM's exact pattern (`UJ_QUICK=true`).

### Default config simplification (continued from 1.0.7)

- **Removed redundant config blocks** from `src/defaults/config/electron-manager.json`:
  - `tray`, `menu`, `contextMenu` blocks gone — paths are conventional
    (`src/integrations/<name>/index.js`); disable via `manager.<name>.disable()`.
  - `deepLinks` block gone — scheme always derived from `brand.id`; routes
    registered at runtime via `manager.deepLink.on()`.
  - `em` block (environment, cacheBreaker, liveReloadPort) — all derivable.
- **Auto-derived defaults** in `Manager.getConfig()`:
  - `app.appId` ← `com.itwcreativeworks.${brand.id}` if not set
  - `app.productName` ← `brand.name` if not set
- `app.icons` block is the only icon configuration surface (3-tier waterfall:
  config → `<root>/config/icons/<platform>/<file>` → EM bundled default).
- **`startup.openAtLogin` is now an object**: `{ enabled, mode }`. The mode
  applies ONLY when the OS auto-launches at login; user-direct launches always
  use `startup.mode`. Force-OFF in dev (uses `app.isPackaged`) so dev runs don't
  pollute login items — set `EM_FORCE_LOGIN_ITEM=1` to override.
- **`signing.windows.strategy` is config-only** (no env-var override) — the GH
  Actions workflow has a `windows-strategy` job that reads the JSON5 config to
  drive runner selection + job gating.

### Build pipeline

- **`electron-builder.yml` is now generated**, not consumer-shipped.
  `gulp/build-config` writes `dist/electron-builder.yml` from EM defaults +
  `config/electron-manager.json`. Override defaults via `electronBuilder:` block
  in `electron-manager.json` only if you genuinely need to.
- **`dist/build/entitlements.mac.plist` is generated** at build time from
  EM defaults + consumer `entitlements.mac` overrides (object map: `null` removes
  a default). Implementation in `src/lib/sign-helpers/entitlements.js`.
- **3-tier icon resolution waterfall** for build artifacts in
  `src/lib/sign-helpers/resolve-icons.js`. Resolved icons copied to
  `dist/build/icons/<platform>/`. `@2x` retina auto-paired from `@1x`.
  Linux follows the windows chain. Windows tray slot falls back to Windows app
  icon when no tray-specific source resolves.
- **Stable download names** for the marketing-mirror download server: `Somiibo.dmg`,
  `Somiibo-Setup.exe`, `somiibo_amd64.deb`, `Somiibo.AppImage`. Apple Silicon
  variant gets `-arm64` suffix. Implementation in `gulp/mirror-downloads.js`.
- **Dynamic Node version templating** — `setup.js` writes `.nvmrc` and renders
  template tokens (`{{ versions.node }}`) in `.github/workflows/build.yml` from
  EM's `package.json#engines.node`. Auto-syncs to whatever Electron's bundled
  Node version is (`scripts/sync-nvmrc.js`).

### BXM-pattern scaffold entries

- All consumer-side scaffold entries (`src/main.js`, `src/preload.js`,
  `src/assets/js/components/*/index.js`) now use the BXM pattern:
  ```js
  const Manager = require('electron-manager/main');
  const manager = new Manager();
  manager.initialize().then(() => { /* custom logic */ });
  ```

### Tests

- **401 passing** (was 358). Includes: `_menu-mixin` (id-path utility), `entitlements`
  (plist generation + override merging), `resolve-icons` (3-tier waterfall +
  retina pairing), `get-config` (derived defaults), id-path API across tray /
  menu / context-menu (find/has/update/remove/enable/show/hide/insertBefore/
  insertAfter/appendTo), legacy-derived defaults (undo/redo, paste-and-match-style,
  reload, dev-only menus), tray auto-icon-resolution + auto-tooltip, and the new
  boot smoke layer.

### Docs

- New: [docs/test-boot-layer.md](docs/test-boot-layer.md).
- Rewritten with new flat ids + full id-path API + default item tables:
  [docs/tray.md](docs/tray.md), [docs/menu.md](docs/menu.md),
  [docs/context-menu.md](docs/context-menu.md).
- [CLAUDE.md](CLAUDE.md): comprehensive new "File-based feature definitions"
  section (id-path API, naming convention, default item set, four test layers).
- [README.md](README.md): updated bullets to call out id-tagged defaults +
  mutation API + four test layers including boot.

## 1.0.6 — runner improvements (final 1.0.x patch)

- Per-org actions-runner installs + capture spawn errors.

## 1.0.5

- curl download, admin check, robust uninstall.

## 1.0.4

- Rename `runner bootstrap` → `runner install`.

## 1.0.3

- Bootstrap idempotency, tar extract, dedup error log, scope docs.

## 1.0.2

- Replace tasklist poll with `automately.getWindows`.

## 1.0.1

- SafeNet eToken thumbprint mode + auto-unlock.

## 1.0.0 — initial scaffolding

- Per-process Manager singletons (main / renderer / preload).
- CLI with setup / clean / install / version / build / publish / validate-certs / sign-windows.
- Gulp build system with three webpack targets.
- Defaults scaffold for consumer projects.
- Strategy-pluggable Windows signing (self-hosted / cloud / local).
- All `lib/*.js` features as stubs — full implementations follow.
