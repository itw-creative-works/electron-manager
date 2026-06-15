// Remote emergency scripts — fetches a single JS file from the brand's website
// so developers can push hotfixes when the normal update pipeline is broken.
//
// Source URL:     `${brand.url}/data/scripts/main.js` (override via config.remoteScripts.url)
// Cadence:        matches remote-config (auto-updater feedCheckIntervalMs, ~1h)
// Fetch timeout:  60s
//
// The file is plain JavaScript fetched as text. It runs as an async function
// body with `manager` and `require` in scope — full main-process access.
// Dedup is automatic: the script's content hash is stored in electron-store and
// the same script won't re-execute until the content changes.
//
// API:
//   manager.remoteScripts.refreshNow()    → force-fetch + execute if changed
//   manager.remoteScripts.getLastRun()    → { hash, timestamp } or null
//   manager.remoteScripts.clearExecuted() → wipe stored hash (forces re-run next poll)

const LoggerLite       = require('./logger-lite.js');
const fetch            = require('wonderful-fetch');
const formatFetchError = require('../utils/format-fetch-error.js');

const logger = new LoggerLite('remote-scripts');

const STORAGE_KEY = 'remoteScripts.lastRun';
const FETCH_TIMEOUT_MS = 60 * 1000;

const remoteScripts = {
  _initialized: false,
  _manager:     null,
  _url:         null,
  _enabled:     true,
  _intervalId:  null,

  initialize(manager) {
    if (remoteScripts._initialized) return;
    remoteScripts._initialized = true;
    remoteScripts._manager = manager;

    const cfg = manager.config.remoteScripts || {};
    remoteScripts._enabled = cfg.enabled !== false;

    if (!remoteScripts._enabled) {
      logger.log('remote-scripts disabled via config.remoteScripts.enabled=false');
      return;
    }

    if (cfg.url) {
      remoteScripts._url = cfg.url;
    } else if (manager.config.brand.url) {
      const base = String(manager.config.brand.url).replace(/\/$/, '');
      remoteScripts._url = `${base}/data/scripts/main.js`;
    }

    if (!remoteScripts._url) {
      logger.warn('remote-scripts: no URL resolvable (set config.brand.url or config.remoteScripts.url) — disabled.');
      return;
    }

    remoteScripts.refreshNow()
      .catch((e) => logger.warn(`initial fetch failed: ${formatFetchError(e)}`));

    const interval = manager.isTesting()
      ? 500
      : manager.autoUpdater._options.feedCheckIntervalMs;
    remoteScripts._intervalId = setInterval(() => {
      remoteScripts.refreshNow()
        .catch((e) => logger.warn(`periodic fetch failed: ${formatFetchError(e)}`));
    }, interval);

    logger.log(`remote-scripts initialized — url=${remoteScripts._url} interval=${interval}ms`);
  },

  // ─── Public API ─────────────────────────────────────────────────────────────

  async refreshNow() {
    if (!remoteScripts._enabled || !remoteScripts._url) return null;

    let code;
    try {
      code = await fetch(remoteScripts._url, {
        method:   'get',
        response: 'text',
        timeout:  FETCH_TIMEOUT_MS,
        tries:    2,
      });
    } catch (e) {
      throw e;
    }

    if (!code || typeof code !== 'string' || !code.trim()) return null;

    const hash = remoteScripts._hash(code);
    const lastRun = remoteScripts.getLastRun();

    if (lastRun && lastRun.hash === hash) return null;

    try {
      await remoteScripts._execute(code);
      logger.log(`remote-scripts: executed script (hash=${hash})`);
    } catch (e) {
      logger.error(`remote-scripts: script threw: ${e.message}`);
    }

    remoteScripts._manager.storage.set(STORAGE_KEY, { hash, timestamp: Date.now() });
    return { hash };
  },

  getLastRun() {
    if (!remoteScripts._manager) return null;
    return remoteScripts._manager.storage.get(STORAGE_KEY) || null;
  },

  clearExecuted() {
    if (!remoteScripts._manager) return;
    remoteScripts._manager.storage.set(STORAGE_KEY, null);
  },

  // ─── Internals ──────────────────────────────────────────────────────────────

  async _execute(code) {
    const manager = remoteScripts._manager;
    const realRequire = (typeof __non_webpack_require__ !== 'undefined') ? __non_webpack_require__ : require;

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('manager', 'require', code);
    await fn(manager, realRequire);
  },

  _hash(str) {
    return require('crypto').createHash('sha256').update(str).digest('hex').slice(0, 16);
  },

  shutdown() {
    if (remoteScripts._intervalId) clearInterval(remoteScripts._intervalId);
    remoteScripts._intervalId  = null;
    remoteScripts._initialized = false;
    remoteScripts._manager     = null;
    remoteScripts._url         = null;
    remoteScripts._enabled     = true;
  },
};

module.exports = remoteScripts;
