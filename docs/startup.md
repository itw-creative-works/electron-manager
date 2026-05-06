# Startup

Controls how the app launches: full normal launch vs completely hidden background app. Also handles open-at-login.

## Config

```jsonc
"startup": {
  "mode": "normal",                // user-launch behavior: 'normal' | 'hidden'
  "openAtLogin": {
    "enabled": true,               // OS auto-launches the app at login
    "mode":    "hidden"            // login-launch behavior (defaults to 'hidden')
  }
}
```

`mode` is what happens when **the user launches the app directly** (clicks the dock icon / Start menu / etc.).

`openAtLogin.mode` is what happens when **the OS auto-launches the app at login**. It applies *only* when the launch is detected as a login-launch (macOS: `wasOpenedAtLogin` flag; Windows/Linux: presence of the `--em-launched-at-login` arg EM passes when registering the login item).

The default behavior — `mode: 'normal'` + `openAtLogin: { enabled: true, mode: 'hidden' }` — means: the app auto-starts at login but stays out of the way until the user opens it themselves. User-direct launches show the main window like any normal app.

## Modes

### `normal` (default)

Standard app behavior. Your `main.js` calls `windows.create('main', { show: !startup.isLaunchHidden() })` from inside `manager.initialize().then(...)`. In `normal` mode, `show` is `true` so the window appears immediately. Dock visible (macOS), taskbar entry (win/linux).

### `hidden`

App launches **completely invisible**: no dock icon, no Cmd+Tab presence, no taskbar entry. Tray + notifications + networking + IPC + auto-update all still work — only the visible UI is suppressed. Production builds inject `LSUIElement: true` into `Info.plist` (via `gulp/build-config`) so macOS treats the process as a background agent from launch — **zero dock bounce**.

The `main` window is still created (just with `show: false`) so it sits in EM's window registry. When the user double-clicks the running app's icon, EM's `app.on('activate')` (macOS) / `app.on('second-instance')` (win/linux) handler finds `main` in the registry and calls `windows.show('main')` — which auto-runs `app.dock.show()` so the dock icon appears alongside the window. Same thing happens when the consumer manually surfaces UI from a tray click / deep-link / IPC event via `windows.show('main')`.

Use this for: menubar apps, agent apps (clipboard managers, time trackers, system monitors), apps that should be invisible at boot but available on demand.

**Dev caveat**: in dev (`npm start` / `electron .`), the packaged `Info.plist` isn't in effect, so macOS will still briefly bounce. Production builds (`npm run build` / `npm run release`) get the real zero-bounce behavior.

> **Note:** the deprecated `'tray-only'` mode is no longer valid — its behavior was always identical to `'hidden'`, so they've been folded into one. Old `tray-only` configs fall back to `'normal'` per `getMode()` validation.

## Public API on `manager.startup`

```js
manager.startup.getMode()                  // user-launch mode: 'normal' | 'hidden'
manager.startup.isLaunchHidden()           // true if THIS launch is hidden — combines
                                           //   user-launch mode + login-launch detection.
                                           //   Use this in main.js to gate windows.create().
manager.startup.wasLaunchedAtLogin()       // true if the OS auto-launched us at login
manager.startup.applyEarly()               // calls app.dock.hide() if needed (called by main.js boot)

manager.startup.setOpenAtLogin(true)                            // back-compat boolean form
manager.startup.setOpenAtLogin({ enabled: true, mode: 'hidden' }) // object form
manager.startup.isOpenAtLogin()            // read live OS state
```

## Typical main.js pattern

```js
manager.initialize().then(() => {
  // Always create the main window. In hidden launches, `show: false` keeps it
  // invisible until something explicitly calls windows.show('main') — but it's
  // in the registry, so EM's activate/second-instance handlers can find and
  // surface it when the user double-clicks the running app.
  manager.windows.create('main', {
    show: !manager.startup.isLaunchHidden(),
  });
});
```

Don't conditionally skip `create()` for hidden launches — without `main` in the registry, the dock-click / re-launch handlers have nothing to surface, and the user double-clicking the running app appears to do nothing.

## Boot order

`startup.applyEarly()` is the **first** call in `Manager.initialize()` — before `whenReady`, before any other lib. The goal: spend as little time as possible in the dock-bounce window.

Sequence: applyEarly → before-quit hook → ipc → storage → sentry → protocol → deep-link → app-state → whenReady → updater → tray/menu/contextMenu → startup.initialize → web-manager → windows.initialize. **EM no longer auto-creates the main window** — your `main.js` does that inside the `.then()` callback after `initialize()` resolves.

## How zero-bounce works on macOS

`LSUIElement` is an `Info.plist` key that tells macOS *before launch* "this app is a background agent — don't put it in the dock or app switcher." Setting it at runtime (`app.dock.hide()`) is too late — by the time JS runs, the dock-bounce animation has already started.

EM handles this at build time:
1. `gulp/build-config` reads `config/electron-manager.json`.
2. If `startup.mode === 'hidden'`, it injects `mac.extendInfo.LSUIElement: true` into the materialized `dist/electron-builder.yml`.
3. `electron-builder` packages the app with that key in the final `Info.plist`.

At runtime, when the consumer first calls `manager.windows.show()` (or the `windows.create()` call resolves with `show: true`), EM calls `app.dock.show()` so the dock icon appears alongside the window. Reverses cleanly via `app.dock.hide()` if you want to go back to invisible.

The injection is YAML-text-level (preserves comments, idempotent, merges with existing `extendInfo`). See `src/gulp/tasks/build-config.js`.

## Re-surfacing on user re-launch

When the user double-clicks a running hidden-mode app (or clicks its dock icon on macOS), EM transparently surfaces the main window — no consumer wiring needed. Mechanisms:

- **macOS**: `window-manager.initialize()` registers `app.on('activate')` which calls `windows.show('main')` if `main` is in the registry.
- **Windows / Linux**: `deep-link.initialize()` registers `app.on('second-instance')` which does the same. (The OS spawns a duplicate process, the single-instance lock kills it, and forwards its argv to the original instance.)

Both handlers are no-ops if `main` isn't in the registry, so consumers who genuinely never want a window can omit `windows.create('main', ...)` entirely. Otherwise, with the canonical pattern (`windows.create('main', { show: !isLaunchHidden() })`), hidden-mode apps come back to life on a second click — like CleanMyMac, Rectangle, etc.

## Testing the login-launch path locally

Pass `--em-launched-at-login` as a command-line arg when launching the .app; EM treats it identically to a real OS-driven login launch (`startup.wasLaunchedAtLogin()` returns `true`, with `via:argv-flag` in the boot summary log). Useful for testing hidden-mode behavior without configuring login items + rebooting.

The easiest way is `mgr launch`, which auto-strips `ELECTRON_RUN_AS_NODE` and uses `open -n` under the hood:

```bash
# Auto-discover the most recent `mgr package:quick` build:
npx mgr launch --args="--em-launched-at-login"

# Or pass an explicit path:
npx mgr launch /Applications/MyApp.app --args="--em-launched-at-login"
```

If you'd rather call `open` directly, remember to strip `ELECTRON_RUN_AS_NODE` first (the variable leaks into shells from common host processes like VS Code's Claude Code extension and silently breaks Electron):

```bash
unset ELECTRON_RUN_AS_NODE
open -n /path/to/MyApp.app --args --em-launched-at-login

# Windows / Linux — direct binary launch
"/path/to/MyApp.exe" --em-launched-at-login
```

The boot summary log written by the `startup` lib distinguishes a real login launch (`via:macos-wasOpenedAtLogin`) from a flag-based simulation (`via:argv-flag`).

## Pairing with tray/window patterns

Hidden / agent apps usually want:

```jsonc
"startup": { "mode": "hidden" }
```

And in `src/integrations/tray/index.js`:

```js
tray.update('open', { click: () => manager.windows.show('main') });
```

The window is created at boot but invisible. When the user clicks the tray's "Open" item (or double-clicks the app icon), `windows.show('main')` runs, EM calls `app.dock.show()`, and the user sees both the dock icon and the window appear together.
