// Preload Manager singleton.
// Consumer entry: `new (require('electron-manager/preload'))().initialize()`.
// Wires contextBridge so renderer code can call `window.em.ipc.invoke(...)` without nodeIntegration.

const LoggerLite = require('./lib/logger-lite.js');

function Manager() {
  const self = this;

  self.logger = new LoggerLite('preload');

  return self;
}

Manager.prototype.initialize = function () {
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
    logger: {
      log:   (...a) => console.log('[em]',   ...a),
      warn:  (...a) => console.warn('[em]',  ...a),
      error: (...a) => console.error('[em]', ...a),
    },
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

module.exports = Manager;
