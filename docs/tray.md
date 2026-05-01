# Tray

File-based tray/menubar. EM looks for `src/integrations/tray/index.js`; if it exists, the exported function is called during boot with a builder API + id-path API. If absent, EM ships a default tray template (see ids below).

## Config

No config block. Path is conventional: `src/integrations/tray/index.js`. To opt out, call `manager.tray.disable()` from your main entry — idempotent, tears down any existing Tray.

## Definition file

```js
// src/integrations/tray/index.js
module.exports = ({ manager, tray }) => {
  tray.icon('src/assets/icons/tray-Template.png');
  tray.tooltip(manager.config?.app?.productName);

  // Easiest: start from EM's default template.
  tray.useDefaults();

  // Then customize by id (flat — no `tray/` prefix needed):
  tray.insertAfter('open', {
    id: 'dashboard',
    label: 'Open Dashboard',
    click: () => manager.windows.show('dashboard'),
  });
  tray.update('open', { label: 'Show Window' });
  tray.remove('website');
  tray.hide('check-for-updates');
};
```

## Builder API (during definition)

```js
tray.icon(path)                // sets the tray icon (relative paths resolved from cwd)
tray.tooltip(text)
tray.item(descriptor)          // see "Item descriptors" below
tray.separator()
tray.submenu(label, items)
tray.useDefaults()             // populate with EM's default template (id-tagged)
tray.clear()                   // start over
```

## Id-path API

Same shape across menu / tray / context-menu. Available **during definition** (on the `tray` builder arg) AND **at runtime** on `manager.tray`:

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

Tray ids are **flat** — no `tray/` prefix (the lib namespace is implicit). For nested submenus you can address children by `parent/child` paths (the resolver walks `submenu` arrays).

## Default template ids

| ID | Item |
|---|---|
| `title` | Disabled label showing the app name |
| `open` | "Open `<app>`" — calls `manager.windows.show('main')` |
| `check-for-updates` | Wired to `manager.autoUpdater` (label updates dynamically) |
| `website` | Visit `brand.url` (only present if configured) |
| `quit` | Quit the app |

## Submenus

Submenus work the same as Electron's. The id-path resolver walks `submenu` arrays so children are addressable as `parent/child`:

```js
tray.item({ id: 'account', label: 'Account', submenu: [
  { id: 'sign-in',  label: 'Sign in',  click: () => {} },
  { id: 'sign-out', label: 'Sign out', click: () => {} },
]});

manager.tray.find('account/sign-out');
manager.tray.update('account/sign-out', { enabled: false });
manager.tray.appendTo('account', { id: 'profile', label: 'Profile' });
```

## Item descriptors

Mirror Electron's [`MenuItemConstructorOptions`](https://www.electronjs.org/docs/latest/api/menu#menubuildfromtemplatetemplate), with these additions:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Used for id-path lookups (`open`, `quit`, `account/sign-out`, …) |
| `label` | string \| `() => string` | Function form re-evaluated on every `refresh()` |
| `enabled` | boolean \| `() => boolean` | Same |
| `visible` | boolean \| `() => boolean` | Same |
| `checked` | boolean \| `() => boolean` | Same |
| `click` | function | Wrapped to swallow errors so a bad handler can't kill the menu |
| `submenu` | array | Recursively resolved with the same conveniences |

## Runtime API on `manager.tray`

```js
manager.tray.refresh()                   // re-evaluate dynamic state and re-render
manager.tray.define(fn)                  // replace the whole definition at runtime
manager.tray.disable()                   // tear down + stop responding (idempotent)
manager.tray.setIcon(path)
manager.tray.setTooltip(text)
manager.tray.addItem(descriptor)         // append (preserves existing items)
manager.tray.clearItems()
manager.tray.destroy()                   // tear down (mostly for tests)

// Id-path API — same as listed above.
manager.tray.find('quit')
manager.tray.update('quit', { label: 'Goodbye' })
manager.tray.remove('website')
manager.tray.insertAfter('open', { id: 'preferences', label: 'Preferences...', click: ... })
manager.tray.hide('check-for-updates')

// Inspection
manager.tray.getItems()                  // shallow copy of raw descriptors
manager.tray.getIcon()
manager.tray.getTooltip()
manager.tray.isRendered()
```

## Common patterns

### Update label after auth state changes

```js
// in your renderer/main code, after sign-in:
manager.storage.set('user', { ... });
manager.tray.refresh();    // dynamic-label functions re-evaluate
```

### Hide updater item if you ship without auto-update

```js
// src/integrations/tray/index.js
module.exports = ({ tray }) => {
  tray.icon('...');
  tray.useDefaults();
  tray.remove('check-for-updates');
};
```

### Replace the entire tray at runtime

```js
manager.tray.define(({ manager, tray }) => {
  tray.icon('icons/dark-mode.png');
  tray.item({ id: 'x', label: 'New layout', click: ... });
});
```

## Default scaffold

`npx mgr setup` ships `src/integrations/tray/index.js` calling `tray.useDefaults()` so you start with the same items the framework would supply on its own — plus commented-out examples covering insertAfter, update, remove, hide, enable, and submenus.
