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

  const { contextBridge, ipcRenderer } = require('electron');

  if (!contextBridge || !ipcRenderer) {
    self.logger.warn('contextBridge / ipcRenderer not available — preload running in test mode.');
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
    // Theme — system-aware appearance. get/set proxy to main (lib/theme.js owns
    // nativeTheme.themeSource + persistence). onChange is MATCHMEDIA-powered, not an
    // IPC broadcast: setting themeSource flips `prefers-color-scheme` in every
    // renderer of the app (including embedded WebContentsViews, which ipc.broadcast
    // can never reach), so each renderer self-resolves. Returns an unsubscribe fn.
    theme: {
      get: ()       => ipcRenderer.invoke('em:theme:get'),
      set: (source) => ipcRenderer.invoke('em:theme:set', { source }),
      onChange: (handler) => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const wrapped = (e) => handler({ resolved: e.matches ? 'dark' : 'light' });
        media.addEventListener('change', wrapped);
        return () => media.removeEventListener('change', wrapped);
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
    // GA4 analytics — fire-and-forget event sender. Same shape as on main, just
    // routes through IPC so renderer code is identical.
    analytics: {
      event:             (name, params)  => ipcRenderer.send('em:analytics:event', { name, params }),
      pageview:          (path)          => ipcRenderer.send('em:analytics:event', { name: 'page_view',   params: path ? { page_path: path } : {} }),
      screenview:        (screenName)    => ipcRenderer.send('em:analytics:event', { name: 'screen_view', params: screenName ? { screen_name: screenName } : {} }),
      setUserProperties: (props)         => ipcRenderer.send('em:analytics:set-user-properties', props),
      getStatus:         ()              => ipcRenderer.invoke('em:analytics:status'),
    },
    // Runtime context (geolocation / client / session / app). Read once at
    // renderer init or whenever fresh values are needed.
    context: {
      get: () => ipcRenderer.invoke('em:context:get'),
    },
    // Usage stats (opens / hoursTotal / hoursThisSession).
    usage: {
      get: () => ipcRenderer.invoke('em:usage:get'),
    },
    // Hot config — same get/refreshNow surface as main, plus an onUpdate
    // subscription that fires whenever main re-fetches successfully.
    remoteConfig: {
      get:        (path) => ipcRenderer.invoke('em:remote-config:get', path),
      refreshNow: ()     => ipcRenderer.invoke('em:remote-config:refresh-now'),
      onUpdate: (handler) => {
        const wrapped = (_, payload) => handler(payload);
        ipcRenderer.on('em:remote-config:update', wrapped);
        return () => ipcRenderer.removeListener('em:remote-config:update', wrapped);
      },
    },
  });

  // Auto-updater activity tracking — listen for renderer-side mouse / keyboard / wheel
  // / focus events and debounce-fire an `em:auto-updater:activity` IPC ping to main.
  // Main uses these pings to keep `lastActivityAt` fresh so a downloaded update only
  // auto-installs when the user has been idle for 15+ minutes.
  //
  // Debounced to once per 5s — anything more granular is just noise (the threshold is
  // 15 min; sub-second precision doesn't matter). Listeners attach in `capture` phase
  // on `window` so renderer code can't accidentally suppress them via stopPropagation.
  try {
    let lastPing = 0;
    const ACTIVITY_DEBOUNCE_MS = 5000;
    const ping = () => {
      const now = Date.now();
      if (now - lastPing < ACTIVITY_DEBOUNCE_MS) return;
      lastPing = now;
      try { ipcRenderer.send('em:auto-updater:activity'); } catch (e) { /* ignore */ }
    };
    const events = ['mousedown', 'keydown', 'wheel', 'touchstart', 'focus'];
    for (const ev of events) {
      // `passive: true` so we never accidentally block scrolling; `capture: true` so we
      // see the event before any renderer-side handler can stopPropagation it.
      window.addEventListener(ev, ping, { passive: true, capture: true });
    }
  } catch (e) { /* DOM not available (test mode) — skip */ }

  // Theme applier — keeps `<html data-bs-theme>` matched to the RESOLVED appearance
  // ('light'/'dark'), live, on every EM-templated page. Opt-in by presence: only pages
  // that already carry the attribute (stamped by the page template at build) are
  // managed — pages without it (e.g. external sites loaded in a consumer's embedded
  // web views, which get this same preload) are never touched.
  //
  // This is the live-update path for ALL renderers: main flips nativeTheme.themeSource
  // → `prefers-color-scheme` flips here → matchMedia 'change' fires → re-apply. No IPC.
  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const root = document.documentElement;
      if (!root || !root.hasAttribute('data-bs-theme')) {
        return;
      }
      root.setAttribute('data-bs-theme', media.matches ? 'dark' : 'light');
    };

    // The stamped attribute only exists once the HTML has parsed — apply at
    // DOMContentLoaded (or immediately when the document is already past it).
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }
    media.addEventListener('change', apply);
  } catch (e) { /* DOM not available (test mode) — skip */ }

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

// Mix in shared cross-context helpers — same code path used in main, renderer, build.
require('./utils/mode-helpers.js').attachTo(Manager);
require('./utils/url-helpers.js').attachTo(Manager);

module.exports = Manager;
