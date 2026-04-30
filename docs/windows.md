# Windows

Named-window registry over `BrowserWindow`. Use it for the common case (named, persistent, integrated windows). For one-off windows (a toast, a print preview), use `new BrowserWindow()` directly — `window-manager` doesn't get in the way.

## API

```js
await manager.windows.createNamed('main')   // create-or-focus, returns BrowserWindow
manager.windows.get('main')                 // BrowserWindow | null
manager.windows.show('main')                // show + focus
manager.windows.hide('main')
manager.windows.close('main')               // forces close even if hideOnClose=true
manager.windows.list()                      // string[] of currently-open names
```

`createNamed` is single-instance: a second call returns the same window and focuses it.

## Config

```jsonc
"windows": {
  "main":     { "view": "main",     "width": 1024, "height": 720, "show": true,  "hideOnClose": false },
  "settings": { "view": "settings", "width": 600,  "height": 480, "show": false, "hideOnClose": true  },
  "about":    { "view": "about",    "width": 480,  "height": 360, "show": false, "hideOnClose": true  }
}
```

Per-window keys:

| Key | Default | Description |
|---|---|---|
| `view` | `<name>` | Folder under `src/views/` (so `view: "main"` loads `dist/views/main/index.html`) |
| `width` / `height` | 1024 / 720 | Initial size |
| `minWidth` / `minHeight` | 400 / 300 | |
| `show` | `true` | Auto-show on `ready-to-show`. Overridden by `startup.mode` (see [startup.md](startup.md)) |
| `hideOnClose` | `false` | Close button hides instead of destroys; `manager.windows.close()` still really closes |
| `title` | `app.productName` | |
| `backgroundColor` | `#ffffff` | |
| `persistBounds` | `true` | Remember position+size across launches (see below) |
| `skipTaskbar` | follows `startup.mode` | Force-skip the taskbar/dock for this window |

## Bounds persistence

Every named window's position and size persist to storage on resize / move / maximize / unmaximize / fullscreen-enter / fullscreen-leave / close. Restored on next `createNamed`.

- Storage key: `windows.<name>.bounds`
- Saves debounced 250ms; close flushes synchronously.
- Off-screen detection: if a saved position has less than 100×50px overlap with any current display's `workArea`, position is dropped (size kept). Handles "monitor unplugged" gracefully.
- Maximized / fullscreen state is stored separately and restored via `win.maximize()` / `win.setFullScreen(true)`.
- Sanity floor: saved entries with `width < 100` or `height < 100` are ignored.
- Opt out per-window: `persistBounds: false`.

## Auto-show behavior

A window auto-shows on `ready-to-show` if **all** of:
- `config.show !== false`
- `manager.startup.isLaunchHidden() === false` (i.e. `startup.mode === 'normal'`)

In `hidden` or `tray-only` mode, no window auto-shows. The consumer surfaces UI explicitly with `manager.windows.show('main')` from a tray click, deep-link route, or IPC event.

## Hide-on-close

```jsonc
"settings": { "hideOnClose": true }
```

Closing the window hides it instead of destroying it. Subsequent `manager.windows.show('settings')` reuses the existing window. To actually close, call `manager.windows.close('settings')` — that sets a flag and lets the close go through.

## Auto-attach context-menu

Every window's webContents is automatically wired up with the consumer's `src/context-menu/index.js` (see [context-menu.md](context-menu.md)). Idempotent per webContents (uses a WeakSet).

## Platform behavior

- `window-all-closed` → `app.quit()` on Windows/Linux only. macOS apps are sticky (stay running with no windows).
