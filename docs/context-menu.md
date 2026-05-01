# Context Menu (Right-Click)

File-based context menu. Unlike tray and application menu (called once at boot), the context-menu definition is called **every time the user right-clicks** — so it gets fresh `params` each time and can vary the menu by selection.

## Config

No config block. Path is conventional: `src/integrations/context-menu/index.js`. To opt out, call `manager.contextMenu.disable()` from your main entry — after that, right-click events are silently swallowed.

## Definition file

```js
// src/integrations/context-menu/index.js
module.exports = ({ manager, menu, params, webContents }) => {
  // Easiest: start from EM's defaults, then customize per event.
  menu.useDefaults();

  // Add a "Search Google" entry when text is selected:
  if (params.selectionText) {
    menu.insertAfter('copy', {
      id: 'search-google',
      label: `Search "${params.selectionText.slice(0, 20)}"`,
      click: () => require('electron').shell.openExternal(
        `https://google.com/search?q=${encodeURIComponent(params.selectionText)}`,
      ),
    });
  }

  // Hide the dev-tools entries even in development:
  menu.remove('toggle-devtools');
};
```

Calling no `menu.*` methods (or `menu.clear()` after `useDefaults()` with nothing added) **suppresses the popup** entirely.

## Builder API (per event)

```js
menu.item(descriptor)
menu.separator()
menu.submenu(label, items)
menu.useDefaults()             // populate with EM's defaults based on params
menu.clear()                   // wipe items added so far this event
```

## Id-path API (per event)

Same shape across menu / tray / context-menu. Available **inside the definition fn** on the `menu` builder. Operates on the items being built for the current right-click event:

```js
.find(idPath)
.has(idPath)
.update(idPath, patch)
.remove(idPath)
.enable(idPath, bool = true)
.show(idPath, bool = true)
.hide(idPath)
.insertBefore(idPath, item)
.insertAfter(idPath, item)
.appendTo(idPath, item)
```

Context-menu ids are **flat** — no `context/` prefix needed (the lib namespace is implicit). Submenus you build with `menu.submenu(...)` are addressable as `parent/child` paths via the resolver.

(Runtime-on-`manager.contextMenu` mutators don't apply here — items are rebuilt every event. Mutate inside the definition fn instead.)

## Default template ids

EM's `useDefaults()` populates items based on `params`. Every default item carries an id you can target:

| ID | When it appears |
|---|---|
| `undo`, `redo` | `params.editFlags.canUndo` / `canRedo` |
| `cut`, `copy`, `paste`, `paste-and-match-style`, `select-all` | `params.isEditable` |
| `copy` | `params.selectionText` (read-only) |
| `open-link`, `copy-link` | `params.linkURL` |
| `reload` | always |
| `inspect`, `toggle-devtools` | `manager.isDevelopment()` only |

## Definition fn arguments

| Arg | Description |
|---|---|
| `manager` | The running EM Manager |
| `menu` | Per-event builder + id-path API |
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
manager.contextMenu.disable()               // ignore future right-click events (idempotent)
manager.contextMenu.attach(webContents)     // manual attach
manager.contextMenu.buildItems(params, wc)  // run the definition without popping a menu (useful for tests)
manager.contextMenu.hasCustomDefinition()   // false → using the built-in default fn
```

## Default fn

Without a consumer file, EM uses a built-in fallback that just calls `useDefaults()` — sensible undo/redo/cut/copy/paste/link/reload/inspect baseline. Same behavior as the default scaffold.

## Default scaffold

`npx mgr setup` ships `src/integrations/context-menu/index.js` calling `menu.useDefaults()` plus commented-out examples covering insertAfter, remove, hide, enable, and building from scratch.
