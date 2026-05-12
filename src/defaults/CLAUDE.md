# ========== Default Values ==========
# Electron Manager (EM) — consumer project

> **Auto-managed file.** Everything between `# ========== Default Values ==========` and `# ========== Custom Values ==========` is owned by `electron-manager` and rewritten on every `npx mgr setup`. Put your own project-specific notes BELOW the `Custom Values` marker — that section is preserved verbatim across setups.

## Framework

This project consumes **Electron Manager** (EM) — a comprehensive framework for building modern Electron desktop apps. EM provides one-line-import bootstrap per Electron process, a modular feature library with file-based extensibility, a multi-platform build/release pipeline (DMG / NSIS / deb / AppImage), and a built-in four-layer test framework.

**Framework's own docs** (read these for deep-dives; both paths point to the same files, the absolute path works regardless of working directory):
- Top-level overview: `/Users/ian/Developer/Repositories/ITW-Creative-Works/electron-manager/CLAUDE.md` (or `node_modules/electron-manager/CLAUDE.md`)
- Subsystem references: `/Users/ian/Developer/Repositories/ITW-Creative-Works/electron-manager/docs/` (or `node_modules/electron-manager/docs/`)

## Quick start

```bash
npm start           # dev with auto-reload (gulp → webpack → electron .)
npm run build       # local production build (compiles bundles only, no installer)
npm run package     # full local production package (DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux)
npm run package:quick   # fast packaged build for the host platform/arch only (~20-30s)
npm run release     # signed + published release (requires certs)
npx mgr test        # run framework + project test suites
```

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

# ========== Custom Values ==========

## Project-specific notes

Add anything specific to THIS project here. Edits below this line are preserved across `npx mgr setup` runs.
