// Renderer test-harness preload. Bridges between the harness BrowserWindow and the parent
// main-process harness via two channels:
//
//   __emTest:ready   — renderer signals it's ready to receive suites
//   __emTest:result  — renderer emits per-test results / suite-start / fatal
//   __emTest:suites  — main sends serialized renderer suites for execution
//
// Also exposes the production-style `window.em` surface (mirrors src/preload.js so renderer
// test suites can assert on it).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__emTest', {
  // Signal main that the harness page is loaded and ready to accept suites.
  ready: () => ipcRenderer.send('__emTest:ready'),
  // Forward a result event up to main, which prints it.
  emit:  (evt) => ipcRenderer.send('__emTest:result', evt),
  // Subscribe to incoming suite payloads.
  onSuites: (handler) => {
    ipcRenderer.on('__emTest:suites', (_e, suites) => handler(suites));
  },
});

// Mirror the production preload surface so renderer test suites can assert against it.
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
  },
});
