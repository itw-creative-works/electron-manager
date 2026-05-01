# Changelog

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
