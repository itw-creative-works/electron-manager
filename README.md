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
- **Modular feature library** — storage, IPC, tray, menu, context menu, window manager, startup, app-state, deep-link, auto-updater, web-manager auth, Sentry. Each feature is its own module with documented API.
- **File-based feature definitions** — trays, menus, and context-menus are JS files (full power, no DSL): `src/tray/index.js`, `src/menu/index.js`, `src/context-menu/index.js`.
- **Zero-bounce tray-only launch on macOS** — production builds inject `LSUIElement: true` into Info.plist via build-config. No dock animation, no flash.
- **Webpack-bundled** main / preload / renderer for source protection.
- **Built-in test framework** — Jest-like syntax, three layers (build / main / renderer), spawns Electron for main-process tests.
- **Multi-platform build/release** via GitHub Actions — macOS sign + notarize, Linux, Windows EV-token signing (self-hosted runner now, cloud-signing pluggable).

## Quick start (consumer)

EM auto-syncs your system Node version to match whatever Node Electron's bundled runtime ships with. `npx mgr setup` queries the official Electron releases feed using your installed Electron version, then writes the corresponding Node major to `.nvmrc`. Run `nvm use` afterward to switch your shell.

```bash
npm install electron-manager --save-dev
npx mgr setup        # scaffolds project; auto-resolves & writes correct .nvmrc from electron version
nvm use              # switch to the Node version Electron uses (one-time per shell)
npm start            # dev: gulp → webpack → electron .
npm run build        # local production build
npm run release      # signed + published release
npx mgr test         # run framework + project test suites
```

## Logs

Every `npm start` (and any other gulp invocation) tees its complete stdout + stderr to `<projectRoot>/logs/dev.log` — gulp tasks, electron child, console output, the works. ANSI color codes are stripped from the file (terminal output stays colored). The file is truncated fresh on each run.

```bash
tail -f logs/dev.log              # live tail
grep -i error logs/dev.log        # search
```

Override path via `EM_LOG_FILE=<path>`. Disable entirely via `EM_LOG_FILE=false`. The default `.gitignore` includes `logs/`.

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
- [windows](docs/windows.md) — named-window registry, bounds persistence, hide-on-close
- [tray](docs/tray.md) — file-based tray definition, dynamic items, runtime mutators
- [menu](docs/menu.md) — file-based application menu, platform-aware default template
- [context-menu](docs/context-menu.md) — file-based right-click menus, called per-event with `params`
- [startup](docs/startup.md) — launch modes (`normal` / `hidden` / `tray-only`), zero-bounce production
- [app-state](docs/app-state.md) — first-launch / launch-count / crash-sentinel flags
- [deep-link](docs/deep-link.md) — cross-platform deep links, single-instance, pattern routing, built-in routes
- [web-manager-bridge](docs/web-manager-bridge.md) — Firebase auth state synchronized across main + every renderer
- [auto-updater](docs/auto-updater.md) — startup + periodic checks, 30-day max-age gate, dev simulation
- [templating](docs/templating.md) — `{{ var }}` token replacement, page template, body-only views
- [themes](docs/themes.md) — classy + bootstrap themes, `@use 'electron-manager' as * with (...)` overrides, per-page CSS bundles
- [sentry](docs/sentry.md) — error/crash reporting, dev-mode gating, auto auth attribution, release tagging
- [hooks](docs/hooks.md) — lifecycle hooks (build/pre, build/post, release/pre, release/post, notarize)
- [signing](docs/signing.md) — macOS + Windows code signing reference, cert files, env vars
- [releasing](docs/releasing.md) — end-to-end release walkthrough (`.env` → GitHub Release)
- [runner](docs/runner.md) — Windows EV-token signing runner — `npx mgr runner bootstrap`, auto-onboards new GH orgs
- [test-framework](docs/test-framework.md) — writing tests, running them, layers
- [build-system](docs/build-system.md) — gulp, webpack, electron-builder pipeline

## Status

Active development on `v1`. See [`PROGRESS.md`](PROGRESS.md) for pass-by-pass progress.
