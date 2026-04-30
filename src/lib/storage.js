// Storage — unified KV store for main + renderer.
//
// Main-side (sync, direct disk-backed via electron-store):
//   manager.storage.get(key, default)
//   manager.storage.set(key, value)
//   manager.storage.delete(key)
//   manager.storage.has(key)
//   manager.storage.clear()
//   manager.storage.onChange(key, fn)  // returns unsubscribe fn
//
// Renderer-side (async, proxied through preload contextBridge → IPC → main):
//   window.em.storage.get(key, default)   → Promise
//   window.em.storage.set(key, value)     → Promise
//   etc.
//
// Key paths support dot-notation (e.g. 'window.main.bounds') natively via electron-store.
//
// Storage file lives at:
//   macOS:   ~/Library/Application Support/<productName>/config.json
//   Windows: %APPDATA%/<productName>/config.json
//   Linux:   ~/.config/<productName>/config.json

const LoggerLite = require('./logger-lite.js');
const ipc = require('./ipc.js');

const logger = new LoggerLite('storage');

const storage = {
  _initialized: false,
  _manager:     null,
  _store:       null,
  _changeSubs:  {}, // key -> Set<fn>
  _ipcRegistered: false,

  async initialize(manager) {
    if (storage._initialized) {
      return;
    }

    storage._manager = manager;

    // Lazy-load electron-store via dynamic import. It's ESM-only so we can't `require()` it.
    // The /* webpackIgnore: true */ magic comment tells webpack to leave this import() alone —
    // the consumer's bundled main.js will then ask Node directly to resolve 'electron-store',
    // which finds it in EM's own node_modules at runtime.
    let ElectronStore;
    let electron;
    try {
      const mod = await import(/* webpackIgnore: true */ 'electron-store');
      ElectronStore = mod.default || mod;
      electron = require('electron');
    } catch (e) {
      logger.warn(`electron or electron-store not available — storage running as no-op. (${e.message})`);
      storage._initialized = true;
      return;
    }

    // Build the store. Filename is `config` by default (electron-store appends .json).
    // Production name is read from electron's app.name (set automatically from package.productName).
    const projectName = manager?.config?.app?.productName || electron.app?.getName?.() || 'electron-manager-app';

    storage._store = new ElectronStore({
      name: 'em-storage',
      // electron-store handles the cwd; no need to override unless we want a custom path.
    });

    logger.log(`initialize — file=${storage._store.path} (project=${projectName})`);

    // Register main-side IPC handlers so the renderer proxy works.
    storage._registerIpc();

    storage._initialized = true;
  },

  _registerIpc() {
    if (storage._ipcRegistered) {
      return;
    }

    if (!ipc._initialized) {
      // ipc is initialized before storage in the boot sequence; if we're here, ipc is unavailable
      // (e.g. running outside electron). Skip silently — main-side API still works.
      return;
    }

    ipc.handle('em:storage:get',    ({ key, def }) => storage.get(key, def));
    ipc.handle('em:storage:set',    ({ key, val }) => { storage.set(key, val); return true; });
    ipc.handle('em:storage:delete', ({ key })      => { storage.delete(key); return true; });
    ipc.handle('em:storage:has',    ({ key })      => storage.has(key));
    ipc.handle('em:storage:clear',  ()             => { storage.clear(); return true; });

    storage._ipcRegistered = true;
  },

  // Main-side public API
  get(key, defaultValue) {
    if (!storage._store) {
      return defaultValue;
    }
    const value = storage._store.get(key);
    return value === undefined ? defaultValue : value;
  },

  set(key, value) {
    if (!storage._store) {
      return;
    }
    const previous = storage._store.get(key);
    storage._store.set(key, value);

    // Notify subscribers
    const subs = storage._changeSubs[key];
    if (subs) {
      subs.forEach((fn) => {
        try {
          fn(value, previous);
        } catch (e) {
          logger.error('onChange subscriber threw:', e);
        }
      });
    }

    // Broadcast change to all renderers so renderer caches can invalidate.
    storage._broadcast(key, value, previous);
  },

  delete(key) {
    if (!storage._store) {
      return;
    }
    const previous = storage._store.get(key);
    storage._store.delete(key);

    const subs = storage._changeSubs[key];
    if (subs) {
      subs.forEach((fn) => {
        try {
          fn(undefined, previous);
        } catch (e) {
          logger.error('onChange subscriber threw:', e);
        }
      });
    }

    storage._broadcast(key, undefined, previous);
  },

  has(key) {
    if (!storage._store) {
      return false;
    }
    return storage._store.has(key);
  },

  clear() {
    if (!storage._store) {
      return;
    }
    storage._store.clear();
    storage._broadcast('*', undefined, undefined);
  },

  // Subscribe to changes for a specific key. Returns an unsubscribe function.
  onChange(key, fn) {
    if (!storage._changeSubs[key]) {
      storage._changeSubs[key] = new Set();
    }
    storage._changeSubs[key].add(fn);

    return () => {
      const set = storage._changeSubs[key];
      if (set) {
        set.delete(fn);
        if (set.size === 0) {
          delete storage._changeSubs[key];
        }
      }
    };
  },

  _broadcast(key, value, previous) {
    if (!ipc._initialized) return;
    ipc.broadcast('em:storage:change', { key, value, previous });
  },

  // Expose the on-disk path (handy for debugging)
  getPath() {
    return storage._store?.path || null;
  },
};

module.exports = storage;
