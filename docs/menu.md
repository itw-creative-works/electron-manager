# Application Menu

File-based application menu (the macOS menu bar / Windows + Linux menu). Same builder convention as [tray](tray.md).

## Config

```jsonc
"menu": {
  "enabled":    true,
  "definition": "src/menu/index.js"
}
```

## Definition file

```js
// src/menu/index.js
module.exports = ({ manager, menu, defaults }) => {
  // Easiest: start from the platform-aware default template.
  menu.useDefaults();

  // Add a Help menu pointing at the brand URL if one is configured.
  const url = manager.config?.brand?.url;
  if (url) {
    menu.menu('Help', [
      {
        label: `Visit ${manager.config?.brand?.name || 'website'}`,
        click: () => require('electron').shell.openExternal(url),
      },
    ]);
  }
};
```

## Builder API

```js
menu.menu(label, items)        // add a top-level menu bar entry
menu.useDefaults()             // populate with the platform-appropriate default template
menu.append(item)              // append a top-level descriptor (rare; prefer menu())
menu.clear()                   // start over
```

`defaults` (third arg to your fn) is the default template as an array — you can splice into it manually if `useDefaults()` isn't enough:

```js
module.exports = ({ menu, defaults }) => {
  // Splice a Tools menu before the Window menu.
  const idx = defaults.findIndex((m) => m.label === 'Window');
  defaults.splice(idx, 0, { label: 'Tools', submenu: [{ role: 'reload' }] });
  defaults.forEach((entry) => menu.append(entry));
};
```

## Default template

Platform-aware. On macOS: App menu (About / **Check for Updates...** / Hide / Quit) → File → Edit → View → Window. On win/linux: File → Edit → View → Window → **Help (Check for Updates...)**. Built from Electron's [standard roles](https://www.electronjs.org/docs/latest/api/menu-item#roles).

The "Check for Updates..." item has id `em:check-for-updates` — see "Built-in items + IDs" below.

## Built-in items + IDs

EM seeds the default template with a few items that the framework hooks into. Each is tagged with an `id` so consumers can find / patch / remove them:

| ID | Where | Purpose |
|---|---|---|
| `em:check-for-updates` | macOS app menu (after About) / win+linux Help menu | Wired to `manager.autoUpdater`. Label updates dynamically based on update status (Checking → Downloading → Restart to Update). Click triggers `checkNow()` or `installNow()` depending on state. |

Modify or remove these in your `src/menu/index.js`:

```js
module.exports = ({ manager, menu }) => {
  menu.useDefaults();
  // Move the updater item somewhere else, or change its label
  menu.updateItem('em:check-for-updates', { label: 'Get Latest Version' });
  // Or remove it entirely (consumer is responsible for triggering updates manually)
  // menu.removeItem('em:check-for-updates');
};
```

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

// By-ID lookup + mutation (works on items at any depth)
manager.menu.findItem(id)                      // returns the live descriptor or null
manager.menu.updateItem(id, patch)             // mutate fields (label/enabled/click/...) and re-render. returns true if found.
manager.menu.removeItem(id)                    // delete from tree. returns true if removed.

// Inspection
manager.menu.getItems()                        // top-level descriptors (shallow copy)
manager.menu.isRendered()                      // bool
manager.menu.getMenu()                         // the underlying Electron Menu instance
```

## Default scaffold

`npx mgr setup` ships `src/menu/index.js` calling `useDefaults()` and adding a Help menu pointing at `brand.url`.
