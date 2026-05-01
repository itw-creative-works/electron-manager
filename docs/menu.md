# Application Menu

File-based application menu (the macOS menu bar / Windows + Linux menu). Same builder + id-path API as [tray](tray.md) and [context-menu](context-menu.md).

## Config

No config block. Path is conventional: `src/integrations/menu/index.js`. To opt out, call `manager.menu.disable()` from your main entry.

## Definition file

```js
// src/integrations/menu/index.js
module.exports = ({ manager, menu, defaults }) => {
  // Easiest: start from the platform-aware default template.
  menu.useDefaults();

  // Mutate by id-path:
  menu.show('main/preferences');                // EM ships this hidden by default
  menu.update('main/check-for-updates', { label: 'Get Latest Version' });
  menu.insertAfter('main/check-for-updates', {
    id: 'main/account', label: 'Account...', click: () => manager.windows.show('account'),
  });
  menu.remove('view/reload');
  menu.hide('main/services');

  // Or add a whole new top-level menu:
  menu.menu('Tools', [{ id: 'tools/sync', label: 'Sync Now', click: () => {} }]);
};
```

## Builder API (during definition)

```js
menu.menu(label, items)        // add a top-level menu bar entry
menu.useDefaults()             // populate with the platform-appropriate default template
menu.append(item)              // append a top-level descriptor (rare; prefer menu())
menu.clear()                   // start over
```

## Id-path API

Same shape across menu / tray / context-menu. Available **during definition** (on the `menu` builder arg) AND **at runtime** on `manager.menu`:

```js
.find(idPath)                  // live descriptor or null
.has(idPath)                   // bool
.update(idPath, patch)         // Object.assign + re-render. returns true if found.
.remove(idPath)                // splice + re-render. returns true if removed.
.enable(idPath, bool = true)   // sugar over update({enabled})
.show(idPath, bool = true)     // sugar over update({visible})
.hide(idPath)                  // visible:false
.insertBefore(idPath, item)    // splice in a sibling
.insertAfter(idPath, item)     // splice in a sibling
.appendTo(idPath, item)        // push into a submenu (creates submenu if absent)
```

Menu ids are **paths** because menus actually nest (`main/check-for-updates`, `view/developer/toggle-devtools`). EM matches by full id field first; if that misses it walks the path treating each segment as the last component of an id.

## Default template ids

Every item in EM's default template carries a stable id you can target.

### macOS App menu (the one labeled with your app name)

| ID | Item | Notes |
|---|---|---|
| `main/about` | About | |
| `main/check-for-updates` | Check for Updates… | Auto-updater wired |
| `main/preferences` | Preferences… | `visible:false` by default — use `menu.show('main/preferences')` |
| `main/services` | Services submenu | |
| `main/hide` | Hide | |
| `main/hide-others` | Hide Others | |
| `main/show-all` | Show All | |
| `main/relaunch` | Relaunch | Restarts the app |
| `main/quit` | Quit | |

### File menu (win/linux equivalents of the App menu)

| ID | Item | Notes |
|---|---|---|
| `file/close` | Close (mac only) | |
| `file/preferences` | Preferences… (win/linux) | `visible:false` by default |
| `file/relaunch` | Relaunch (win/linux) | |
| `file/quit` | Exit | |

### Cross-platform

| ID | Item |
|---|---|
| `edit/undo`, `edit/redo`, `edit/cut`, `edit/copy`, `edit/paste`, `edit/select-all`, `edit/delete` | Edit submenu |
| `edit/paste-and-match-style` | mac only |
| `view/reload`, `view/reset-zoom`, `view/zoom-in`, `view/zoom-out`, `view/toggle-fullscreen` | View submenu |
| `view/developer` | Submenu (dev mode only) |
| `view/developer/toggle-devtools` | Toggle Developer Tools |
| `view/developer/inspect-elements` | Inspect Element |
| `view/developer/force-reload` | Force Reload |
| `window/minimize`, `window/zoom`, `window/front` | Window submenu (mac) |
| `window/minimize`, `window/close` | Window submenu (win/linux) |

### Help menu

| ID | Item | Notes |
|---|---|---|
| `help/check-for-updates` | Check for Updates… (win/linux only) | Auto-updater wired |
| `help/website` | "`<brandName>` Home" | Only when `brand.url` configured |

### Development menu (dev mode only)

Top-level, only visible when `manager.isDevelopment()`. Mirrors legacy electron-manager's developer utilities.

| ID | Item | Action |
|---|---|---|
| `development/open-exe-folder` | Open exe folder | Reveals `app.getPath('exe')` |
| `development/open-user-data` | Open user data folder | Reveals `app.getPath('userData')` |
| `development/open-logs` | Open logs folder | Reveals `app.getPath('logs')` |
| `development/open-app-config` | Open app config folder | Reveals `app.getPath('appData')` |
| `development/test-error` | Throw test error | Throws an uncaught error (verifies sentry / error handling) |

## Built-in framework items

`main/check-for-updates` (mac) and `help/check-for-updates` (win/linux) are **wired to `manager.autoUpdater`**:
- Label updates dynamically: *Checking…*, *Downloading 42%*, *Restart to Update v1.2.3*, *You're up to date*.
- Click triggers `autoUpdater.checkNow()` or `autoUpdater.installNow()` depending on state.

The same hook also patches the tray's `check-for-updates` item if present, so both UIs stay in lockstep.

Patch or remove either as needed — the auto-updater hook is a no-op when the item is missing.

## Item descriptors

Same dynamic conveniences as tray:
- `label` / `enabled` / `visible` / `checked` may be functions, evaluated on every `refresh()`
- `click` wrapped to catch errors
- `submenu` recursively resolved

## Runtime API on `manager.menu`

```js
manager.menu.refresh()                         // re-evaluate dynamic state
manager.menu.define(fn)                        // replace the whole definition at runtime
manager.menu.destroy()                         // tear down (mostly for tests)
manager.menu.disable()                         // turn the menu off entirely (idempotent)

// Id-path API — same as listed above.
manager.menu.find('main/check-for-updates')
manager.menu.update('main/check-for-updates', { label: 'Updates...' })
manager.menu.remove('view/reload')
manager.menu.insertAfter('main/check-for-updates', { id: 'main/account', label: 'Account...' })

// Inspection
manager.menu.getItems()                        // top-level descriptors (shallow copy)
manager.menu.isRendered()                      // bool
manager.menu.getMenu()                         // the underlying Electron Menu instance
```

## Default scaffold

`npx mgr setup` ships `src/integrations/menu/index.js` calling `menu.useDefaults()` plus commented-out examples (show preferences, insertAfter, update, remove, hide, add a Tools menu, appendTo).
