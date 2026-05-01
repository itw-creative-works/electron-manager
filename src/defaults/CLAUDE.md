# MyApp — Electron app built on electron-manager

## Quick start

```bash
npm start          # dev with auto-reload
npm run build      # local production build
npm run release    # signed + published release (requires certs)
npx mgr test       # run framework + project test suites
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
- `config/icons/<platform>/<slot>.png` — optional icon overrides (`macos/icon.png`, `macos/trayTemplate.png`, `windows/icon.png`, etc.). Missing slots fall back to EM bundled defaults; Linux falls back to Windows resolution.
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

In main: `manager.storage`, `manager.ipc`, `manager.windows`, `manager.tray`, `manager.menu`, `manager.contextMenu`, `manager.startup`, `manager.appState`, `manager.deepLink`, `manager.autoUpdater`, `manager.sentry`, `manager.webManager`.

In renderer: `window.em.storage`, `window.em.ipc`, `window.em.logger`, `EM_BUILD_JSON.config`.

## Documentation

Full API references: see [`electron-manager/docs/`](../node_modules/electron-manager/docs/) or the [GitHub repo](https://github.com/itw-creative-works/electron-manager/tree/main/docs).
