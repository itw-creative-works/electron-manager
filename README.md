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
- **File-based feature definitions** — trays, menus, and context-menus are JS files (full power, no DSL): `src/integrations/{tray,menu,context-menu}/index.js`. All three ship sensible **id-tagged defaults** (legacy-EM-style: about, preferences, check-for-updates, dev menu w/ inspector + log folders, etc.) and share the same **id-path mutation API**: `find`, `update`, `remove`, `enable`, `show`, `hide`, `insertBefore`, `insertAfter`, `appendTo`. Any default item is one line away from removal, customization, or repositioning.
- **Lazy windows + Discord-style hide-on-close.** EM doesn't auto-create any windows — your `main.js` calls `manager.windows.create('main')` when UI should appear (or never, for agent apps). The `main` window's X button hides instead of quitting on every platform; real quit only via Cmd+Q / menu Quit / tray Quit / auto-update install. Inset titlebar by default (mac `hiddenInset` traffic lights / win native overlay buttons / linux native frame) with a draggable topbar in the page template.
- **Zero-bounce hidden-launch on macOS.** `startup.mode = 'hidden'` bakes `LSUIElement: true` into Info.plist at build time → app launches completely invisible (no dock icon, no Cmd+Tab, no taskbar). Tray + notifications + networking still work. The first time `manager.windows.create()` runs, EM auto-calls `app.dock.show()` so the dock icon appears alongside the window.
- **Auto-update background install.** When a download finishes from a background poll (not user-initiated), EM auto-relaunches into the new version after 5s — apps update overnight without bothering the user. User-initiated checks skip this so your UI can prompt instead.
- **Webpack-bundled** main / preload / renderer for source protection.
- **Built-in test framework** — Jest-like syntax, four layers: `build` (plain Node), `main` (spawned Electron), `renderer` (hidden BrowserWindow), and `boot` (spawns the consumer's actual built `dist/main.bundle.js` for end-to-end smoke tests against the live manager — no `npm start && sleep && kill` shell hacks). Boot layer always rebuilds the bundle first so tests never see stale code.
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

Three logs in `<projectRoot>/logs/`, each with its own purpose:

| File | What | Lifetime |
|---|---|---|
| `runtime.log` | Your packaged app's runtime — main + preload + renderer all converge here via electron-log | Persistent, rotates at 10 MB |
| `dev.log` | Gulp pipeline output — sass, webpack, html, electron child stdout from `npm start` | Truncated each run |
| `build.log` | `npm run release` — streamed GH Actions output during a CI release | Truncated each run |

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
- [templating](docs/templating.md) — `{{ var }}` token replacement, page template, body-only views
- [themes](docs/themes.md) — classy + bootstrap themes, `@use 'electron-manager' as * with (...)` overrides, per-page CSS bundles
- [sentry](docs/sentry.md) — error/crash reporting, dev-mode gating, auto auth attribution, release tagging
- [hooks](docs/hooks.md) — lifecycle hooks (build/pre, build/post, release/pre, release/post, notarize)
- [signing](docs/signing.md) — macOS + Windows code signing reference, cert files, env vars
- [releasing](docs/releasing.md) — end-to-end release walkthrough (`.env` → GitHub Release)
- [runner](docs/runner.md) — Windows EV-token signing runner — `npx mgr runner install`, auto-onboards new GH orgs
- [test-framework](docs/test-framework.md) — writing tests, running them, layers
- [test-boot-layer](docs/test-boot-layer.md) — boot test layer (spawns the consumer's actual built bundle for end-to-end smoke tests)
- [build-system](docs/build-system.md) — gulp, webpack, electron-builder pipeline

## Status

Active development on `v1`. See [`PROGRESS.md`](PROGRESS.md) for pass-by-pass progress.
