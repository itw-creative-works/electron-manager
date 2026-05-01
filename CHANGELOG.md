# Changelog

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
