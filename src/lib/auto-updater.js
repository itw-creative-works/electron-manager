// Auto-updater — wraps electron-updater with three triggers:
//
//   1. Startup check        — fires `startupDelayMs` after `whenReady` (default 10s, non-blocking).
//   2. Periodic check       — `setInterval` every `intervalMs` (default 60s).
//   3. 30-day pending gate  — once an update is downloaded, store `downloadedAt`. On every poll
//                             tick + at app start, if (now - downloadedAt) >= maxAgeMs (default 30d),
//                             force `quitAndInstall()`. Counter is set on the FIRST download and not
//                             reset by subsequent downloads — first one wins. Cleared only when the app
//                             actually launches at the pendingUpdate.version (i.e. install applied).
//
// State machine (broadcast to renderers as `em:auto-updater:status`):
//   idle / checking / available / downloading / downloaded / not-available / error
//
// Dev simulation: set `EM_DEV_UPDATE=available|unavailable|error` env var. The updater synthesizes
// the appropriate event sequence so you can test the UI flow without a real update server.
//
// Renderer surface (added to preload.js as `window.em.autoUpdater`):
//   getStatus()      → { code, version, percent, error?, downloadedAt? }
//   onStatus(fn)     → unsubscribe fn; called on every state change.
//   checkNow()       → user-initiated check (shows dialogs on completion).
//   installNow()     → quitAndInstall() if status === 'downloaded'.

const LoggerLite = require('./logger-lite.js');
const logger = new LoggerLite('auto-updater');

const STORAGE_KEY = 'autoUpdater';

const DEFAULTS = {
  enabled:       true,
  channel:       'latest',
  startupDelayMs:  10 * 1000,           // 10s after whenReady
  intervalMs:    60 * 1000,             // 60s — every minute we re-check the feed and re-evaluate the 30-day gate
  maxAgeMs:      30 * 24 * 60 * 60 * 1000,  // 30 days
  autoDownload:  true,
};

// Fresh state object so a single `Object.assign` never bleeds between instances or test runs.
function freshState() {
  return {
    code:          'idle',
    version:       null,
    percent:       0,
    error:         null,
    downloadedAt:  null,
    lastCheckedAt: null,
  };
}

const autoUpdater = {
  _initialized: false,
  _manager:     null,
  _library:     null,
  _options:     null,
  _state:       freshState(),
  _intervalId:  null,
  _pendingTimers: [],
  _userInitiated: false,
  _devSimulating: false,

  async initialize(manager) {
    autoUpdater._manager = manager;
    autoUpdater._initialized = true;
    autoUpdater._state = freshState();

    const cfg = (manager && manager.config && manager.config.autoUpdate) || {};
    autoUpdater._options = { ...DEFAULTS, ...cfg };

    if (autoUpdater._options.enabled === false) {
      logger.log('auto-updater disabled via config.autoUpdate.enabled=false');
      return;
    }

    // 1. Reconcile any pending update from a prior session.
    autoUpdater._reconcilePendingUpdate();

    // 2. Wire the electron-updater instance (or dev simulator).
    if (autoUpdater._isDevMode()) {
      logger.log(`Dev simulation mode active (EM_DEV_UPDATE=${process.env.EM_DEV_UPDATE})`);
      autoUpdater._wireDevSimulator();
    } else {
      autoUpdater._wireElectronUpdater();
    }

    // 3. IPC: renderer status query + actions. Unhandle first so re-init is idempotent.
    if (manager && manager.ipc) {
      const channels = [
        ['em:auto-updater:status',     async () => autoUpdater.getStatus()],
        ['em:auto-updater:check-now',  async () => autoUpdater.checkNow({ userInitiated: true })],
        ['em:auto-updater:install-now', async () => autoUpdater.installNow()],
      ];
      for (const [chan, fn] of channels) {
        try { if (typeof manager.ipc.unhandle === 'function') manager.ipc.unhandle(chan); } catch (e) { /* ignore */ }
        manager.ipc.handle(chan, fn);
      }
    }

    // 4. Schedule startup check (non-blocking).
    const startupDelay = autoUpdater._options.startupDelayMs;
    autoUpdater._pendingTimers.push(setTimeout(() => {
      autoUpdater.checkNow({ userInitiated: false }).catch((e) => logger.warn(`startup check failed: ${e.message}`));
    }, startupDelay));

    // 5. Schedule periodic check.
    if (autoUpdater._options.intervalMs > 0) {
      autoUpdater._intervalId = setInterval(() => {
        autoUpdater.checkNow({ userInitiated: false }).catch((e) => logger.warn(`periodic check failed: ${e.message}`));
        autoUpdater._enforceMaxAgeGate();
      }, autoUpdater._options.intervalMs);
    }

    logger.log(`auto-updater initialized (interval=${autoUpdater._options.intervalMs}ms, maxAge=${autoUpdater._options.maxAgeMs}ms)`);
  },

  // Public API ─────────────────────────────────────────────────────────────────────

  getStatus() {
    return { ...autoUpdater._state };
  },

  async checkNow(opts) {
    opts = opts || {};
    autoUpdater._userInitiated = !!opts.userInitiated;
    autoUpdater._state.lastCheckedAt = Date.now();

    if (!autoUpdater._readyToCheck()) {
      logger.log(`Skipping check — current state=${autoUpdater._state.code}`);
      return autoUpdater.getStatus();
    }

    if (autoUpdater._isDevMode()) {
      autoUpdater._runDevSimulation();
      return autoUpdater.getStatus();
    }

    if (!autoUpdater._library) {
      logger.warn('checkNow() called before library wired.');
      return autoUpdater.getStatus();
    }

    try {
      await autoUpdater._library.checkForUpdates();
    } catch (e) {
      autoUpdater._setState({ code: 'error', error: { message: e.message } });
    }
    return autoUpdater.getStatus();
  },

  async installNow() {
    if (autoUpdater._state.code !== 'downloaded') {
      logger.log(`installNow ignored — state=${autoUpdater._state.code}`);
      return false;
    }
    if (autoUpdater._isDevMode()) {
      logger.log('Dev mode — skipping real quitAndInstall().');
      return true;
    }
    if (autoUpdater._library && typeof autoUpdater._library.quitAndInstall === 'function') {
      autoUpdater._library.quitAndInstall();
      return true;
    }
    return false;
  },

  // Lifecycle teardown — used by tests.
  shutdown() {
    if (autoUpdater._intervalId) clearInterval(autoUpdater._intervalId);
    autoUpdater._pendingTimers.forEach((t) => clearTimeout(t));
    autoUpdater._intervalId  = null;
    autoUpdater._pendingTimers = [];
    autoUpdater._initialized   = false;
    autoUpdater._library       = null;
    autoUpdater._userInitiated = false;
    autoUpdater._devSimulating = false;

    const m = autoUpdater._manager;
    if (m && m.ipc && typeof m.ipc.unhandle === 'function') {
      ['em:auto-updater:status', 'em:auto-updater:check-now', 'em:auto-updater:install-now'].forEach((c) => {
        try { m.ipc.unhandle(c); } catch (e) { /* ignore */ }
      });
    }
  },

  // Internals ──────────────────────────────────────────────────────────────────────

  _isDevMode() {
    return !!process.env.EM_DEV_UPDATE;
  },

  _getCurrentVersion() {
    try {
      const electron = require('electron');
      if (electron && electron.app && typeof electron.app.getVersion === 'function') {
        return electron.app.getVersion();
      }
    } catch (e) { /* not in electron */ }
    try {
      const path = require('path');
      const pkg = require(path.join(process.cwd(), 'package.json'));
      return pkg && pkg.version;
    } catch (e) { /* ignore */ }
    return null;
  },

  _readyToCheck() {
    // Don't re-check while we're already mid-flight (checking/available/downloading) or sitting
    // on a downloaded update waiting to install — re-checking would just re-download the same thing.
    return ['idle', 'not-available', 'error'].includes(autoUpdater._state.code);
  },

  _setState(patch) {
    autoUpdater._state = { ...autoUpdater._state, ...patch };
    autoUpdater._broadcastStatus();
  },

  _broadcastStatus() {
    const m = autoUpdater._manager;
    if (m && m.ipc && typeof m.ipc.broadcast === 'function') {
      m.ipc.broadcast('em:auto-updater:status', autoUpdater.getStatus());
    }
    autoUpdater._updateMenuItem();
    logger.log(`status → ${autoUpdater._state.code}${autoUpdater._state.version ? ` v${autoUpdater._state.version}` : ''}${autoUpdater._state.percent ? ` (${autoUpdater._state.percent}%)` : ''}`);
  },

  // Reflect updater state into the menu item with id 'em:check-for-updates'.
  // Consumer can re-tag a different item with the same id, or remove the item entirely
  // via menu.removeItem('em:check-for-updates') in their src/menu/index.js.
  _updateMenuItem() {
    const m = autoUpdater._manager;
    if (!m || !m.menu || typeof m.menu.updateItem !== 'function') return;
    const s = autoUpdater._state;

    let label, enabled = true;
    switch (s.code) {
      case 'checking':       label = 'Checking for Updates...';                       enabled = false; break;
      case 'available':      label = `Downloading Update v${s.version || ''}...`;     enabled = false; break;
      case 'downloading':    label = `Downloading Update (${Math.round(s.percent)}%)`; enabled = false; break;
      case 'downloaded':     label = `Restart to Update v${s.version || ''}`;         enabled = true;  break;
      case 'not-available':  label = 'You\'re up to date';                            enabled = true;  break;
      case 'error':          label = 'Check for Updates...';                          enabled = true;  break;
      case 'idle':
      default:               label = 'Check for Updates...';                          enabled = true;  break;
    }

    try { m.menu.updateItem('em:check-for-updates', { label, enabled }); } catch (e) { /* menu not built yet */ }
  },

  // 30-day gate ────────────────────────────────────────────────────────────────────

  _reconcilePendingUpdate() {
    const m = autoUpdater._manager;
    if (!m || !m.storage || typeof m.storage.get !== 'function') return;

    const pending = m.storage.get(`${STORAGE_KEY}.pendingUpdate`);
    if (!pending || !pending.downloadedAt) return;

    const currentVersion = autoUpdater._getCurrentVersion();
    if (currentVersion && pending.version === currentVersion) {
      logger.log(`Pending update v${pending.version} appears to be applied — clearing flag.`);
      m.storage.set(`${STORAGE_KEY}.pendingUpdate`, null);
      return;
    }

    autoUpdater._state.downloadedAt = pending.downloadedAt;
    autoUpdater._state.version      = pending.version;
    logger.log(`Pending update v${pending.version} carried from prior session (downloadedAt=${new Date(pending.downloadedAt).toISOString()})`);
    // Check the gate immediately at startup.
    autoUpdater._enforceMaxAgeGate();
  },

  _recordDownloadedAt(version) {
    const m = autoUpdater._manager;
    if (!m || !m.storage) return;

    const existing = m.storage.get(`${STORAGE_KEY}.pendingUpdate`);
    // FIRST download wins — don't reset the timer if an existing pending entry is present.
    if (existing && existing.downloadedAt) {
      logger.log(`pendingUpdate already recorded (v${existing.version} @ ${new Date(existing.downloadedAt).toISOString()}) — keeping existing timestamp.`);
      autoUpdater._state.downloadedAt = existing.downloadedAt;
      return;
    }
    const now = Date.now();
    m.storage.set(`${STORAGE_KEY}.pendingUpdate`, { version, downloadedAt: now });
    autoUpdater._state.downloadedAt = now;
    logger.log(`Recorded pendingUpdate v${version} @ ${new Date(now).toISOString()}`);
  },

  _enforceMaxAgeGate() {
    const downloadedAt = autoUpdater._state.downloadedAt;
    if (!downloadedAt) return false;

    const age = Date.now() - downloadedAt;
    const max = autoUpdater._options.maxAgeMs;
    if (age < max) return false;

    logger.warn(`Pending update is ${Math.round(age / 86400000)}d old (>= ${Math.round(max / 86400000)}d) — forcing install.`);
    autoUpdater.installNow();
    return true;
  },

  // electron-updater wiring ────────────────────────────────────────────────────────

  _wireElectronUpdater() {
    let lib;
    try {
      lib = require('electron-updater').autoUpdater;
    } catch (e) {
      logger.warn(`electron-updater not available: ${e.message}`);
      return;
    }
    autoUpdater._library = lib;
    lib.autoDownload = autoUpdater._options.autoDownload !== false;

    lib.on('checking-for-update', () => autoUpdater._setState({ code: 'checking', error: null }));
    lib.on('update-available',    (info) => autoUpdater._setState({ code: 'available', version: info?.version, error: null }));
    lib.on('update-not-available', (info) => autoUpdater._setState({ code: 'not-available', version: info?.version, error: null }));
    lib.on('download-progress',   (p) => {
      const percent = Math.min(100, parseFloat(((p && p.percent) || 0).toFixed(2)) || 0);
      autoUpdater._setState({ code: 'downloading', percent });
    });
    lib.on('update-downloaded', (info) => {
      autoUpdater._recordDownloadedAt(info?.version);
      autoUpdater._setState({ code: 'downloaded', version: info?.version, percent: 100, error: null });
    });
    lib.on('error', (e) => {
      const err = (e instanceof Error) ? e : new Error(String(e || 'Unknown auto-update error'));
      autoUpdater._setState({ code: 'error', error: { message: err.message } });
    });
  },

  // Dev simulation ─────────────────────────────────────────────────────────────────

  _wireDevSimulator() {
    autoUpdater._library = {
      checkForUpdates:  async () => autoUpdater._runDevSimulation(),
      quitAndInstall:   () => logger.log('Dev simulator: quitAndInstall() called (no-op in dev).'),
      autoDownload:     autoUpdater._options.autoDownload !== false,
      on:               () => {},
    };
  },

  _runDevSimulation() {
    if (autoUpdater._devSimulating) return;
    autoUpdater._devSimulating = true;

    const scenario = (process.env.EM_DEV_UPDATE || 'available').toLowerCase();
    const NEW_VERSION = '999.0.0';

    autoUpdater._setState({ code: 'checking' });

    setTimeout(() => {
      if (scenario === 'unavailable') {
        autoUpdater._setState({ code: 'not-available', version: NEW_VERSION });
        autoUpdater._devSimulating = false;
        return;
      }
      if (scenario === 'error') {
        autoUpdater._setState({ code: 'error', error: { message: 'Simulated dev-update error' } });
        autoUpdater._devSimulating = false;
        return;
      }

      // 'available' → cascade through download progress → downloaded.
      autoUpdater._setState({ code: 'available', version: NEW_VERSION });

      let percent = 0;
      const tick = () => {
        percent = Math.min(100, percent + 25);
        autoUpdater._setState({ code: 'downloading', version: NEW_VERSION, percent });
        if (percent < 100) {
          autoUpdater._pendingTimers.push(setTimeout(tick, 400));
        } else {
          autoUpdater._pendingTimers.push(setTimeout(() => {
            autoUpdater._recordDownloadedAt(NEW_VERSION);
            autoUpdater._setState({ code: 'downloaded', version: NEW_VERSION, percent: 100 });
            autoUpdater._devSimulating = false;
          }, 400));
        }
      };
      autoUpdater._pendingTimers.push(setTimeout(tick, 400));
    }, 400);
  },
};

module.exports = autoUpdater;
