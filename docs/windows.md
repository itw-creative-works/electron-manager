# Windows

**Lazy named-window registry.** EM does NOT auto-create any window. Your `main.js` calls `manager.windows.create('main', { show: !startup.isLaunchHidden() })` from inside `manager.initialize().then(() => { ... })`. Always create `main` — its presence in the registry is what lets EM's `app.on('activate')` (macOS dock click) and `app.on('second-instance')` (win/linux re-launch) handlers surface UI when the user double-clicks the running app. In hidden launches, pass `show: false` to keep the window invisible until something explicitly calls `windows.show('main')`. Use the registry for the common case (named, persistent, integrated windows). For one-off windows (a toast, a print preview), use `new BrowserWindow()` directly — `window-manager` doesn't get in the way.

## Re-surface on user re-launch

When the user double-clicks a running app (or clicks its dock icon on macOS), EM transparently shows the main window — no consumer wiring needed.

- **macOS** → `app.on('activate')` calls `windows.show('main')` if `main` is in the registry.
- **Windows / Linux** → `app.on('second-instance')` does the same. (The OS spawns a duplicate process, the single-instance lock kills it, and the original instance receives the activation.)

Both handlers are no-ops if `main` isn't in the registry. So consumers who genuinely never want a window can omit `windows.create('main', ...)`. Otherwise, the canonical pattern (`windows.create('main', { show: !isLaunchHidden() })`) gives CleanMyMac-style behavior: tray-only at login, full window when the user manually opens the app.

## API

```js
await manager.windows.create('main', overrides?)        // canonical entry point
await manager.windows.createNamed('main', mgr, opts?)   // identical; .create() is sugar
manager.windows.get('main')                              // BrowserWindow | null
manager.windows.show('main')                             // show + focus + auto app.dock.show()
manager.windows.hide('main')
manager.windows.close('main')                            // force-close (bypasses hideOnClose)
manager.windows.list()                                   // string[] of currently-open names
```

`create()` is single-instance: a second call with the same name returns the existing window and focuses it (no double-create).

## Defaults

No JSON config required. EM bakes in sensible defaults so `manager.windows.create('main')` "just works":

| Window | Defaults |
|---|---|
| `main`         | `{ width: 1024, height: 720, hideOnClose: true,  view: 'main' }` |
| any other name | `{ width: 800,  height: 600, hideOnClose: false, view: name   }` |

Override at the call site:

```js
manager.windows.create('main',     { width: 1280, height: 800 });
manager.windows.create('settings', { width: 600,  height: 480 });
```

## Config (optional)

If you want to override defaults persistently (without typing them at every `create()` call), add a `windows:` block to `config/electron-manager.json`:

```jsonc
"windows": {
  "main": { "width": 1280, "height": 800 }
}
```

Merge order: **framework defaults < JSON config < call-site overrides**.

Per-window keys:

| Key | Default (main) | Default (other) | Description |
|---|---|---|---|
| `view` | `main` | `<name>` | Folder under `src/views/`. Loads `dist/views/<view>/index.html`. |
| `width` / `height` | 1024 / 720 | 800 / 600 | Initial size (overridden by saved bounds if `persistBounds: true`). |
| `minWidth` / `minHeight` | 400 / 300 | 400 / 300 | |
| `show` | `true` | `true` | Auto-show on `ready-to-show`. `false` keeps the window hidden until `manager.windows.show()`. |
| `hideOnClose` | `true` | `false` | Discord-style: X click hides instead of closes. See "Hide-on-close" below. |
| `title` | `app.productName` | `app.productName` | Window title. |
| `backgroundColor` | `#ffffff` | `#ffffff` | Background color before the page loads. |
| `persistBounds` | `true` | `true` | Remember position+size across launches (see below). |
| `skipTaskbar` | `false` | `false` | Suppress taskbar/dock entry for THIS window. |
| `titleBar` | `'inset'` | `'inset'` | `'inset'` (mac/win native overlay) or `'native'` (full system frame). |
| `titleBarOverlay` | platform default | platform default | Override Windows overlay color/symbolColor/height. |
| `trafficLightPosition` | OS inset default | OS inset default | macOS only: `{ x, y }` custom position for the traffic lights (e.g. to center them inside a floating chrome panel). Only applies in `'inset'` mode. |

## Inset titlebar (default)

EM ships an inset titlebar by default — the OS draws all the window controls and EM adds a draggable strip in the page template:

| Platform | Behavior |
|---|---|
| **macOS** | `titleBarStyle: 'hiddenInset'` — traffic lights inset into the chrome region. Reposition them via `config.windows.<name>.trafficLightPosition = { x, y }` (e.g. when the app draws a floating chrome panel and the lights should sit inside it). |
| **Windows** | `titleBarStyle: 'hidden'` + `titleBarOverlay: { color, symbolColor, height: 36 }` — native min/max/close buttons drawn by the OS |
| **Linux** | Native frame (full system title bar) |

The page template (`<em>/src/config/page-template.html`, EM-internal — not consumer-overrideable) ships an `.em-titlebar` div with `-webkit-app-region: drag`. Per-platform spacing is handled by `themes/classy/css/components/_titlebar.scss`, which keys off `html[data-platform]` (set by web-manager during init):

- **mac** → `padding-left: 70px` (clear the traffic lights)
- **windows** → `padding-right: 140px` (clear the native overlay)
- **linux** → `display: none` (native frame draws title bar)

Override per-window via `config.windows.<name>.titleBar = 'native'` to opt out and get a full system frame on every platform.

## Hide-on-close (Discord-style)

The `main` window's X button **hides instead of closes** by default. Real quit only via:

- `Cmd+Q` (macOS standard `role: 'quit'` accelerator)
- Menu Quit (`main/quit` on mac, `file/quit` on win/linux)
- Tray Quit (`quit` item)
- Auto-updater install (`autoUpdater.installNow()`)
- Programmatic `manager.quit({ force: true })`

The window-manager close handler checks three flags before deciding to swallow vs let through:

| Flag | Set by | Means |
|---|---|---|
| `manager._allowQuit` | `manager.quit({ force: true })`, `autoUpdater.installNow()` | Programmatic force — let the close go through. |
| `manager._isQuitting` | `app.on('before-quit')` (every quit path Electron knows about) | App is quitting — let close events flow naturally. |
| `win._emForceClose` | `manager.windows.close(name)` | Per-window override. |

Other named windows default to `hideOnClose: false` (X actually closes). Override per window via config or call-site overrides.

## Bounds persistence

Every named window's position and size persist to storage on resize / move / maximize / unmaximize / fullscreen-enter / fullscreen-leave / close. Restored on next `create()`.

- Storage key: `windows.<name>.bounds`
- Saves debounced 250ms; close flushes synchronously.
- Off-screen detection: if a saved position has less than 100×50px overlap with any current display's `workArea`, position is dropped (size kept). Handles "monitor unplugged" gracefully.
- Maximized / fullscreen state is stored separately and restored via `win.maximize()` / `win.setFullScreen(true)`.
- Sanity floor: saved entries with `width < 100` or `height < 100` are ignored.
- Opt out per-window: `persistBounds: false`.

## macOS dock auto-show

When `LSUIElement: true` is baked at build time (`startup.mode: 'hidden'`), the app launches with **no dock icon, no Cmd+Tab, no taskbar**. The first time `manager.windows.create()` or `manager.windows.show()` runs, EM calls `app.dock.show()` automatically — the dock icon appears alongside the window.

This means agent / menubar apps can stay completely invisible until the user explicitly asks for UI:

```js
manager.initialize().then(() => {
  // Don't call windows.create() here — app stays invisible.
  // Surface UI later when something warrants it:
  manager.tray.update('open', { click: () => manager.windows.create('main') });
});
```

## Auto-attach context-menu

Every window created via `manager.windows.create()` is automatically wired up with the consumer's `src/integrations/context-menu/index.js` (see [context-menu.md](context-menu.md)). Idempotent per webContents (uses a WeakSet). For windows you create directly with `new BrowserWindow()`, call `manager.contextMenu.attach(win.webContents)` manually.

## Testing mode: stealth surfacing

When `manager.isTesting()` (i.e. under `npx mgr test`), every surfacing path — `ready-to-show`, `windows.show()`, the create-dedup focus — goes **stealth** instead of `win.show()`: `showInactive()` (keyboard focus never leaves your editor) + `setOpacity(0)` + `setIgnoreMouseEvents(true)` (real OS clicks pass through; synthetic test input is unaffected), and no `win.focus()`/dock surfacing. The window is fully functional — rendering, timers, focus semantics, and `WebContentsView` visibility are identical to a visible window, which is why this is NOT `hide()`/`minimize()` (occlusion throttling would pause rAF and flip `document.visibilityState`, changing the runtime under test). Set **`EM_TEST_SHOW=1`** to watch a test run with real windows. Details: [test-framework.md](test-framework.md).

**The recipe is a shared util, and it covers RAW windows too.** `src/utils/stealth-window.js` (`applyStealth(win)`) is the single stealth-surfacing implementation — `_surface()` uses it for named windows, and `main.js` registers a global `browser-window-created` hook (step 1a-ii, Testing mode only) that applies it to **every** BrowserWindow, including ones created with `new BrowserWindow()` outside window-manager (a consumer's automation popup, a dialog, anything). For raw windows the util additionally reroutes `show()` → `showInactive()` and no-ops `focus()`, since nothing else mediates their surfacing. The stealth predicate (`src/utils/test-stealth.js`) is evaluated per window at creation, so `EM_TEST_SHOW=1` opts a run back into visible windows even when flipped mid-process. Covered by `suites/main/stealth-window.test.js`.

**App-level activation is suppressed separately (macOS).** Window flags can't stop macOS from activating a freshly *launched* app — the menu bar and keyboard focus switch to the test process at launch even when every window surfaces inactive. Under the same stealth predicate (`src/utils/test-stealth.js`, also used by `_isStealth()`), `main.js` flips the app to the accessory activation policy (`app.dock.hide()`) before app ready, so a test launch never activates and never steals focus. `EM_TEST_SHOW=1` opts out of both. Details: [test-framework.md](test-framework.md).

## Platform behavior

- `window-all-closed` → `app.quit()` on Windows/Linux only. macOS apps are sticky (stay running with no windows).
- All event listeners (`close` / `closed` / `resize` / `move` / `ready-to-show` / etc.) are attached **before** `await loadFile()` resolves, so the window is fully observable the moment it lands in the registry.
