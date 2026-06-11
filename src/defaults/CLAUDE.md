# ========== Default Values ==========
# Electron Manager (EM) — consumer project

## Framework

This project consumes **Electron Manager** (EM) — a comprehensive framework for building modern Electron desktop apps. EM provides one-line-import bootstrap per Electron process, a modular feature library with file-based extensibility, a multi-platform build/release pipeline (DMG / NSIS / deb / AppImage), and a built-in four-layer test framework.

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, Claude MUST read the framework documentation — that is where the architecture, conventions, APIs, and gotchas live. Skipping these will result in solutions that conflict with framework patterns.**

**Required reading:**
- **`node_modules/electron-manager/CLAUDE.md`** — top-level overview + index
- **`node_modules/electron-manager/docs/`** — subsystem deep references (read the relevant ones for the task at hand)

## 🚨 READ WEB-MANAGER TOO

**EM ships `web-manager` as a runtime singleton inside the renderer process** — it powers auth, Firebase, reactive `data-wm-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with web-manager as much as with EM.

**Required reading:**
- **`node_modules/web-manager/CLAUDE.md`** — top-level overview + index
- **`node_modules/web-manager/docs/`** — module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick start

```bash
npm start           # dev with auto-reload (gulp → webpack → electron .)
npm run build       # local production build (compiles bundles only, no installer)
npm run package     # full local production package (DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux)
npm run package:quick   # fast packaged build for the host platform/arch only (~20-30s)
npm run release     # signed + published release (requires certs)
npx mgr test        # run framework + project test suites
npx mgr test build/config         # run a specific test by path (relative to test/)
npx mgr test project:             # run ONLY your project tests (all of them)
npx mgr test project:custom-test  # run only consumer project tests matching a path
npx mgr test mgr:                 # run ONLY framework tests (universal alias; em:/framework: are equivalent)
npx mgr test em:build/config      # run only framework tests matching a path
# (output is teed to logs/ — dev.log on `npm start`, build.log on `npm run build`, test.log on `npx mgr test`; cat instead of scrolling scrollback)
npx mgr install dev  # use LOCAL electron-manager source (to test framework edits)
npx mgr install live # restore the published electron-manager from npm
```

> Editing the EM framework source while working here? Run `npx mgr install dev` so this project picks up your uncommitted framework changes (it otherwise uses its installed `node_modules/electron-manager`). Run `npx mgr install live` to switch back.

## Where things live

- `config/electron-manager.json` — JSON5 config: brand, autoUpdate, tray, menu, deep links, signing strategy, startup mode.
- Packaging config — fully generated. EM produces `dist/electron-builder.yml` from `config/electron-manager.json` (brand/app/signing) + EM's opinionated defaults. Consumers never ship an `electron-builder.yml`. Override defaults via the `electronBuilder:` block in `electron-manager.json` if you genuinely need to.
- `hooks/notarize/post.js` — optional post-notarize extension hook (EM owns the actual `afterSign` notarize step).
- `src/main.js` — main-process entry. One-line bootstrap of `electron-manager/main`.
- `src/preload.js` — preload entry. Exposes `window.em` via contextBridge.
- `src/integrations/tray/index.js` — tray definition. Edit this; it's yours.
- `src/integrations/menu/index.js` — application menu definition.
- `src/integrations/context-menu/index.js` — right-click menu definition (called per-event with `params`).
- `src/views/<window>/index.html` — per-window HTML.
- `src/assets/js/components/<window>/index.js` — renderer entry per window.
- `src/assets/scss/main.scss` — shared SCSS.
- `config/icons/<platform>/<slot>.png` — optional icon overrides (`macos/icon.png`, `macos/tray.png`, `macos/dmg.png`, `windows/icon.png`, etc.). Ship ONE file per slot at the native (retina) size — EM auto-downscales @1x variants. macOS tray must be 32×32 (EM renames to `trayTemplate.png` in dist for the OS dark-mode magic). Missing slots fall back to EM bundled defaults; Linux falls back to Windows resolution.
- `test/**/*.js` — your project test suites (framework auto-runs them alongside its own).

## Per-process imports

```js
// src/main.js
new (require('electron-manager/main'))().initialize();   // auto-loads JSON5 config

// src/preload.js
new (require('electron-manager/preload'))().initialize();

// src/assets/js/components/main/index.js
new (require('electron-manager/renderer'))().initialize();
```

## Available APIs at runtime

In main: `manager.storage`, `manager.ipc`, `manager.windows`, `manager.tray`, `manager.menu`, `manager.contextMenu`, `manager.startup`, `manager.appState`, `manager.deepLink`, `manager.autoUpdater`, `manager.sentry`, `manager.webManager`, `manager.context`, `manager.usage`, `manager.remoteConfig`, `manager.analytics`, `manager.restartManager`.

In renderer: `window.em.storage`, `window.em.ipc`, `window.em.logger`, `EM_BUILD_JSON.config`.

## Dependency resolution

- **Do NOT install framework dependencies directly** (`firebase`, `fs-jetpack`, `web-manager`, etc.). EM's webpack config resolves them through the framework's own `node_modules/`. If something doesn't resolve, the issue is in EM's webpack config — not your `package.json`.
- **web-manager owns Firebase.** Never `require('firebase')` or `import('firebase/app')`. Use `require('web-manager')` → `webManager.auth()`, `webManager.firestore()` in renderers. In main process, use `manager.webManager` (the EM bridge).
- **`Manager.require(name)`** resolves from EM's module context at runtime for unbundled code (gulp tasks, test fixtures).

## Testing

Every feature ships with tests at every layer it has a surface in: **logic** (`test/build/`, `test/main/`), **UI** (`test/renderer/` — real events on the real DOM), and **end-to-end** (`test/boot/`). Skip a layer only when the feature genuinely has no surface there — "the logic test covers it" does not excuse the UI test. See `test/README.md` and `node_modules/electron-manager/docs/test-framework.md`.

<!-- Everything above this marker is owned by the framework and rewritten on every `npx mgr setup`. Add your project-specific notes below — they are preserved across setups. -->

# ========== Custom Values ==========

## Project-specific notes

Add anything specific to THIS project here. Edits below this line are preserved across `npx mgr setup` runs.
