// Preload Manager singleton.
// Consumer entry: `new (require('electron-manager/preload'))().initialize()`.
// Wires contextBridge so renderer code can call `window.em.ipc.invoke(...)` without nodeIntegration.

const LoggerLite = require('./lib/logger-lite.js');

function Manager() {
  const self = this;

  self.logger = new LoggerLite('preload');

  return self;
}

// Async even though there's nothing to await — keeps the API uniform with main + renderer
// so consumers can do `manager.initialize().then(...)` regardless of which entry they're in.
Manager.prototype.initialize = async function () {
  const self = this;

  let electron;
  try {
    electron = require('electron');
  } catch (e) {
    self.logger.warn('electron not available — preload Manager running in test mode.');
    return self;
  }

  const { contextBridge, ipcRenderer } = electron;

  if (!contextBridge || !ipcRenderer) {
    self.logger.warn('contextBridge / ipcRenderer not available.');
    return self;
  }

  // Expose a stable, namespaced surface to the renderer.
  // Real impl in pass 2 will type the channel list and proxy storage through here.
  contextBridge.exposeInMainWorld('em', {
    ipc: {
      invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
      on:     (channel, handler) => ipcRenderer.on(channel, (_, payload) => handler(payload)),
      send:   (channel, payload) => ipcRenderer.send(channel, payload),
    },
    storage: {
      get:    (key, def) => ipcRenderer.invoke('em:storage:get',    { key, def }),
      set:    (key, val) => ipcRenderer.invoke('em:storage:set',    { key, val }),
      delete: (key)      => ipcRenderer.invoke('em:storage:delete', { key }),
      has:    (key)      => ipcRenderer.invoke('em:storage:has',    { key }),
      clear:  ()         => ipcRenderer.invoke('em:storage:clear'),
      // Subscribe to changes broadcast from main. Returns an unsubscribe fn.
      // Pass '*' as key to receive all changes.
      onChange: (key, handler) => {
        const wrapped = (_, payload) => {
          if (key === '*' || payload?.key === key) {
            handler(payload);
          }
        };
        ipcRenderer.on('em:storage:change', wrapped);
        return () => ipcRenderer.removeListener('em:storage:change', wrapped);
      },
    },
    // Renderer logger — writes to console (visible in DevTools) AND forwards each
    // call to main where it's written through electron-log's file transport. Same
    // file (logs/runtime.log in dev, OS logs/<AppName>/runtime.log in prod) where
    // main + preload logs land too. Each entry is scoped 'renderer' so you can
    // grep for renderer-only output.
    logger: makeForwardingLogger('renderer', ipcRenderer),
    autoUpdater: {
      getStatus:  ()  => ipcRenderer.invoke('em:auto-updater:status'),
      checkNow:   ()  => ipcRenderer.invoke('em:auto-updater:check-now'),
      installNow: ()  => ipcRenderer.invoke('em:auto-updater:install-now'),
      // Subscribe to status broadcasts. Returns an unsubscribe fn.
      onStatus: (handler) => {
        const wrapped = (_, payload) => handler(payload);
        ipcRenderer.on('em:auto-updater:status', wrapped);
        return () => ipcRenderer.removeListener('em:auto-updater:status', wrapped);
      },
    },
  });

  self.logger.log('electron-manager (preload) initialized.');

  return self;
};

// Build a console+forward logger object suitable for exposing through contextBridge
// to the renderer. Each method:
//   1. Writes to the renderer's DevTools console (live debug visibility).
//   2. Sends an 'em:log:forward' IPC to main, which replays through electron-log's
//      file transport. Result: every renderer log call lands in runtime.log too.
//
// Args are JSON-serialized before sending (IPC requires structured-cloneable values).
// Errors and other non-cloneable values are flattened to objects with a __error flag.
function makeForwardingLogger(scope, ipcRenderer) {
  const FORWARD_CHANNEL = 'em:log:forward';
  // Mirror the same keyset as LoggerLite for parity (log/info/warn/error/debug).
  // Renderer code typically only uses log/warn/error so the others are forward-compat.
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const out = {};
  for (const m of methods) {
    const fileLevel = m === 'log' ? 'info' : m;
    out[m] = function () {
      // Console first.
      const args = ['[em]', ...Array.from(arguments)];
      const fn = console[m] || console.log;
      try { fn.apply(console, args); } catch (e) { /* ignore */ }
      // Forward to main.
      try {
        ipcRenderer.send(FORWARD_CHANNEL, {
          name: scope,
          level: fileLevel,
          args: serializeForIpc(arguments),
        });
      } catch (e) {
        // Quietly drop — renderer console call above is the fallback.
      }
    };
  }
  return out;
}

// Pre-serialize log args so IPC's structured clone doesn't choke on Errors / circulars.
function serializeForIpc(args) {
  return Array.from(args).map((a) => {
    if (a instanceof Error) return { __error: true, name: a.name, message: a.message, stack: a.stack };
    if (a === undefined)    return { __undefined: true };
    if (a === null)         return null;
    if (typeof a === 'function') return `[Function: ${a.name || 'anonymous'}]`;
    try {
      return JSON.parse(JSON.stringify(a));
    } catch (e) {
      return String(a);
    }
  });
}

module.exports = Manager;
