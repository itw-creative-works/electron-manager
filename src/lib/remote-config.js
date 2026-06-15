// Remote config (a.k.a. "hot config") — fetches a JSON document from the
// consumer's brand site so app behavior can be flipped without shipping a new
// build. Modeled after the legacy somiibo/slapform `data/resources/main.json`
// pattern.
//
// Source URL:    `${brand.url}/data/resources/main.json`  (override via config.remoteConfig.url)
// Default cadence: same as auto-update feed-check (auto-updater.feedCheckIntervalMs, 1h)
// Fetch timeout:  60s — generous; app boot never blocks on this.
//
// Stable shape — these defaults are returned by `get()` BEFORE the first fetch
// completes (and any time fetch fails), so consumer code that reads them at
// boot never sees `undefined`. Consumers extend with their own fields freely.
const DEFAULTS = Object.freeze({
  status:          'online',     // 'online' | 'maintenance' — app gates UI on this
  versionRequired: '0.0.0',      // installed apps below this should force-update
  defaults:        {},           // free-form per-app overrides
});
//
// Lifecycle (the important part):
//   1. initialize() returns IMMEDIATELY (synchronous) — never blocks app boot.
//   2. Cached value (if any) from storage becomes the active data right away.
//      If no cache exists, DEFAULTS become the active data.
//   3. A background fetch fires. On success: replace _data + persist + emit
//      'update'. On failure: log a warning, leave _data alone (cache or DEFAULTS),
//      try again next tick.
//   4. The periodic timer keeps re-fetching at the auto-updater feed-check
//      cadence. Every successful fetch fires another 'update' event so consumer
//      code can re-run its gates (force-update check, maintenance banner, etc.).
//
// Re-running a gate on update:
//   const checkVersion = (cfg) => {
//     const required = cfg?.versionRequired || '0.0.0';
//     if (semver.lt(app.getVersion(), required)) showForceUpdateDialog();
//   };
//   checkVersion(manager.remoteConfig.get());                  // run at boot with defaults/cache
//   manager.remoteConfig.on('update', checkVersion);           // re-run on every fresh fetch
//
// API:
//   manager.remoteConfig.get()                   → entire data (defaults | cache | latest fetch)
//   manager.remoteConfig.get('versionRequired')  → dot-path lookup
//   manager.remoteConfig.on('update', fn)        → subscribe; returns unsub fn
//   manager.remoteConfig.refreshNow()            → force a fetch right now (Promise<data | null>)

const LoggerLite       = require('./logger-lite.js');
const fetch            = require('wonderful-fetch');
const formatFetchError = require('../utils/format-fetch-error.js');

const logger = new LoggerLite('remote-config');

const STORAGE_KEY = 'remoteConfig';
const FETCH_TIMEOUT_MS = 60 * 1000;       // 60s — generous; this is a once-an-hour fetch

const remoteConfig = {
  _initialized: false,
  _manager:     null,
  _data:        null,
  _intervalId:  null,
  _listeners:   new Set(),
  _url:         null,
  _enabled:     true,

  initialize(manager) {
    if (remoteConfig._initialized) return;
    remoteConfig._initialized = true;
    remoteConfig._manager = manager;

    // Always seed with safe defaults FIRST so any caller reading `get()` between
    // `initialize()` and the first successful fetch sees usable values (status:
    // 'online', versionRequired: '0.0.0', etc.) instead of undefined.
    remoteConfig._data = { ...DEFAULTS };

    const cfg = manager.config.remoteConfig || {};
    remoteConfig._enabled = cfg.enabled !== false;       // default on

    if (!remoteConfig._enabled) {
      logger.log('remote-config disabled via config.remoteConfig.enabled=false');
      return;
    }

    // Resolve the fetch URL. Explicit override wins. Otherwise derive from
    // brand.url + the legacy convention path.
    if (cfg.url) {
      remoteConfig._url = cfg.url;
    } else if (manager.config.brand.url) {
      const base = String(manager.config.brand.url).replace(/\/$/, '');
      remoteConfig._url = `${base}/data/resources/main.json`;
    }

    if (!remoteConfig._url) {
      logger.warn('remote-config: no URL resolvable (set config.brand.url or config.remoteConfig.url) — using defaults only.');
      return;
    }

    // Restore cached data on top of defaults (last-known-good wins over defaults
    // until the next successful fetch lands).
    const cached = manager.storage.get(STORAGE_KEY);
    if (cached && typeof cached === 'object') {
      remoteConfig._data = { ...DEFAULTS, ...cached };
    }

    // Kick off the initial fetch — fire-and-forget, never blocks. A failure here
    // is non-fatal; we already have defaults (and possibly cache) seeded above.
    remoteConfig.refreshNow().catch((e) => logger.warn(`initial fetch failed (using defaults/cache): ${formatFetchError(e)}`));

    // Cadence: match auto-updater's feed-check (same "occasionally network-hits-the-internet"
    // job category). Auto-updater is wired BEFORE remote-config in boot sequence
    // so `_options` is always populated; testing collapses to 500ms via isTesting().
    const interval = manager.isTesting()
      ? 500
      : manager.autoUpdater._options.feedCheckIntervalMs;
    remoteConfig._intervalId = setInterval(() => {
      remoteConfig.refreshNow().catch((e) => logger.warn(`periodic fetch failed: ${formatFetchError(e)}`));
    }, interval);

    // IPC: renderer reads via invoke. Subscribe-to-update is an IPC broadcast,
    // wired into the in-process listener below.
    manager.ipc.unhandle('em:remote-config:get');
    manager.ipc.handle('em:remote-config:get',         (path) => remoteConfig.get(path));
    manager.ipc.unhandle('em:remote-config:refresh-now');
    manager.ipc.handle('em:remote-config:refresh-now', () => remoteConfig.refreshNow());
    // Broadcast updates to renderers.
    remoteConfig.on('update', (data) => {
      manager.ipc.broadcast('em:remote-config:update', data);
    });

    logger.log(`remote-config initialized — url=${remoteConfig._url} interval=${interval}ms (using defaults until first fetch)`);
  },

  // ─── Public API ─────────────────────────────────────────────────────────────

  // Read the current data. Cache-first, never blocks. Returns the full snapshot
  // (or a dot-path slice) — always something usable: defaults at boot, cached
  // value if a prior session got one, latest fetch result thereafter.
  get(path) {
    const data = remoteConfig._data || DEFAULTS;
    if (!path) return { ...data };
    const parts = String(path).split('.');
    let cur = data;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  },

  // Subscribe to fresh-fetch events. Use this to re-run any gates (force-update
  // checks, maintenance banners, etc.) when fresh server values arrive. Returns
  // an unsubscribe function.
  on(event, fn) {
    if (event !== 'update') {
      logger.warn(`remote-config: unknown event "${event}" (only "update" supported)`);
      return () => {};
    }
    remoteConfig._listeners.add(fn);
    return () => remoteConfig._listeners.delete(fn);
  },

  // Force a fetch right now. Returns the new data or null on failure (does NOT
  // throw — failure mode is "leave existing _data in place"). Used internally
  // for periodic ticks; consumers can call this to react to a "Check now" UI.
  async refreshNow() {
    if (!remoteConfig._enabled || !remoteConfig._url) return null;
    let data;
    try {
      data = await fetch(remoteConfig._url, {
        method:   'get',
        response: 'json',
        timeout:  FETCH_TIMEOUT_MS,
        tries:    2,
      });
    } catch (e) {
      // Periodic-poll failure is the common case (offline, server flap, DNS
      // hiccup). Leave _data untouched (defaults / cache / last-known-good)
      // and rethrow so the caller can decide whether to log/retry.
      throw e;
    }
    if (!data || typeof data !== 'object') return null;

    // Layer fresh fetch on top of defaults so consumers can omit fields from
    // their hosted JSON and EM still has sensible values.
    remoteConfig._data = { ...DEFAULTS, ...data };
    remoteConfig._manager.storage.set(STORAGE_KEY, data);
    remoteConfig._emit('update', remoteConfig._data);
    logger.log(`remote-config refreshed (${remoteConfig._url})`);
    return remoteConfig._data;
  },

  // ─── Internals ──────────────────────────────────────────────────────────────

  _emit(event, payload) {
    for (const fn of remoteConfig._listeners) {
      try { fn(payload); } catch (e) { logger.warn(`listener for "${event}" threw: ${e.message}`); }
    }
  },

  // Test/teardown. Resets back to "uninitialized" — the next initialize() will
  // re-seed defaults, restore cache, kick off fetch.
  shutdown() {
    if (remoteConfig._intervalId) clearInterval(remoteConfig._intervalId);
    remoteConfig._intervalId = null;
    remoteConfig._initialized = false;
    remoteConfig._manager     = null;
    remoteConfig._data        = null;
    remoteConfig._listeners.clear();
    remoteConfig._url         = null;
    remoteConfig._enabled     = true;
  },
};

// Exported separately so tests + consumer-doc examples can import directly.
remoteConfig.DEFAULTS = DEFAULTS;

module.exports = remoteConfig;
