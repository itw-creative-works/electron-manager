// Theme — system-aware dynamic appearance (light / dark / follow-the-OS).
//
// Main-side API:
//   manager.theme.get()        → 'system' | 'light' | 'dark'   (the SOURCE — what's chosen)
//   manager.theme.resolved()   → 'light' | 'dark'              (what's actually showing)
//   manager.theme.set(source)  → apply + persist a new source
//   manager.theme.onChange(fn) → fn({ source, resolved }) on every effective change; returns unsubscribe
//
// Renderer-side (preload contextBridge):
//   window.em.theme.get()      → Promise<{ source, resolved }>
//   window.em.theme.set(s)     → Promise<{ source, resolved }>
//   window.em.theme.onChange(fn) — matchMedia-powered (see below); returns unsubscribe
//
// How it works: everything rides on Electron's `nativeTheme.themeSource`, which accepts
// exactly the same three values. Setting it (a) drives `shouldUseDarkColors`, (b) flips
// `prefers-color-scheme` in EVERY renderer of the app — BrowserWindows AND
// WebContentsViews — firing their matchMedia listeners, and (c) makes native UI (menus,
// dialogs) follow. Renderers therefore SELF-RESOLVE via matchMedia instead of depending
// on `ipc.broadcast` (which only reaches BrowserWindows — embedded WebContentsViews
// would never hear it). The `em:theme:changed` broadcast below is a main-side courtesy
// for windows that want the source+resolved pair pushed; it is not the sync mechanism.
//
// Source resolution at boot: storage override (the user's runtime choice) → config
// `theme.appearance` (the app's default) → 'system'. Invalid values fall through.
//
// The `<html data-bs-theme>` attribute is applied/maintained by the preload's theme
// applier on every EM-templated page (see src/preload.js) — pages that don't carry the
// attribute (e.g. external sites loaded in an embedding consumer's web views) are left
// untouched.

const LoggerLite = require('./logger-lite.js');
const ipc = require('./ipc.js');

const logger = new LoggerLite('theme');

const STORAGE_KEY = 'theme';
const SOURCES = ['system', 'light', 'dark'];

const theme = {
  _initialized: false,
  _manager: null,
  _nativeTheme: null,
  _listeners: new Set(),
  _lastEmitted: null,
  _onNativeUpdated: null,

  initialize(manager) {
    if (theme._initialized) {
      return;
    }

    theme._manager = manager;

    let nativeTheme;
    try {
      nativeTheme = require('electron').nativeTheme;
    } catch (e) {
      nativeTheme = null;
    }
    if (!nativeTheme) {
      logger.warn('nativeTheme not available — theme running as no-op.');
      theme._initialized = true;
      return;
    }
    theme._nativeTheme = nativeTheme;

    // Boot source: storage override → config default → 'system'.
    const stored = manager.storage.get(`${STORAGE_KEY}.appearance`);
    const configured = manager.config?.theme?.appearance;
    const source = SOURCES.includes(stored) ? stored
      : SOURCES.includes(configured) ? configured
      : 'system';

    nativeTheme.themeSource = source;
    logger.log(`initialize — source=${source} (stored=${stored ?? '—'} config=${configured ?? '—'}) resolved=${theme.resolved()}`);

    // OS preference changes (in 'system' mode) and themeSource flips both land here.
    theme._onNativeUpdated = () => theme._emitChange();
    nativeTheme.on('updated', theme._onNativeUpdated);

    theme._registerIpc();

    theme._lastEmitted = `${theme.get()}|${theme.resolved()}`;
    theme._initialized = true;
  },

  _registerIpc() {
    if (!ipc._initialized) {
      return;
    }

    ipc.handle('em:theme:get', () => ({ source: theme.get(), resolved: theme.resolved() }));
    ipc.handle('em:theme:set', ({ source }) => {
      theme.set(source);
      return { source: theme.get(), resolved: theme.resolved() };
    });
  },

  // The chosen source ('system' tracks the OS; 'light'/'dark' are explicit overrides).
  get() {
    return theme._nativeTheme ? theme._nativeTheme.themeSource : 'system';
  },

  // What's actually showing right now.
  resolved() {
    return theme._nativeTheme?.shouldUseDarkColors ? 'dark' : 'light';
  },

  // Apply + persist a new source. Throws on anything outside the three valid values —
  // a bad call is a programmer error, not a state to limp through.
  set(source) {
    if (!SOURCES.includes(source)) {
      throw new Error(`theme.set: invalid source '${source}' — expected 'system' | 'light' | 'dark'.`);
    }
    if (!theme._nativeTheme) {
      return;
    }

    theme._manager.storage.set(`${STORAGE_KEY}.appearance`, source);
    theme._nativeTheme.themeSource = source;

    // nativeTheme 'updated' only fires when the RESOLVED appearance changes — a
    // source change with the same resolution (e.g. system-resolving-dark → dark)
    // would otherwise go unannounced. _emitChange dedupes, so when 'updated' also
    // fires this is still exactly one notification.
    theme._emitChange();
  },

  // Subscribe to effective changes (source or resolution). Returns an unsubscribe fn.
  onChange(fn) {
    theme._listeners.add(fn);
    return () => theme._listeners.delete(fn);
  },

  _emitChange() {
    const payload = { source: theme.get(), resolved: theme.resolved() };
    const stamp = `${payload.source}|${payload.resolved}`;
    if (stamp === theme._lastEmitted) {
      return;
    }
    theme._lastEmitted = stamp;

    logger.log(`changed — source=${payload.source} resolved=${payload.resolved}`);

    theme._listeners.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        logger.error('onChange subscriber threw:', e);
      }
    });

    if (ipc._initialized) {
      ipc.broadcast('em:theme:changed', payload);
    }
  },

  // Tear down listeners + IPC (idempotent).
  disable() {
    if (theme._nativeTheme && theme._onNativeUpdated) {
      theme._nativeTheme.removeListener('updated', theme._onNativeUpdated);
      theme._onNativeUpdated = null;
    }
    theme._listeners.clear();
    if (ipc._initialized) {
      ipc.unhandle('em:theme:get');
      ipc.unhandle('em:theme:set');
    }
    theme._initialized = false;
  },
};

module.exports = theme;
