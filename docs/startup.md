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

Standard app behavior. Your `main.js` calls `manager.windows.create('main')` from inside `manager.initialize().then(...)` — typically gated on `if (!startup.isLaunchHidden())` so the same `main.js` works for both modes. Dock visible (macOS), taskbar entry (win/linux).

### `hidden`

App launches **completely invisible**: no dock icon, no Cmd+Tab presence, no taskbar entry. Tray + notifications + networking + IPC + auto-update all still work — only the visible UI is suppressed. Production builds inject `LSUIElement: true` into `Info.plist` (via `gulp/build-config`) so macOS treats the process as a background agent from launch — **zero dock bounce**.

When the consumer surfaces UI later via `manager.windows.create('main')` (from a tray click, deep-link, IPC event, or anything else), EM auto-runs `app.dock.show()` and the dock icon appears alongside the window. Reverse with `app.dock.hide()` to go back to invisible.

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
  // Surface the main window unless we're in hidden launch mode.
  if (!manager.startup.isLaunchHidden()) {
    manager.windows.create('main');
  }
  // Hidden mode? UI surfaces from a tray click / deep-link / IPC event later.
});
```

## Boot order

`startup.applyEarly()` is the **first** call in `Manager.initialize()` — before `whenReady`, before any other lib. The goal: spend as little time as possible in the dock-bounce window.

Sequence: applyEarly → before-quit hook → ipc → storage → sentry → protocol → deep-link → app-state → whenReady → updater → tray/menu/contextMenu → startup.initialize → web-manager → windows.initialize. **EM no longer auto-creates the main window** — your `main.js` does that inside the `.then()` callback after `initialize()` resolves.

## How zero-bounce works on macOS

`LSUIElement` is an `Info.plist` key that tells macOS *before launch* "this app is a background agent — don't put it in the dock or app switcher." Setting it at runtime (`app.dock.hide()`) is too late — by the time JS runs, the dock-bounce animation has already started.

EM handles this at build time:
1. `gulp/build-config` reads `config/electron-manager.json`.
2. If `startup.mode === 'hidden'`, it injects `mac.extendInfo.LSUIElement: true` into the materialized `dist/electron-builder.yml`.
3. `electron-builder` packages the app with that key in the final `Info.plist`.

At runtime, when the consumer first calls `manager.windows.create()` or `manager.windows.show()`, EM calls `app.dock.show()` so the dock icon appears alongside the window. Reverses cleanly via `app.dock.hide()` if you want to go back to invisible.

The injection is YAML-text-level (preserves comments, idempotent, merges with existing `extendInfo`). See `src/gulp/tasks/build-config.js`.

## Pairing with tray/window patterns

Hidden / agent apps usually want:

```jsonc
"startup": { "mode": "hidden" }
```

And in `src/integrations/tray/index.js`:

```js
tray.update('open', { click: () => manager.windows.create('main') });
```

The window doesn't exist at launch (no dock icon, no UI). When the user clicks the tray's "Open" item, `windows.create('main')` runs, EM calls `app.dock.show()`, and the user sees both the dock icon and the window appear together.
