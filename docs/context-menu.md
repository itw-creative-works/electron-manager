# Context Menu (Right-Click)

File-based context menu. Unlike tray and application menu (called once at boot), the context-menu definition is called **every time the user right-clicks** — so it gets fresh `params` each time and can vary the menu by selection.

## Config

```jsonc
"contextMenu": {
  "enabled":    true,
  "definition": "src/context-menu/index.js"
}
```

## Definition file

```js
// src/context-menu/index.js
module.exports = ({ manager, menu, params, webContents }) => {
  // Editable fields → full edit menu.
  if (params.isEditable) {
    menu.item({ role: 'cut',   enabled: params.editFlags?.canCut !== false });
    menu.item({ role: 'copy',  enabled: params.editFlags?.canCopy !== false });
    menu.item({ role: 'paste', enabled: params.editFlags?.canPaste !== false });
  } else if (params.selectionText) {
    menu.item({ role: 'copy' });
    menu.item({
      label: `Search "${params.selectionText.slice(0, 20)}"`,
      click: () => require('electron').shell.openExternal(
        `https://google.com/search?q=${encodeURIComponent(params.selectionText)}`,
      ),
    });
  }

  // Links — open in browser, copy address.
  if (params.linkURL) {
    menu.separator();
    menu.item({
      label: 'Open Link in Browser',
      click: () => require('electron').shell.openExternal(params.linkURL),
    });
  }

  // Dev-only: Inspect.
  if (manager.isDevelopment()) {
    menu.separator();
    menu.item({ role: 'inspectElement' });
    menu.item({ role: 'toggleDevTools' });
  }
};
```

Returning no items (calling no `menu.*` methods) **suppresses the popup** entirely.

## Builder API

```js
menu.item(descriptor)
menu.separator()
menu.submenu(label, items)
```

## Definition fn arguments

| Arg | Description |
|---|---|
| `manager` | The running EM Manager |
| `menu` | Builder API for this popup |
| `params` | Electron's [`ContextMenuParams`](https://www.electronjs.org/docs/latest/api/web-contents#event-context-menu) — `selectionText`, `isEditable`, `linkURL`, `srcURL`, `mediaType`, `editFlags`, `x`, `y`, etc. |
| `webContents` | The `webContents` that fired the event |

## Auto-attach

Every window created via `manager.windows.createNamed()` is automatically wired up with the context-menu listener. Idempotent per `webContents` (uses a `WeakSet`). For windows you create directly with `new BrowserWindow()`, call:

```js
manager.contextMenu.attach(win.webContents);
```

## Runtime API on `manager.contextMenu`

```js
manager.contextMenu.define(fn)              // replace the definition at runtime
manager.contextMenu.attach(webContents)     // manual attach
manager.contextMenu.buildItems(params, wc)  // run the definition without popping a menu (useful for tests)
manager.contextMenu.hasCustomDefinition()   // false → using the built-in default fn
```

## Default fn

Without a consumer file, EM uses a built-in fallback that handles the most common cases: cut/copy/paste in editable fields, copy in text selection, Open/Copy on links, and a dev-only Inspect Element. Same behavior as the default `src/context-menu/index.js` scaffold — provided there for easy editing.

## Default scaffold

`npx mgr setup` ships `src/context-menu/index.js` mirroring the built-in default fn so consumers have something to read and modify.
