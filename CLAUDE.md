# Electron Manager (EM)

## Identity

Electron Manager (EM) is a comprehensive framework for building modern Electron desktop apps. Sister project to Browser Extension Manager (BXM) and Ultimate Jekyll Manager (UJM). Provides one-line-import bootstrap per Electron process, modular feature library with file-based extensibility, a multi-platform build/release pipeline, and a built-in test framework.

## Quick Start

### For Consuming Projects

1. `npm install electron-manager --save-dev`
2. `npx mgr setup` — scaffolds the project (writes `config/electron-manager.json`, `src/main.js`, `src/preload.js`, per-window renderer entries, and integrations skeletons in `src/integrations/{tray,menu,context-menu}/index.js`). `electron-builder.yml` and `entitlements.mac.plist` are NOT scaffolded — they're generated into `dist/build/` at build time.
3. `npm start` — dev (gulp → webpack → electron .)
4. `npm run build` — local production build
5. `npm run release` — signed + published release (requires certs)
6. `npx mgr test` — runs framework + project test suites

### For Framework Development (This Repository)

1. `npm install`
2. `npm start` — watch + compile `src/` → `dist/` via prepare-package
3. Test in a consumer project: `npm i ../electron-manager` (file: link)
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

Boot sequence (main process — `manager.initialize()`):

1. **`startup.applyEarly()`** — first thing, before `whenReady`. Calls `app.dock.hide()` for `mode: 'hidden'` (zero-bounce production via `LSUIElement` baked at build time).
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
14. **`windows.initialize`** — registers app-level handlers (`window-all-closed` → quit on win/linux). **Does NOT auto-create any window.** The consumer's main.js calls `manager.windows.create('main')` from inside `manager.initialize().then(() => { ... })` — typically gated on `if (!startup.isLaunchHidden())` so agent/menubar apps stay invisible until the user explicitly asks for UI.

### Lib modules

`src/lib/*.js` — every Electron concern its own module. Each exports a singleton with `initialize(manager)`.

| Module | Status | Description |
|---|---|---|
| `ipc` | real | typed channel bus, single registration point |
| `storage` | real | electron-store wrapper, sync main / async renderer via IPC |
| `window-manager` | real | lazy-creation registry (no auto-windows; consumer calls `manager.windows.create('main')`). Bounds persistence + auto context-menu attach + inset titlebar (mac `hiddenInset` / win `titleBarOverlay` / linux native) + Discord-style hide-on-close on `main`. Auto `app.dock.show()` on macOS when first window appears (LSUIElement parity). |
| `tray` | real | file-based, dynamic items, runtime mutators |
| `menu` | real | file-based, platform-aware default template |
| `context-menu` | real | file-based, called per right-click with `params` |
| `startup` | real | `mode: 'normal' | 'hidden'` (was `tray-only`, now folded into `hidden` since they were the same LSUIElement flag). `hidden` mode bakes `LSUIElement: true` into Info.plist on macOS at build time → zero dock bounce, no dock icon, not in Cmd+Tab. Tray + notifications + networking still work. Consumer surfaces UI later via `manager.windows.create('main')` which triggers `app.dock.show()` automatically. |
| `app-state` | real | storage-backed launch flags + crash sentinel |
| `protocol` | real | single-instance lock + scheme registration |
| `deep-link` | real | unified deep-link dispatch (cold + warm start, mac + win + linux), built-in routes, pattern matching |
| `web-manager-bridge` | real | main = source-of-truth Firebase Auth, renderers reflect via IPC. BXM-pattern sync. Lazy firebase load. |
| `auto-updater` | real | electron-updater wrapper, startup + periodic checks, 30-day pending-update gate, dev simulation via `EM_DEV_UPDATE`, renderer-broadcast status state machine |
| `sentry` | real | per-context split (`lib/sentry/{index,core,main,renderer,preload}.js`), auto auth attribution via web-manager-bridge, dev-mode gating |
| `templating` | real | `{{ }}` token replacement (BXM/UJM convention), `buildPageVars()` helper, used at build time by `gulp/html` |

### File-based feature definitions

Trays, menus, and context-menus are NOT defined in config — they're defined in JS files the consumer authors at fixed conventional paths (`src/integrations/{tray,menu,context-menu}/index.js`). To opt out, call `manager.{tray,menu,contextMenu}.disable()` at runtime. There's no config flag because config-only would force a DSL for conditional items, dynamic labels, and click handlers — and a runtime API is more flexible anyway.

All three ship sensible **default templates** with id-tagged items so consumers can target them. The default scaffold for each lib calls `useDefaults()` and includes commented-out examples covering the full id-path API:

```js
// src/integrations/tray/index.js
module.exports = ({ manager, tray }) => {
  tray.icon('src/assets/icons/tray-Template.png');
  tray.tooltip(manager.config?.app?.productName);
  tray.useDefaults();                                    // ship EM's default items
  tray.insertAfter('open', { id: 'dashboard', label: 'Dashboard', click: ... });
};
```

**Unified id-path API across all three libs** (`manager.{tray,menu,contextMenu}.*` and the per-event/per-definition `menu` builder arg):

```
.find(id) / .has(id)
.update(id, patch)              — Object.assign + re-render
.remove(id)                     — splice + re-render
.enable(id, bool=true)          — sugar over update({enabled})
.show(id, bool=true) / .hide(id) — sugar over update({visible})
.insertBefore(id, item) / .insertAfter(id, item)
.appendTo(id, item)             — push into a submenu (creates submenu if absent)
```

Implemented once in `src/lib/_menu-mixin.js` and mixed into all three. The resolver matches by full id field first, then walks slash-separated path segments.

**Naming convention for default items:**
- **Tray** ids are flat: `title`, `open`, `check-for-updates`, `website`, `quit` (no `tray/` prefix — the namespace is implicit).
- **Context-menu** ids are flat: `cut`, `copy`, `paste`, `select-all`, `undo`, `redo`, `paste-and-match-style`, `open-link`, `copy-link`, `reload`, `inspect`, `toggle-devtools`.
- **Menu** ids are paths because menus actually nest: `main/check-for-updates`, `view/developer/toggle-devtools`, `help/website`, `development/open-logs`. The path roots (`main`, `file`, `edit`, `view`, `window`, `help`, `development`) are the literal menu labels — not arbitrary prefixes.

**Default item sets are informed by legacy electron-manager**:
- Menu: about, check-for-updates, preferences (hidden), services, hide/hide-others/show-all, relaunch, quit (App menu); preferences/relaunch/quit (File on win/linux); standard edit/view/window submenus; **`view/developer/*` submenu in dev mode** (toggle-devtools, inspect-elements, force-reload); **`development/*` top-level menu in dev mode** (open exe folder, user data, logs, app config, throw test error); help with check-for-updates (win/linux) + website link (when `brand.url`).
- Tray: title (disabled label), open, check-for-updates, website (when configured), quit.
- Context-menu: undo/redo (gated on canUndo/canRedo), cut/copy/paste/paste-and-match-style/select-all (when editable), copy (when text selected), open-link/copy-link (when on link), reload (always), inspect/toggle-devtools (dev only).

Items support function `label`/`enabled`/`visible`/`checked` evaluated on `refresh()`. Click handlers wrapped to swallow errors. Auto-updater hook patches both `main/check-for-updates`/`help/check-for-updates` (menu) AND `check-for-updates` (tray) in lockstep.

### Windows (lazy creation, inset titlebar, Discord-style hide-on-close)

EM does NOT auto-create any windows. Consumers call `manager.windows.create(name, opts?)` from inside `manager.initialize().then(() => { ... })`. Defaults baked in (no JSON `windows:` block needed):

- `main` → `{ width: 1024, height: 720, hideOnClose: true,  view: 'main' }`
- any other → `{ width: 800,  height: 600, hideOnClose: false, view: name   }`

Merge order: framework defaults < `config.windows.<name>` (if present) < call-site `overrides`. So `manager.windows.create('main', { width: 1280 })` produces `{ width: 1280, height: 720, hideOnClose: true, view: 'main' }`.

**Inset titlebar by default.** macOS gets `titleBarStyle: 'hiddenInset'` (OS-drawn traffic lights inset into the chrome region). Windows gets `titleBarStyle: 'hidden'` + `titleBarOverlay: { color, symbolColor, height: 36 }` (OS-drawn min/max/close buttons in the corner). Linux gets a native frame. Override per-window via `config.windows.<name>.titleBar = 'inset' | 'native'` or `titleBarOverlay = { ... }`.

**Page template is EM-internal** (`<em>/src/config/page-template.html`, copied to `<em>/dist/config/page-template.html` by prepare-package). Consumer's old `<consumer>/config/page-template.html` is no longer read. Template ships a draggable topbar (`.em-titlebar` + `.em-titlebar__drag` div with `-webkit-app-region: drag`) sized via `themes/classy/css/components/_titlebar.scss`, which keys off `html[data-platform]` (set by web-manager during init) — mac → pad-left 70px (clear traffic lights), windows → pad-right 140px (clear native overlay), linux → display:none (native frame draws title bar).

**Quit-vs-hide gating (Discord-style).** `main` window's X click hides instead of quitting. Real quit only via Cmd+Q / role:'quit' menu / tray Quit / auto-updater install — those flip `manager._isQuitting` (via `app.on('before-quit')`) or `manager._allowQuit` (via `manager.quit({ force: true })` or `autoUpdater.installNow()`), which the close handler checks before deciding to swallow vs let through. Three escape hatches: `manager._allowQuit` (programmatic force), `manager._isQuitting` (any path Electron knows about), `win._emForceClose` (per-window override).

`manager.quit({ force })` and `manager.relaunch({ force })` are exposed on the live manager. `relaunch` calls `autoUpdater.installNow()` if an update is downloaded, otherwise `app.relaunch() + app.quit()`.

**Auto-update background install (legacy parity).** When a download finishes (`code: 'downloaded'`) AND the check was NOT user-initiated (no menu/tray click — just the periodic background poll), `_setState` schedules `installNow()` after 5s. User-initiated checks skip this so the consumer's UI can prompt instead. Auto-updater menu/tray hook keeps the label in lockstep with status (Checking → Downloading 42% → Restart to Update v1.2.3 → You're up to date).

**macOS dock auto-show.** `windows.create()` and `windows.show()` call `app.dock.show()` if the dock is hidden — works even when `LSUIElement: true` is baked at build (`startup.mode = 'hidden'`). The app launches completely invisible (no dock icon, no Cmd+Tab, no taskbar) and the dock icon appears the moment the consumer surfaces UI.

**`startup.mode` simplified.** Was `'normal' | 'hidden' | 'tray-only'` — `tray-only` was always the same idea (LSUIElement) so it's now folded into `'hidden'`. Old `tray-only` configs fall back to `'normal'` per `getMode()` validation.

### Build system

- **prepare-package** copies framework `src/` → `dist/` (BXM-style).
- **Gulp** auto-loads tasks from `src/gulp/tasks/`.
- **Webpack** — three targets (electron-main / electron-preload / electron-renderer), all bundled in production for source protection. DefinePlugin + BannerPlugin inject `EM_BUILD_JSON` into bundles.
- **electron-builder** packages + publishes. `gulp/build-config` GENERATES `dist/electron-builder.yml` from EM defaults + `config/electron-manager.json` (no consumer-shipped `electron-builder.yml`). It also writes `dist/build/entitlements.mac.plist` (defaults + consumer overrides via `entitlements.mac` config) and resolves icons via a 3-tier waterfall (config → `<consumer>/config/icons/<platform>/<slot>.png` → EM bundled defaults) into `dist/build/icons/`.
- **Strategy-pluggable Windows signing** — `signing.windows.strategy` config key (no env var) selects `self-hosted` (EV USB token) | `cloud` | `local`. The GH Actions workflow has a `windows-strategy` job that reads the JSON5 config to drive runner selection + job gating.

### Config flow

`config/electron-manager.json` (JSON5, in consumer) → `Manager.getConfig()` (applies derived defaults: `app.appId` ← `com.itwcreativeworks.<brand.id>`, `app.productName` ← `brand.name`) → injected into renderer + preload bundles via webpack DefinePlugin as `EM_BUILD_JSON` → `require()`-able JSON in main.

Required fields: `brand.id` + `brand.name`. Everything else has defaults. Audit (`gulp/audit`) validates `brand.id` matches URL-scheme grammar (since it's also the deep-link scheme).

Notable defaults / behaviors:
- **appId**: `com.itwcreativeworks.<brand.id>` (set explicitly only if you must)
- **productName**: same as `brand.name`
- **Deep-link scheme**: always `<brand.id>://...` (no config). Built-in routes: `auth/token`, `app/show`, `app/quit`. Custom routes: `manager.deepLink.on('pattern', fn)` at runtime.
- **Tray / menu / context-menu**: paths are conventional (`src/integrations/{name}/index.js`) — no config block. Disable: `manager.<name>.disable()`.
- **`startup.mode`**: `'normal'` | `'hidden'`. `'hidden'` bakes `LSUIElement: true` into Info.plist on macOS at build time → completely invisible launch (no dock, no Cmd+Tab); tray + notifications still work. The deprecated `'tray-only'` mode is no longer valid — its behavior was always identical to `'hidden'` so it's been folded in.
- **`startup.openAtLogin`**: object form `{ enabled: true, mode: 'hidden' }`. The mode applies ONLY when the OS auto-launches at login; user-direct launches always use `startup.mode`. Force-OFF in dev (uses `app.isPackaged`) to prevent dev runs from polluting login items — set `EM_FORCE_LOGIN_ITEM=1` to override.
- **Windows**: no JSON config required. Consumer calls `manager.windows.create('main', opts?)` from inside `initialize().then(...)`. Framework defaults bake in `main` → `{ width: 1024, height: 720, hideOnClose: true, view: 'main' }` (Discord-style X=hide), other named windows → `{ width: 800, height: 600, hideOnClose: false }`. Override by passing opts to `create()` or by adding a `windows: { <name>: { ... } }` block in config (merge order: defaults < json < overrides).
- **Titlebar**: inset by default (`titleBarStyle: 'hiddenInset'` on mac; `titleBarOverlay` on windows; native on linux). Page template ships a `.em-titlebar` draggable strip sized per-platform via `html[data-platform]` (set by web-manager).
- **Page template**: EM-internal, no longer copied to `<consumer>/config/page-template.html`. Lives at `<em>/src/config/page-template.html`.
- **`manager.quit({ force })`** / **`manager.relaunch({ force })`**: programmatic quit/relaunch entry points that flip `_allowQuit` so window-manager's hide-on-close trap doesn't swallow the close events. Auto-updater's `installNow()` flips `_allowQuit` automatically before calling `quitAndInstall()`.
- **Icons**: 3-tier waterfall per slot/platform (config → `config/icons/<platform>/<slot>.png` → EM bundled). `@2x` retina auto-paired from `@1x`. Linux follows Windows resolution; Windows tray falls back to Windows app icon.
- **Entitlements**: `entitlements.mac` is an object map (key→bool/string/array). Consumer overrides EM's defaults; `null` removes a default. Plist generated to `dist/build/entitlements.mac.plist`.
- **Stable download names** (`gulp/mirror-downloads`): `Somiibo.dmg`, `Somiibo-Setup.exe`, `somiibo_amd64.deb`, `Somiibo.AppImage` — preserves legacy URLs. Apple Silicon gets `-arm64` suffix.

### Build modes

- `EM_BUILD_MODE=true` — production build (minified, no sourcemaps).
- `EM_IS_PUBLISH=true` — publish step.
- `EM_IS_SERVER=true` — running in CI.

### Test framework

`npx mgr test` (or `npm test` in EM itself) discovers + runs:
- `<EM>/dist/test/suites/**/*.js` — framework defaults
- `<cwd>/test/**/*.js` — consumer suites

Four layers:
- **build** — plain Node, fast.
- **main** — spawns Electron via `runners/electron.js`, JSON-line stdout protocol. Tests EM lib code in isolation.
- **renderer** — hidden BrowserWindow.
- **boot** — spawns Electron with the consumer's actual built `dist/main.bundle.js` (the production main entry). Waits for `manager.initialize()` to resolve, then runs each test's `inspect(manager)` callback against the live runtime. Replaces shell-level `npm start && sleep && kill` smoke tests with deterministic, signal-driven pass/fail. Uses a single Electron process for all boot tests (~1s after build). **Always rebuilds the bundle** before running so tests never see stale code (~10s build cost; opt out with `EM_TEST_SKIP_BUILD=1` for CI where build ran in a separate step). Plumbing: `EM_TEST_BOOT`/`EM_TEST_BOOT_HARNESS`/`EM_TEST_BOOT_SPEC` env vars, harness in `src/test/harness/boot-entry.js`, runner in `src/test/runners/boot.js`. Strips `ELECTRON_RUN_AS_NODE` from the child env (matches `gulp/serve`) so electron starts in main-process mode regardless of the surrounding shell. See `docs/test-boot-layer.md`.

Test files export `{ type, layer, description, tests, cleanup }`. Boot tests use `inspect: async ({ manager, expect, projectRoot }) => { ... }` instead of `run`. See `docs/test-framework.md` and `docs/test-boot-layer.md`.

### Dev logs

Every gulp invocation tees its complete stdout + stderr to `<projectRoot>/logs/dev.log` (path controllable via `EM_LOG_FILE`; disable with `EM_LOG_FILE=false`). ANSI codes stripped from the file; terminal output unchanged. Truncated fresh on each run. `logs/` is gitignored by default.

When debugging via Claude or anywhere else, prefer `cat logs/dev.log` / `grep ... logs/dev.log` over copy-pasting terminal scrollback. The file captures everything: gulp tasks, electron main process, electron child stdout, deprecation warnings, errors.

Implementation: `src/utils/attach-log-file.js` wraps `process.stdout.write` and `process.stderr.write`. Invoked at the top of `src/gulp/main.js`. `src/gulp/tasks/serve.js` uses `stdio: ['inherit', 'pipe', 'pipe']` so the electron child's output flows through the same tee.

## CLI

`npx mgr <command>` (aliases `em`, `electron-manager`):

| Command | Status | Description |
|---|---|---|
| `setup` | real | scaffold consumer, ensure peer deps, write projectScripts |
| `clean` | real | remove `dist/`, `release/`, `.em-cache/` |
| `install` | real | install peer deps |
| `version` | real | print versions |
| `test` | real | run framework + project test suites |
| `build` | real | shells `gulp build` with `EM_BUILD_MODE=true` |
| `publish` | real | shells `gulp publish` with `EM_BUILD_MODE=true EM_IS_PUBLISH=true`; full sign + notarize + GH release upload |
| `validate-certs` | real | check cert files, env vars, profile expiration + appId match, Keychain identity. Auto-runs at end of `setup` (non-fatal). |
| `push-secrets` | real | read `.env` Default section, encrypt via libsodium, push to GH Actions secrets. Auto-base64s file paths. **Auto-runs at end of `setup`** when `GH_TOKEN` is set. |
| `sign-windows` | real | strategy-aware EV/cloud/local signer. Self-hosted runs `signtool` against EV token; cloud dispatches to provider CLI; local is a no-op with a clear message. |
| `finalize-release` | real | `--signed-dir <path>` uploads signed Windows installers to the update-server release (created by mac/linux's electron-builder publish) AND mirrors them to download-server's installer tag with stable filenames. `--publish` flips the update-server release Draft→Published so electron-updater feeds work. CI workflow runs both modes (windows-sign job calls `--signed-dir`, finalize job calls `--publish`). |

## File Conventions

- **CommonJS** (`require()`) throughout. Node 24 (the version Electron 41 ships) runs ESM deps natively via `require()` — no need for dynamic `import()` unless a package is genuinely ESM-only (e.g. `electron-store@11` — handled via `webpackIgnore`'d dynamic import in `lib/storage.js`).
- **Node version auto-synced from Electron.** `npx mgr setup` queries `https://releases.electronjs.org/releases.json` using the consumer's installed `electron` version, finds the bundled Node version, and writes the consumer's `.nvmrc` to match. So whatever Electron ships, the consumer's Node always matches. EM's own `package.json#engines.node` is a fallback for when the network lookup fails. Implementation: `src/utils/electron-node-version.js`.
- One `module.exports = ...` per file.
- Logical operators at the **start** of continuation lines.
- Short-circuit early returns rather than nested ifs.
- Prefer **`fs-jetpack`** over `fs-extra`.
- **No backwards compatibility** unless explicitly requested — this is unreleased v1.
- **Lib structure — flat file vs directory split.** Default to a flat `src/lib/<name>.js`. Split into a directory (`src/lib/<name>/{index,core,main,renderer,preload}.js`) ONLY when each Electron context (main / renderer / preload) has materially different logic that would force runtime branching inside one file. `index.js` is then a thin context detector that delegates. Currently only `lib/sentry/` is split (the SDK has separate main/renderer/preload entry points). Don't split prophylactically — convert when the branching gets ugly.

## Documentation

API references for each subsystem live in `docs/`:

- [docs/storage.md](docs/storage.md) — main + renderer storage, dot-notation, change broadcasts
- [docs/ipc.md](docs/ipc.md) — typed channel bus
- [docs/windows.md](docs/windows.md) — named windows, bounds persistence
- [docs/tray.md](docs/tray.md) — file-based tray
- [docs/menu.md](docs/menu.md) — file-based application menu
- [docs/context-menu.md](docs/context-menu.md) — file-based right-click menus
- [docs/startup.md](docs/startup.md) — launch modes, zero-bounce production
- [docs/app-state.md](docs/app-state.md) — launch flags, crash sentinel
- [docs/deep-link.md](docs/deep-link.md) — cross-platform deep links, single-instance, built-in routes
- [docs/web-manager-bridge.md](docs/web-manager-bridge.md) — Firebase auth state sync across main + renderers
- [docs/auto-updater.md](docs/auto-updater.md) — startup + periodic checks, 30-day pending-update gate, dev simulation
- [docs/sentry.md](docs/sentry.md) — per-context split, auto auth attribution, dev-mode gating
- [docs/templating.md](docs/templating.md) — `{{ }}` token replacement, page vars, HTML pipeline
- [docs/themes.md](docs/themes.md) — vendored classy + bootstrap themes, `@use 'electron-manager'` overrides, per-page CSS bundles
- [docs/hooks.md](docs/hooks.md) — lifecycle hooks (build/pre, build/post, release/pre, release/post, notarize/post)
- [docs/signing.md](docs/signing.md) — code signing for macOS + Windows, cert file inventory, env vars
- [docs/releasing.md](docs/releasing.md) — end-to-end release walkthrough (`.env` → GitHub Release)
- [docs/runner.md](docs/runner.md) — Windows EV-token signing runner, `npx mgr runner install`
- [docs/test-framework.md](docs/test-framework.md) — writing tests, running them, layers
- [docs/test-boot-layer.md](docs/test-boot-layer.md) — boot test layer (spawns the consumer's actual built bundle for end-to-end smoke tests)
- [docs/build-system.md](docs/build-system.md) — gulp, webpack, electron-builder pipeline

`PROGRESS.md` tracks pass-by-pass progress and decisions.
