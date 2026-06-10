# Electron Manager (EM)

> **Note for contributors and Claude:** This file is the architectural overview — identity, top-level conventions, and a map to the deep references. The **meat** (per-subsystem APIs, edge cases, behavior tables, defaults lists) lives in `docs/<topic>.md`. When extending or adding content, write it in the matching `docs/*.md` file and cross-link from here — do NOT inline it. If a topic doesn't have a doc yet, create one. Goal: keep this file under 250 lines.

## Identity

Electron Manager (EM) is a comprehensive framework for building modern Electron desktop apps. Sister project to Browser Extension Manager (BXM) and Ultimate Jekyll Manager (UJM). Provides one-line-import bootstrap per Electron process, modular feature library with file-based extensibility, a multi-platform build/release pipeline, and a built-in test framework.

## Recommended skills

- **`EM:patterns`** — SSOT for Electron Manager architecture, lib modules, build/release pipeline, and test framework patterns. Auto-loads on EM-specific keywords (`manager.windows`, `manager.tray`, `electron-builder`, `npx mgr setup`, etc.) and when touching files in `src/lib/`, `src/integrations/`, `src/gulp/`, `src/commands/`, `config/electron-manager.json`, etc.
- **`js:patterns`** — JavaScript/Node.js conventions: file structure, JSDoc, defensive coding (`?.` usage), template literals, `package.json` conventions. Auto-loads when creating new `.js` files or touching JS module structure.

## 🚨 READ WEB-MANAGER TOO

**EM ships `web-manager` as a runtime singleton inside the renderer process** — it powers auth, Firebase, reactive `data-wm-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with web-manager as much as with EM.

**Required reading:**
- **`node_modules/web-manager/CLAUDE.md`** — top-level overview + index
- **`node_modules/web-manager/docs/`** — module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick Start

### For Consuming Projects

1. `npm install electron-manager --save-dev`
2. `npx mgr setup` — scaffolds the project (writes `config/electron-manager.json`, `src/main.js`, `src/preload.js`, per-window renderer entries, and integrations skeletons in `src/integrations/{tray,menu,context-menu}/index.js`).
3. `npm start` — dev (gulp → webpack → electron .)
4. `npm run build` — local production build (compiles bundles only, no installer)
5. `npm run package:quick` — fast packaged build for the host platform/arch only (~20-30s, skips DMG/zip/universal/notarize). Smoke-test packaged-mode behavior locally.
6. `npm run package` — full local production package (DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux). ~3min on mac.
7. `npm run release` — signed + published release (requires certs)
8. `npx mgr test` — runs framework + project test suites
   - `npx mgr test build/config` — run a specific test by path (relative to `test/`)
   - `npx mgr test em:build/config` — run only framework tests matching a path
   - `npx mgr test project:custom-test` — run only consumer project tests matching a path
   - Prefix with `TEST_EXTENDED_MODE=true` for tests that hit real external APIs

### For Framework Development (This Repository)

1. `npm install`
2. `npm start` — watch + compile `src/` → `dist/` via prepare-package
3. Test in a consumer project: from inside the consumer, run `npx mgr install dev` to swap EM to this local repo — required whenever you edit the framework source and want the consumer to pick up the changes (the consumer otherwise keeps its installed `node_modules/electron-manager`). Reverse with `npx mgr install live`.
4. `npm test` — runs the framework's own suites

## Architecture

### Per-process Manager singletons

Each Electron process has its own one-line bootstrap:

```js
// src/main.js
new (require('electron-manager/main'))().initialize();      // auto-loads JSON5 config

// src/preload.js
new (require('electron-manager/preload'))().initialize();   // exposes window.em

// src/assets/js/components/<view>/index.js
new (require('electron-manager/renderer'))().initialize();
```

`manager.initialize()` runs a fixed boot order (startup → ipc → storage → sentry → protocol → deepLink → appState → whenReady → autoUpdater → tray/menu/contextMenu → startup → webManager → remoteConfig → remoteScripts → windows). See [docs/boot-sequence.md](docs/boot-sequence.md) for the full ordered list + rationale.

### Lib modules

`src/lib/*.js` — every Electron concern its own module. Each exports a singleton with `initialize(manager)`. Deep dive per module: see `docs/<lib-name>.md`.

| Module | Description |
|---|---|
| `ipc` | typed channel bus, single registration point |
| `storage` | electron-store wrapper, sync main / async renderer via IPC |
| `window-manager` | lazy-creation registry, bounds persistence, Discord-style hide-on-close, inset titlebar, dock-show on first window, re-surface on user re-launch |
| `tray` / `menu` / `context-menu` | file-based definitions; unified id-path API; default templates with id-tagged items |
| `startup` | `mode: 'normal' \| 'hidden'`; `'hidden'` bakes `LSUIElement: true` for zero dock bounce |
| `app-state` | storage-backed launch flags + crash sentinel |
| `protocol` | single-instance lock + scheme registration |
| `deep-link` | unified deep-link dispatch (cold + warm start, mac + win + linux), built-in routes, pattern matching |
| `web-manager-bridge` | main = source-of-truth Firebase Auth, renderers reflect via IPC |
| `auto-updater` | electron-updater wrapper, idle-aware install, 30-day pending gate, dev simulation |
| `sentry` | per-context split, auto auth attribution, dev-mode gating |
| `templating` | `{{ }}` token replacement (BXM/UJM convention), used at build time by `gulp/html` |
| `context` | runtime info — `manager.context.{geolocation,client,session,app}` |
| `usage` | `opens` / `hoursTotal` / `hoursThisSession`; crash-safe |
| `remote-config` | "Hot config" fetched from `${brand.url}/data/resources/main.json`, polled hourly |
| `remote-scripts` | Emergency remote code execution — fetches `${brand.url}/data/scripts/main.js`, content-hash dedup, async `manager` + `require` in scope |
| `analytics` | GA4 Measurement Protocol; cross-platform `uuidv5` identity |
| `restart-manager` | auxiliary helper app for relaunches; auto-install via signed mac.zip / NSIS / browser .deb |

### File-based feature definitions

Trays, menus, and context-menus are NOT defined in config — they're defined in JS files the consumer authors at fixed conventional paths (`src/integrations/{tray,menu,context-menu}/index.js`). To opt out, call `manager.{tray,menu,contextMenu}.disable()` at runtime.

All three ship sensible default templates and share a unified id-path API (`.find/.has/.update/.remove/.enable/.show/.hide/.insertBefore/.insertAfter/.appendTo`), implemented once in `src/lib/_menu-mixin.js`. See [docs/tray.md](docs/tray.md), [docs/menu.md](docs/menu.md), [docs/context-menu.md](docs/context-menu.md).

### Windows

EM does NOT auto-create any windows. Consumers call `manager.windows.create('main', { show: !startup.isLaunchHidden() })` from inside `manager.initialize().then(...)`. Inset titlebar by default; Discord-style hide-on-close on `main`; auto re-surface on user re-launch. See [docs/windows.md](docs/windows.md).

### Icons

Convention-only. Drop PNGs at `config/icons/<platform>/<slot>.png` (platform-specific) or `config/icons/global/<slot>.png` (universal fallback). Resolution per slot: platform → global → (Linux only) windows → bundled default. Ship @2x native size only — EM downscales the @1x sibling via sharp. macOS tray input is `tray.png` (consumer-friendly); EM renames the dist output to `trayTemplate.png` for OS dark-mode auto-inversion. No `app.icons` config block. See [docs/icons.md](docs/icons.md).

### Build system

prepare-package copies `src/` → `dist/`; gulp orchestrates webpack (3 targets, all bundled) + electron-builder. `gulp/build-config` generates `dist/electron-builder.yml` + `dist/config/entitlements.mac.plist` from EM defaults + consumer config. Strategy-pluggable Windows signing (`targets.win.signing.strategy`: `self-hosted` | `cloud` | `local`). See [docs/build-system.md](docs/build-system.md), [docs/installer-options.md](docs/installer-options.md), [docs/signing.md](docs/signing.md).

### Config flow

`config/electron-manager.json` (JSON5, in consumer) → `Manager.getConfig()` (applies derived defaults: `app.appId` ← `com.itwcreativeworks.<brand.id>`, `app.productName` ← `brand.name`) → injected into ALL THREE bundles at build time via webpack DefinePlugin as `EM_BUILD_JSON`. Runtime reads `EM_BUILD_JSON.config` first (authoritative in packaged apps); dev falls back to disk read.

Required fields: `brand.id` + `brand.name`. Everything else has defaults. See [docs/installer-options.md](docs/installer-options.md) for the full defaults table.

### Schema validation

Every field in `config/electron-manager.json` is declared in `src/config/schema.js` — single source of truth. Validator engine is `src/utils/validate-config.js` (pure, ~100 lines). Runs at boot (hard-fails `manager.initialize()` if invalid) AND in `gulp/audit` (plus build-pipeline extras). See [docs/config-schema.md](docs/config-schema.md).

### Cross-context helpers

Four Managers (main / renderer / preload / build-time) all mix in shared helpers via `attachTo(Manager)`: `isDevelopment()`, `isProduction()`, `isTesting()`, `getWebsiteUrl()`, `getEnvironment()`, `getFunctionsUrl()`, `getApiUrl()`. Use these instead of grepping `process.env` ad-hoc. `getEnvironment()` returns `'development' | 'testing' | 'production'` (mutually exclusive — testing wins over dev); gate side effects on the INTENTIONAL check (`isProduction()` for prod-only, `isDevelopment() || isTesting()` for local-or-test) — never `!isDevelopment()`. See [docs/environment-detection.md](docs/environment-detection.md).

### Test framework

`npx mgr test` discovers + runs framework suites (`<EM>/dist/test/suites/**`) plus consumer suites (`<cwd>/test/**`). Four layers: **build** (plain Node), **main** (spawned Electron), **renderer** (hidden BrowserWindow), **boot** (consumer's actual built bundle for end-to-end smoke tests). See [docs/test-framework.md](docs/test-framework.md), [docs/test-boot-layer.md](docs/test-boot-layer.md).

### Dev logs

Every gulp invocation tees stdout+stderr to `<projectRoot>/logs/dev.log` (path via `EM_LOG_FILE`; disable with `EM_LOG_FILE=false`). When debugging via Claude, prefer `cat logs/dev.log` over copy-pasting terminal scrollback. See [docs/logging.md](docs/logging.md).

### CDP debugging (Claude ↔ Electron)

`serve` forwards all `--` CLI flags to the Electron child process. Set `EM_CDP_PORT=9222` (or pass `--remote-debugging-port=9222` via `--`) to expose Chrome DevTools Protocol on that port, enabling Claude to screenshot, click, type, evaluate JS, and read console logs in the running app via the `chrome-devtools-electron` MCP upstream. See [docs/cdp-debugging.md](docs/cdp-debugging.md).

## CLI

`npx mgr <command>` (aliases `em`, `electron-manager`):

| Command | Description |
|---|---|
| `setup` | scaffold consumer, ensure peer deps, write projectScripts |
| `clean` | remove `dist/`, `release/`, `.cache/` |
| `install` | install peer deps |
| `version` | print versions |
| `test` | run framework + project test suites |
| `build` | shells `gulp build` with `EM_BUILD_MODE=true` |
| `publish` | full sign + notarize + GH release upload (`EM_IS_PUBLISH=true`) |
| `validate-certs` | check cert files, env vars, profile expiration, Keychain identity. Auto-runs at end of `setup` |
| `push-secrets` | encrypt `.env` Default section via libsodium → GH Actions secrets. Auto-runs at end of `setup` when `GH_TOKEN` is set |
| `sign-windows` | strategy-aware EV/cloud/local signer; emits JSONL events for `runner monitor` |
| `runner monitor` | tails `em-signing.log` and pretty-prints signing events |
| `launch` | launch a packaged app with clean env (strips `ELECTRON_RUN_AS_NODE`); auto-discovers `release/<platform>-<arch>/<App>.app`. Aliases: `mgr open` |
| `finalize-release` | `--signed-dir` uploads signed installers; `--publish` flips release Draft→Published |
| `release` | trigger consumer's GH Actions Build & Release workflow, poll-stream logs |

See [docs/releasing.md](docs/releasing.md) for the end-to-end flow.

## Development Workflow

- **🚫 NEVER run `npm start` / `npx mgr launch` / `npm test`** unless the user explicitly asks. Assume the user is already running the app or dev process. Running these commands kills the user's process and wastes time. Instead, **check output logs** after editing files to confirm changes compiled and took effect.
- **After editing files**, verify the gulp watcher recompiled successfully. Check for webpack/sass errors in the console output. A change that breaks the build is not a completed change.
- **Live-test UI changes via CDP.** After code changes compile, use the `chrome-devtools-electron` MCP tools (screenshots, click, evaluate JS, console logs) to verify the change works in the running app. This is the primary way to confirm UI/renderer changes — type-checking and test suites verify code correctness, not feature correctness. See [docs/cdp-debugging.md](docs/cdp-debugging.md) and `~/.claude/mcp-server/servers/chrome-devtools-electron/CLAUDE.md`.

## File Conventions

- **CommonJS** (`require()`) throughout. Node 24 runs ESM deps natively via `require()` — no need for dynamic `import()` unless a package is genuinely ESM-only (e.g. `electron-store@11` — handled via `webpackIgnore`'d dynamic import in `lib/storage.js`).
- **Node version auto-synced from Electron.** `npx mgr setup` queries `releases.electronjs.org` and writes the consumer's `.nvmrc` to match.
- One `module.exports = ...` per file.
- Logical operators at the **start** of continuation lines.
- Short-circuit early returns rather than nested ifs.
- Prefer **`fs-jetpack`** over `fs-extra`.
- **No backwards compatibility** unless explicitly requested — this is unreleased v1.
- **Lib structure — flat file vs directory split.** Default to flat `src/lib/<name>.js`. Split into a directory (`src/lib/<name>/{index,core,main,renderer,preload}.js`) ONLY when each Electron context has materially different logic. Currently only `lib/sentry/` is split. Don't split prophylactically.
- **Use `app.getAppPath()`, not `process.cwd()`, for runtime path resolution.** In a packaged app, `process.cwd()` is `/`. Use `require('./utils/app-root.js')()` — tries `app.getAppPath()` first, falls back to `process.cwd()` for tests/non-Electron contexts.
- **Zero-trust URL handling — `sanitizeURL` for `shell.openExternal` and friends.** Any dynamic URL passed to `shell.openExternal`, `BrowserWindow.loadURL`, `window.location.href =`, etc. MUST be gated through `require('./utils/sanitize-url.js')` first. Returns the URL unchanged when its protocol is `http:`/`https:`, and `''` for anything else (`javascript:`, `data:`, `file:`, `vbscript:`, `chrome:`, custom schemes). Canonical pattern: `const safe = sanitizeURL(url); if (safe) shell.openExternal(safe);`. Hardcoded protocol URLs constructed internally (e.g. `restart-manager://` built by `_buildUrl`) bypass — not attacker-controllable. See `src/utils/sanitize-url.js` and the `js:patterns/xss-escaping` skill.
- **`ELECTRON_RUN_AS_NODE` is stripped at the CLI boundary.** When set, Electron silently runs as plain Node — `app` is undefined, no BrowserWindow. The variable leaks from common parent processes (VS Code's Claude Code extension runs as a `node.mojom.NodeService` utility process with the var set). `bin/electron-manager` and `src/gulp/main.js` both `delete process.env.ELECTRON_RUN_AS_NODE` at the top.

## Doc-update parity

Whenever you make a behavioral change (new command, new flag, new pattern, removed feature), update:

1. **`README.md`** — user-facing summary
2. **`CLAUDE.md`** (this file) — architecture overview, one paragraph or cross-link
3. **`docs/<topic>.md`** — the meat. If a topic doesn't have a doc yet, create one.
4. **`CHANGELOG.md`** — if the project keeps one

Don't ship behavioral changes with stale docs. Validate first, then document — write docs that describe shipped reality, not intentions.

## Documentation

API references for each subsystem live in `docs/`. **Whenever you make a behavioral change, update both this overview AND the relevant `docs/*.md` deep reference.** Treat docs as a first-class deliverable, not an afterthought.

- [docs/boot-sequence.md](docs/boot-sequence.md) — full `manager.initialize()` ordered list + rationale
- [docs/storage.md](docs/storage.md) — main + renderer storage, dot-notation, change broadcasts
- [docs/ipc.md](docs/ipc.md) — typed channel bus
- [docs/windows.md](docs/windows.md) — named windows, bounds persistence, hide-on-close, inset titlebar
- [docs/tray.md](docs/tray.md) — file-based tray
- [docs/menu.md](docs/menu.md) — file-based application menu
- [docs/context-menu.md](docs/context-menu.md) — file-based right-click menus
- [docs/startup.md](docs/startup.md) — launch modes, zero-bounce production
- [docs/app-state.md](docs/app-state.md) — launch flags, crash sentinel
- [docs/deep-link.md](docs/deep-link.md) — cross-platform deep links, single-instance, built-in routes
- [docs/web-manager-bridge.md](docs/web-manager-bridge.md) — Firebase auth state sync across main + renderers
- [docs/auto-updater.md](docs/auto-updater.md) — startup + periodic checks, 30-day pending-update gate, idle-aware install
- [docs/analytics.md](docs/analytics.md) — GA4 Measurement Protocol, cross-platform `uuidv5` identity
- [docs/context.md](docs/context.md) — runtime context block (geolocation, client, session, app)
- [docs/usage.md](docs/usage.md) — opens / hoursTotal / hoursThisSession; clean-exit accumulation
- [docs/remote-config.md](docs/remote-config.md) — "hot config" fetched from brand site
- [docs/remote-scripts.md](docs/remote-scripts.md) — emergency remote code execution, content-hash dedup
- [docs/restart-manager.md](docs/restart-manager.md) — auxiliary helper app for relaunches
- [docs/config-schema.md](docs/config-schema.md) — canonical schema + validator
- [docs/sentry.md](docs/sentry.md) — per-context split, auto auth attribution
- [docs/templating.md](docs/templating.md) — `{{ }}` token replacement, page vars, HTML pipeline
- [docs/logging.md](docs/logging.md) — runtime logger (main + preload + renderer → one `runtime.log`)
- [docs/themes.md](docs/themes.md) — vendored classy + bootstrap themes, per-page CSS bundles
- [docs/hooks.md](docs/hooks.md) — lifecycle hooks (build/pre, build/post, release/pre, release/post, notarize/post)
- [docs/icons.md](docs/icons.md) — convention-only icon resolution (`global/` + per-platform), retina derivation, macOS Template magic
- [docs/installer-options.md](docs/installer-options.md) — per-target installer config, defaults table
- [docs/signing.md](docs/signing.md) — code signing for macOS + Windows
- [docs/releasing.md](docs/releasing.md) — end-to-end release walkthrough
- [docs/runner.md](docs/runner.md) — Windows EV-token signing runner
- [docs/test-framework.md](docs/test-framework.md) — writing tests, running them, layers
- [docs/test-boot-layer.md](docs/test-boot-layer.md) — boot test layer
- [docs/build-system.md](docs/build-system.md) — gulp, webpack, electron-builder pipeline
- [docs/environment-detection.md](docs/environment-detection.md) — `isDevelopment`/`isTesting`/`getApiUrl` etc., adding new helpers
- [docs/cdp-debugging.md](docs/cdp-debugging.md) — Claude ↔ Electron via CDP, `EM_CDP_PORT`, MCP setup

`PROGRESS.md` tracks pass-by-pass progress and decisions.
