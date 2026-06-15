<p align="center">
  <a href="https://itwcreativeworks.com">
    <img src="https://cdn.itwcreativeworks.com/assets/itw-creative-works/images/logo/itw-creative-works-brandmark-black-x.svg" width="100px">
  </a>
</p>

<p align="center">
  <strong>Electron Manager</strong> — all-in-one development framework for Electron apps. Sister project to
  <a href="https://github.com/itw-creative-works/browser-extension-manager">Browser Extension Manager</a> and
  <a href="https://github.com/itw-creative-works/ultimate-jekyll-manager">Ultimate Jekyll Manager</a>.
</p>

## What it does

- **One-line bootstrap** per Electron process: `require('electron-manager/main')`, `/preload`, `/renderer`.
- **Modular feature library** — storage, IPC, theme, tray, menu, context menu, window manager, startup, app-state, deep-link, auto-updater, web-manager auth, Sentry, **analytics, context, usage, remote-config, restart-manager**. Each feature is its own module with documented API.
- **System-aware dynamic theme.** `manager.theme` follows the OS light/dark preference **live** by default (`'system'`), with `'light'`/`'dark'` overrides persisted across boots. Every renderer — windows AND embedded views — keeps `<html data-bs-theme>` in sync automatically; consumers drop plain `<button data-em-theme-set="dark">` controls and EM wires them.
- **Cross-platform analytics identity.** GA4 Measurement Protocol with `client_id = uuidv5(deviceId, projectIdNamespace)` and `user_id = uuidv5(firebaseUid, projectIdNamespace)`. Same Firebase project ID in BEM/UJM/web-manager/EM produces identical `user_id` outputs everywhere → unified events for one human across desktop + web + backend, no manual stitching.
- **"Hot config"** fetched from your brand site (`<brand.url>/data/resources/main.json`) and polled hourly — flip a force-update version, default user-agent, ad rotation, etc. without re-releasing. `manager.remoteConfig.get('versionRequired')`. Cached to storage so offline boots still have last-known values.
- **File-based feature definitions** — trays, menus, and context-menus are JS files (full power, no DSL): `src/integrations/{tray,menu,context-menu}/index.js`. All three ship sensible **id-tagged defaults** (legacy-EM-style: about, preferences, check-for-updates, dev menu w/ inspector + log folders, etc.) and share the same **id-path mutation API**: `find`, `update`, `remove`, `enable`, `show`, `hide`, `insertBefore`, `insertAfter`, `appendTo`. Any default item is one line away from removal, customization, or repositioning.
- **Lazy windows + Discord-style hide-on-close.** EM doesn't auto-create any windows — your `main.js` calls `windows.create('main', { show: !startup.isLaunchHidden() })`. The `main` window's X button hides instead of quitting on every platform; real quit only via Cmd+Q / menu Quit / tray Quit / auto-update install. Inset titlebar by default (mac `hiddenInset` traffic lights / win native overlay buttons / linux native frame) with a draggable topbar in the page template.
- **Zero-bounce hidden-launch on macOS.** `startup.mode = 'hidden'` bakes `LSUIElement: true` into Info.plist at build time → app launches completely invisible (no dock icon, no Cmd+Tab, no taskbar). Tray + notifications + networking still work. When the user double-clicks the running app's icon, EM's `app.on('activate')` (macOS) / `app.on('second-instance')` (win/linux) handler surfaces the `main` window and the dock icon appears alongside it. CleanMyMac-style "tray-only at login, full window when manually opened" is the default.
- **Auto-update background install.** When a download finishes from a background poll (not user-initiated), EM auto-relaunches into the new version after 5s — apps update overnight without bothering the user. User-initiated checks skip this so your UI can prompt instead.
- **Webpack-bundled** main / preload / renderer for source protection.
- **Built-in test framework** — Jest-like syntax, four layers: `build` (plain Node), `main` (spawned Electron), `renderer` (hidden BrowserWindow), and `boot` (spawns the consumer's actual built `dist/main.bundle.js` for end-to-end smoke tests against the live manager — no `npm start && sleep && kill` shell hacks). Boot layer always rebuilds the bundle first so tests never see stale code.
- **Schema-validated config.** Every field in `config/electron-manager.json` is declared in a canonical schema. Validation runs at app boot AND during `gulp audit` — a misconfigured app never reaches the "white window of confusion" stage; it tells you exactly which field is broken with a numbered list. Simple flag model — `required: true | false | (config) => bool` — and `match` / `enum` / `type` only fire on field presence so consumers never see a flood of redundant errors for the same field. Pure-JS validator, no Ajv/Joi/Zod dep. See [config-schema](docs/config-schema.md).
- **Multi-platform build/release** via GitHub Actions — macOS sign + notarize, Linux (deb + AppImage + optional Snap), Windows EV-token signing (self-hosted runner now, cloud-signing pluggable). Sensible installer defaults out of the box: NSIS one-click install on Windows (desktop + start menu shortcut, launch on finish), universal mac binary (one .dmg for Intel + Apple Silicon), `app.category` automatically mapped to per-platform values, copyright `{YEAR}` token always current. Snap Store publishing is on by default in the scaffold and auto-skipped at build time when `SNAPCRAFT_STORE_CREDENTIALS` isn't set — drop the credential blob into `.env`, run `mgr push-secrets`, and the next release ships to the Snap Store. See [installer-options](docs/installer-options.md).

## Quick start (consumer)

EM auto-syncs your system Node version to match whatever Node Electron's bundled runtime ships with. `npx mgr setup` queries the official Electron releases feed using your installed Electron version, then writes the corresponding Node major to `.nvmrc`. Run `nvm use` afterward to switch your shell.

```bash
npm install electron-manager --save-dev
npx mgr setup            # scaffolds project; auto-resolves & writes correct .nvmrc from electron version
nvm use                  # switch to the Node version Electron uses (one-time per shell)
npm start                # dev: gulp → webpack → electron .
EM_CDP_PORT=9222 npm start  # dev + expose Chrome DevTools Protocol for Claude/MCP debugging
npx mgr cdp status       # drive the running dev app over CDP: status|eval|shot|capture|theme|relaunch|quit (docs/cdp-debugging.md)
npm run build            # local production build (bundles only, no installer)
npm run package:quick    # fast packaged build for host platform/arch (.app/.exe-folder/linux-unpacked, ~20-30s) — for smoke-testing packaged behavior
npm run package          # full local production package (DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux)
npm run release          # signed + published release via GitHub Actions
npx mgr test             # run framework + project test suites
npx mgr test project:    # only YOUR project tests (mgr: = only the framework's own tests; add a path to narrow)
npx mgr test --extended  # opt into tests that hit real external services (or TEST_EXTENDED_MODE=true)
```

## Icons

Convention-only. Drop PNGs at:

```
config/icons/
  global/             ← used by any platform with no platform-specific override
    icon.png
    tray.png
  macos/              ← macOS overrides (beats global)
    icon.png
    tray.png          ← 32×32 — EM renames to trayTemplate.png in dist for OS dark-mode magic
    dmg.png           ← 1080×760 DMG background
  windows/            ← Windows overrides
    icon.png
    tray.png
  linux/              ← Linux overrides (otherwise falls back to global → windows)
    icon.png
    tray.png
```

Resolution per slot/platform (most specific wins): `<platform>/<slot>` → `global/<slot>` → (Linux only) `windows/<slot>` → EM bundled default. Tray missing falls back to app icon.

**Ship native (@2x) size only — EM downscales the @1x sibling automatically.** macOS tray must be 32×32; macOS DMG must be 1080×760. EM emits both `<slot>.png` and `<slot>@2x.png` into `dist/config/icons/<platform>/`. No `app.icons` config block — files are the source of truth.

## Logs

Five logs in `<projectRoot>/logs/`, each with its own purpose:

| File | What | Lifetime |
|---|---|---|
| `runtime.log` | Your packaged app's runtime — main + preload + renderer all converge here via electron-log | Persistent, rotates at 10 MB |
| `dev.log` | Gulp pipeline output — sass, webpack, html, electron child stdout from `npm start` | Truncated each `npm start` |
| `build.log` | Gulp pipeline output for production builds/packages (`npm run build` / `package` / `publish`, i.e. `EM_BUILD_MODE=true`) | Truncated each build |
| `test.log` | `npx mgr test` runner output (suite names, pass/fail, harness boot lines) | Truncated each test run |
| `ci.log` | `npm run release` — streamed GH Actions output during a CI release | Truncated each release |

```bash
npx mgr logs                  # tail last 50 of runtime.log
npx mgr logs --tail           # follow runtime.log live
tail -f logs/dev.log          # gulp pipeline output
grep -i error logs/runtime.log
```

In production, `runtime.log` lives at `app.getPath('logs')`:
- macOS: `~/Library/Logs/<AppName>/runtime.log`
- Windows: `%APPDATA%\<AppName>\logs\runtime.log`
- Linux: `~/.config/<AppName>/logs/runtime.log`

See [docs/logging.md](docs/logging.md) for the full picture (renderer forwarding, log levels, programmatic path access).

Override gulp's `dev.log` path via `EM_LOG_FILE=<path>`; disable entirely via `EM_LOG_FILE=false`. The default `.gitignore` includes `logs/`.

## Per-process imports

```js
// src/main.js
new (require('electron-manager/main'))().initialize();

// src/preload.js
new (require('electron-manager/preload'))().initialize();

// src/assets/js/components/<view>/index.js
new (require('electron-manager/renderer'))().initialize();
```

## Documentation

Each subsystem has its own API reference under [`docs/`](docs/):

- [storage](docs/storage.md) — KV store, sync in main, async (via IPC) in renderer, dot-notation paths, change broadcasts
- [ipc](docs/ipc.md) — typed channel bus, `handle` / `invoke` / `broadcast`
- [windows](docs/windows.md) — lazy named-window registry (no auto-create), bounds persistence, inset titlebar, hide-on-close
- [tray](docs/tray.md) — file-based tray definition, dynamic items, runtime mutators
- [menu](docs/menu.md) — file-based application menu, platform-aware default template
- [context-menu](docs/context-menu.md) — file-based right-click menus, called per-event with `params`
- [startup](docs/startup.md) — launch modes (`normal` / `hidden`), LSUIElement on macOS, login-item handling
- [app-state](docs/app-state.md) — first-launch / launch-count / crash-sentinel flags
- [deep-link](docs/deep-link.md) — cross-platform deep links, single-instance, pattern routing, built-in routes
- [web-manager-bridge](docs/web-manager-bridge.md) — Firebase auth state synchronized across main + every renderer
- [auto-updater](docs/auto-updater.md) — startup + periodic checks, 30-day max-age gate, dev simulation
- [analytics](docs/analytics.md) — GA4 Measurement Protocol with cross-platform `uuidv5` identity (same human → same `user_id` across desktop/web/backend)
- [context](docs/context.md) — runtime info block (geolocation, client, session, app) — BEM-shaped
- [usage](docs/usage.md) — opens / hoursTotal / hoursThisSession; clean-exit accumulation
- [remote-config](docs/remote-config.md) — "hot config" fetched from brand site for runtime flag flips without re-releases
- [restart-manager](docs/restart-manager.md) — auxiliary helper app for relaunches; auto-installs via signed mac.zip / NSIS exe / browser-opened .deb
- [config-schema](docs/config-schema.md) — canonical schema + validator for `config/electron-manager.json`. Hard-fails boot AND `gulp audit` on missing required fields, regex mismatches, enum violations, type mismatches. Single source of truth in `src/config/schema.js`
- [templating](docs/templating.md) — `{{ var }}` token replacement, page template, body-only views
- [themes](docs/themes.md) — classy + bootstrap themes, `@use 'electron-manager' as * with (...)` overrides, per-page CSS bundles, system-aware appearance (`manager.theme`)
- [sentry](docs/sentry.md) — error/crash reporting, dev-mode gating, auto auth attribution, release tagging
- [hooks](docs/hooks.md) — lifecycle hooks (build/pre, build/post, release/pre, release/post, notarize)
- [installer-options](docs/installer-options.md) — installer/distribution config: NSIS one-click defaults, ia32 inclusion, app.category mapping, `{YEAR}` copyright token, snap publishing (default-on with cred-gated auto-skip), MAS roadmap
- [signing](docs/signing.md) — macOS + Windows code signing reference, cert files, env vars
- [releasing](docs/releasing.md) — end-to-end release walkthrough (`.env` → GitHub Release)
- [runner](docs/runner.md) — Windows EV-token signing runner — `npx mgr runner install`, auto-onboards new GH orgs, `npx mgr runner monitor` for a live signing event tail
- [test-framework](docs/test-framework.md) — writing tests, running them, layers
- [test-boot-layer](docs/test-boot-layer.md) — boot test layer (spawns the consumer's actual built bundle for end-to-end smoke tests)
- [build-system](docs/build-system.md) — gulp, webpack, electron-builder pipeline

## Status

Active development on `v1`. See [`PROGRESS.md`](PROGRESS.md) for pass-by-pass progress.
