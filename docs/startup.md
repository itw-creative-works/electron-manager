# Startup

Controls how the app launches: window-shown vs window-hidden vs tray-only background app. Also handles open-at-login.

## Config

```jsonc
"startup": {
  "mode":        "normal",     // 'normal' | 'hidden' | 'tray-only'
  "openAtLogin": false
}
```

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
manager.startup.getMode()           // 'normal' | 'hidden' | 'tray-only'
manager.startup.isLaunchHidden()    // true for hidden + tray-only
manager.startup.isTrayOnly()        // true only for tray-only
manager.startup.applyEarly()        // calls app.dock.hide() if needed (called by main.js boot)

manager.startup.setOpenAtLogin(true)   // sync with OS login items
manager.startup.isOpenAtLogin()        // read live OS state
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
