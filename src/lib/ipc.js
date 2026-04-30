// IPC — typed channel bus for main ↔ renderer communication.
//
// Main-side API:
//   ipc.handle(channel, async (payload, evt) => result)   // request/response (renderer → main)
//   ipc.unhandle(channel)
//   ipc.on(channel, (payload, evt) => void)               // one-way subscribe (renderer → main)
//   ipc.off(channel, fn)
//   ipc.invoke(channel, payload)                          // main-side: call a registered handler locally
//   ipc.broadcast(channel, payload)                       // main → all renderers
//   ipc.send(webContents, channel, payload)               // main → one renderer
//
// Renderer-side (via preload contextBridge as `window.em.ipc`):
//   window.em.ipc.invoke(channel, payload)                // → Promise<result>
//   window.em.ipc.on(channel, fn)                         // returns unsubscribe fn
//   window.em.ipc.send(channel, payload)                  // fire-and-forget renderer → main
//
// All EM-internal channels are prefixed `em:` (e.g. `em:storage:get`).
// Consumers can register their own channels under any namespace they want.

const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('ipc');

const ipc = {
  _initialized: false,
  _manager:     null,
  _handlers:    {}, // channel -> handler fn
  _listeners:   {}, // channel -> Set<fn>
  _ipcMain:     null,
  _electron:    null,

  initialize(manager) {
    if (ipc._initialized) {
      return;
    }

    ipc._manager = manager;

    try {
      ipc._electron = require('electron');
      ipc._ipcMain = ipc._electron.ipcMain;
    } catch (e) {
      logger.warn(`electron not available — ipc running in test/no-op mode. (${e.message})`);
      ipc._initialized = true;
      return;
    }

    if (!ipc._ipcMain) {
      logger.warn('ipcMain not available — ipc running in no-op mode.');
      ipc._initialized = true;
      return;
    }

    logger.log('initialize');
    ipc._initialized = true;
  },

  // Register a request/response handler. Throws on duplicate registration.
  handle(channel, handler) {
    if (typeof channel !== 'string' || !channel) {
      throw new Error('ipc.handle: channel must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new Error('ipc.handle: handler must be a function');
    }
    if (ipc._handlers[channel]) {
      throw new Error(`ipc.handle: channel "${channel}" already has a handler. Call ipc.unhandle() first.`);
    }

    ipc._handlers[channel] = handler;

    if (ipc._ipcMain) {
      ipc._ipcMain.handle(channel, async (evt, payload) => {
        try {
          return await handler(payload, evt);
        } catch (e) {
          logger.error(`handler for "${channel}" threw:`, e);
          throw e; // propagate to renderer's invoke() promise
        }
      });
    }
  },

  unhandle(channel) {
    delete ipc._handlers[channel];
    if (ipc._ipcMain) {
      ipc._ipcMain.removeHandler(channel);
    }
  },

  // Main-side direct invoke — calls the locally registered handler without going through electron's IPC.
  // Used by other libs and by tests; the renderer goes through ipcRenderer.invoke.
  async invoke(channel, payload) {
    const handler = ipc._handlers[channel];
    if (!handler) {
      throw new Error(`ipc.invoke: no handler registered for "${channel}"`);
    }
    return handler(payload, null);
  },

  // Subscribe to one-way messages from renderers (renderer → main, no response).
  on(channel, fn) {
    if (!ipc._listeners[channel]) {
      ipc._listeners[channel] = new Set();
      if (ipc._ipcMain) {
        ipc._ipcMain.on(channel, (evt, payload) => {
          const set = ipc._listeners[channel];
          if (!set) return;
          set.forEach((sub) => {
            try {
              sub(payload, evt);
            } catch (e) {
              logger.error(`listener for "${channel}" threw:`, e);
            }
          });
        });
      }
    }
    ipc._listeners[channel].add(fn);

    return () => ipc.off(channel, fn);
  },

  off(channel, fn) {
    const set = ipc._listeners[channel];
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) {
      delete ipc._listeners[channel];
      if (ipc._ipcMain) {
        ipc._ipcMain.removeAllListeners(channel);
      }
    }
  },

  // Broadcast to every BrowserWindow's webContents.
  broadcast(channel, payload) {
    if (!ipc._electron) return;
    const { BrowserWindow } = ipc._electron;
    if (!BrowserWindow) return;

    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(channel, payload);
      } catch (e) {
        // window closing — ignore
      }
    });
  },

  // Send to a specific renderer's webContents.
  send(webContents, channel, payload) {
    if (!webContents || webContents.isDestroyed?.()) return;
    try {
      webContents.send(channel, payload);
    } catch (e) {
      logger.error(`send to "${channel}" failed:`, e);
    }
  },

  // Test/inspection helpers
  hasHandler(channel) {
    return Boolean(ipc._handlers[channel]);
  },

  listenerCount(channel) {
    return ipc._listeners[channel]?.size || 0;
  },
};

module.exports = ipc;
