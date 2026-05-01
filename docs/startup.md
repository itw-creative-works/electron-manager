# Startup

Controls how the app launches: window-shown vs window-hidden vs tray-only background app. Also handles open-at-login.

## Config

```jsonc
"startup": {
  "mode": "normal",                // user-launch behavior: 'normal' | 'hidden' | 'tray-only'
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

Standard app behavior. Main window auto-creates and auto-shows on launch. Dock visible (macOS), taskbar entry (win/linux).

### `hidden`

Dock-visible app but no window is auto-shown on launch. Consumer surfaces UI explicitly via `manager.windows.show('main')` from a tray click, deep-link, or IPC event.

**Caveat**: macOS will still bounce the dock briefly on launch. There's no plist trick that gives you "dock-icon-yes, dock-bounce-no" simultaneously — if you need zero bounce, use `tray-only`.

### `tray-only`

True agent app: zero dock bounce, no permanent dock icon, no taskbar entry. Production builds inject `LSUIElement: true` into `Info.plist` (via `gulp/build-config`) so macOS treats the process as a background agent from launch. All windows get `skipTaskbar: true` automatically (handles win/linux).

You can still show windows in `tray-only` mode — they appear, work normally, and dismiss without leaving a permanent dock entry. Use this for menubar apps (Slack-tray-style, time trackers, system monitors).

**Dev caveat**: in dev (`npm start` / `electron .`), the packaged `Info.plist` isn't in effect, so macOS will still briefly bounce. Production builds (`npm run build` / `npm run release`) get the real zero-bounce behavior.

## Public API on `manager.startup`

```js
manager.startup.getMode()                  // user-launch mode: 'normal' | 'hidden' | 'tray-only'
manager.startup.isLaunchHidden()           // true if THIS launch should not auto-show a window
                                           //   (combines user-launch mode + login-launch detection)
manager.startup.isTrayOnly()               // true only when user-launch mode is 'tray-only'
manager.startup.wasLaunchedAtLogin()       // true if the OS auto-launched us at login
manager.startup.applyEarly()               // calls app.dock.hide() if needed (called by main.js boot)

manager.startup.setOpenAtLogin(true)                            // back-compat boolean form
manager.startup.setOpenAtLogin({ enabled: true, mode: 'hidden' }) // object form
manager.startup.isOpenAtLogin()            // read live OS state
```

## Boot order

`startup.applyEarly()` is the **first** call in `Manager.initialize()` — before `whenReady`, before any other lib. The goal: spend as little time as possible in the dock-bounce window.

Sequence: applyEarly → ipc → storage → sentry → protocol → deep-link → app-state → whenReady → updater → tray/menu/contextMenu → startup.initialize → web-manager → windows → conditional `createNamed('main')`.

## How zero-bounce works on macOS

`LSUIElement` is an `Info.plist` key that tells macOS *before launch* "this app is a background agent — don't put it in the dock or app switcher." Setting it at runtime (`app.dock.hide()`) is too late — by the time JS runs, the dock-bounce animation has already started.

EM handles this at build time:
1. `gulp/build-config` reads `config/electron-manager.json`.
2. If `startup.mode === 'tray-only'`, it injects `mac.extendInfo.LSUIElement: true` into the materialized `dist/electron-builder.yml`.
3. `electron-builder` packages the app with that key in the final `Info.plist`.

The injection is YAML-text-level (preserves comments, idempotent, merges with existing `extendInfo`). See `src/gulp/tasks/build-config.js`.

## Pairing with tray/window patterns

Tray-only apps usually want:

```jsonc
"startup": { "mode": "tray-only" },
"tray":    { "enabled": true },
"windows": {
  "main": { "view": "main", "show": false, "hideOnClose": true }
}
```

And in `src/tray/index.js`:

```js
tray.item({ label: 'Open', click: () => manager.windows.show('main') });
```

The window exists (created on first show, persisted bounds) but the app feels tray-resident.
