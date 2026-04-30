# Storage

Persistent KV store accessible from both main and renderer. Backed by [`electron-store`](https://github.com/sindresorhus/electron-store) under the hood.

## File location

```
macOS:   ~/Library/Application Support/<productName>/em-storage.json
Windows: %APPDATA%/<productName>/em-storage.json
Linux:   ~/.config/<productName>/em-storage.json
```

## Main-process API (sync, direct disk-backed)

```js
manager.storage.get(key, defaultValue)   // any
manager.storage.set(key, value)
manager.storage.delete(key)
manager.storage.has(key)                 // boolean
manager.storage.clear()
manager.storage.onChange(key, fn)        // returns unsubscribe fn
manager.storage.getPath()                // absolute path to em-storage.json
```

## Renderer-process API (async, proxied through preload + IPC)

```js
await window.em.storage.get(key, defaultValue)
await window.em.storage.set(key, value)
await window.em.storage.delete(key)
await window.em.storage.has(key)
await window.em.storage.clear()

const off = window.em.storage.onChange(key, ({ value, previous }) => { ... });
// pass '*' as key to receive all changes
off();
```

## Dot-notation paths

Keys support dot-notation for nested objects natively:

```js
manager.storage.set('window.main.bounds', { x: 10, y: 20, w: 800, h: 600 });
manager.storage.get('window.main.bounds.w');   // → 800
```

## Change broadcasts

Every `set` / `delete` / `clear` in main broadcasts an `em:storage:change` IPC event to all renderer windows. The renderer's `window.em.storage.onChange` filters by key locally.

In main, `manager.storage.onChange(key, fn)` registers a callback fired with `(value, previous)`.

## Implementation notes

- Storage initialization is async — `Manager.initialize()` `await`s it before any other lib boots, since features like `app-state` and `windows` rely on it.
- IPC handlers (`em:storage:get` etc.) are registered on the EM `ipc` bus, not directly on `ipcMain`. See [ipc.md](ipc.md).
- The store uses `name: 'em-storage'` (filename `em-storage.json`). Don't reuse this name in a separate `electron-store` instance.
- `electron-store@10` is ESM-only. EM bundles it (not a peer dep) and resolves it via `Manager.require()` + dynamic `import()`.
