# IPC

Typed channel bus for main ↔ renderer communication. All EM features register their channels through this single layer rather than calling `ipcMain.handle` directly, so you have one place to look and one place to instrument.

## Main-process API

```js
manager.ipc.handle(channel, async (payload, evt) => result)   // request/response
manager.ipc.unhandle(channel)
manager.ipc.invoke(channel, payload)                          // call locally (also what renderer triggers)
manager.ipc.on(channel, (payload, evt) => void)               // one-way subscribe (renderer → main)
manager.ipc.off(channel, fn)
manager.ipc.broadcast(channel, payload)                       // → all BrowserWindows
manager.ipc.send(webContents, channel, payload)               // → one renderer
manager.ipc.hasHandler(channel)
manager.ipc.listenerCount(channel)
```

## Renderer-process API (via preload contextBridge)

```js
await window.em.ipc.invoke(channel, payload)   // → Promise<result>
const off = window.em.ipc.on(channel, (payload) => { ... });
window.em.ipc.send(channel, payload);          // fire-and-forget
```

## Channel naming

EM-internal channels are prefixed `em:` (e.g. `em:storage:get`, `em:storage:change`). Consumers are free to use any namespace.

## Validation

- `handle()` throws if `channel` is empty/non-string or `handler` is non-function.
- `handle()` throws on duplicate registration. Call `unhandle()` first if you need to swap.
- `invoke()` rejects with a clear message if no handler is registered for the channel.
- Handler errors propagate through `invoke()` (both main-local and renderer-side) — your renderer's `await window.em.ipc.invoke(...)` will reject with the original error message.

## Boot order

`ipc` initializes **before** `storage` so that storage (and every other feature) can register handlers via `ipc.handle`. This is the canonical pattern: don't touch `ipcMain` directly.

## Example

```js
// main
manager.ipc.handle('user:get-token', async (payload) => {
  const token = await fetchToken(payload.userId);
  return { token };
});

// renderer
const { token } = await window.em.ipc.invoke('user:get-token', { userId: 'abc' });
```
