# Tray

File-based tray/menubar. EM looks for `src/tray/index.js`; if it exists, the exported function is called during boot with a builder API.

## Config

```jsonc
"tray": {
  "enabled":    true,
  "definition": "src/tray/index.js"   // override path if you want
}
```

## Definition file

```js
// src/tray/index.js
module.exports = ({ manager, tray }) => {
  tray.icon('src/assets/icons/tray-Template.png');
  tray.tooltip(manager.config?.app?.productName);

  tray.item({ label: 'Open',  click: () => manager.windows.show('main') });
  tray.separator();

  tray.item({
    label:   () => manager.appState.isFirstLaunch() ? 'Welcome!' : 'Settings',
    enabled: () => !!manager.windows.get('main'),
    click:   () => manager.windows.show('settings'),
  });

  tray.separator();
  tray.item({ label: 'Quit', click: () => require('electron').app.quit() });
};
```

## Builder API

```js
tray.icon(path)                // sets the tray icon (relative paths resolved from cwd)
tray.tooltip(text)
tray.item(descriptor)          // see "Item descriptors" below
tray.separator()
tray.submenu(label, items)
tray.clear()                   // start over
```

## Item descriptors

Mirror Electron's [`MenuItemConstructorOptions`](https://www.electronjs.org/docs/latest/api/menu#menubuildfromtemplatetemplate), with these additions:

| Field | Type | Notes |
|---|---|---|
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
manager.tray.setIcon(path)
manager.tray.setTooltip(text)
manager.tray.addItem(descriptor)         // append (preserves existing items)
manager.tray.clearItems()
manager.tray.destroy()                   // tear down (mostly for tests)

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

### Replace the entire tray on platform change

```js
manager.tray.define(({ manager, tray }) => {
  tray.icon('icons/dark-mode.png');
  tray.item({ label: 'New layout', click: ... });
});
```

## Default scaffold

`npx mgr setup` ships `src/tray/index.js` with a minimal Open + Quit example. Edit it; it's yours.
