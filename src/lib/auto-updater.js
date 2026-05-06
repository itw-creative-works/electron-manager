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

// Idle-aware install constants — hardcoded for now (not config-shaped). Tune here.
//
// A downloaded update no longer auto-installs after a flat 5s delay. Instead:
//   1. Any UI activity (mouse / keyboard / window focus / IPC traffic / tray click /
//      menu invocation / deep-link arrival) bumps `_lastActivityAt = Date.now()`.
//   2. Once an update is downloaded, an idle-watcher polls every minute. If the user
//      has been idle for `IDLE_INSTALL_THRESHOLD_MS` it fires `installNow()`.
//   3. If they're active when the update lands, EM prompts ONCE via electron's
//      native dialog ("Restart now / Later"). Dismissal is "not now" — the watcher
//      keeps polling so it'll auto-install whenever the user eventually walks away.
//      We never re-prompt for the same version (tracked via `_promptedForVersion`).
//
// Consumer hook: `manager.autoUpdater.markActive()` lets app code force-bump the
// activity timestamp from anywhere (e.g. just received an auth event, finished a
// long-running renderer task, etc.). Use sparingly — the built-in signals cover
// 99% of real activity.
const IDLE_INSTALL_THRESHOLD_MS = 15 * 60 * 1000;   // 15 min
const IDLE_WATCHER_INTERVAL_MS  = 60 * 1000;        // re-check every minute

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

  // Idle-aware install state.
  _lastActivityAt:     Date.now(),     // bumped by markActive(); seed to "now" so we don't auto-install the instant we boot
  _idleWatcherId:      null,           // setInterval handle for the post-download watcher
  _promptedForVersion: null,           // version string we've already prompted about — never prompt twice for the same version
  _activityHooksWired: false,          // guard: only wire main-side activity listeners once per process

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
      // Activity ping from preload (debounced renderer-side mouse/keyboard/focus).
      // Listener (not handle) — fire-and-forget, no response needed. Set-backed
      // listener registry deduplicates same-fn re-adds, so re-init is safe.
      if (typeof manager.ipc.on === 'function') {
        manager.ipc.on('em:auto-updater:activity', autoUpdater._onActivityIpc);
      }
    }

    // 3b. Wire main-side activity hooks (browser-window focus, tray clicks, menu
    // invocations, deep-link arrivals — see _wireActivityHooks). One-shot per process.
    autoUpdater._wireActivityHooks();

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

  // Bump the activity timestamp. Called automatically by the built-in activity hooks
  // (renderer mouse/keyboard, browser-window focus). Consumer code can also call this
  // directly from anywhere (`manager.autoUpdater.markActive()`) to force-bump on
  // app-specific activity.
  markActive() {
    autoUpdater._lastActivityAt = Date.now();
  },

  // Named handler for the IPC activity listener so the listener registry's Set-based
  // dedupe collapses repeated re-init calls into one entry.
  _onActivityIpc() {
    autoUpdater.markActive();
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
    // Flip the manager's quit flag so the window-manager close handler lets the
    // close events through instead of trapping them with hide-on-close. Without
    // this, quitAndInstall() fires before-quit but the BrowserWindow's close
    // handler (which runs FIRST since it has its own listener) would call
    // event.preventDefault() and the install would just hide the window.
    if (autoUpdater._manager) {
      autoUpdater._manager._allowQuit = true;
    }
    if (autoUpdater._library && typeof autoUpdater._library.quitAndInstall === 'function') {
      autoUpdater._library.quitAndInstall();
      return true;
    }
    return false;
  },

  // Lifecycle teardown — used by tests.
  shutdown() {
    if (autoUpdater._intervalId)   clearInterval(autoUpdater._intervalId);
    if (autoUpdater._idleWatcherId) clearInterval(autoUpdater._idleWatcherId);
    autoUpdater._pendingTimers.forEach((t) => clearTimeout(t));
    autoUpdater._intervalId  = null;
    autoUpdater._idleWatcherId = null;
    autoUpdater._pendingTimers = [];
    autoUpdater._initialized   = false;
    autoUpdater._library       = null;
    autoUpdater._userInitiated = false;
    autoUpdater._devSimulating = false;
    autoUpdater._promptedForVersion = null;
    autoUpdater._activityHooksWired = false;

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
    const prevCode = autoUpdater._state.code;
    autoUpdater._state = { ...autoUpdater._state, ...patch };
    autoUpdater._broadcastStatus();

    // Idle-aware install — when an update finishes downloading via a background poll
    // (NOT a user-initiated check), kick off the idle watcher. Watcher polls every
    // minute; only auto-installs when the user has been idle ≥ IDLE_INSTALL_THRESHOLD_MS.
    // If active when the update lands, prompts once via electron's native dialog and
    // never re-prompts for the same version — but the watcher keeps polling so the
    // install eventually fires whenever the user steps away.
    //
    // User-initiated checks skip all this; the consumer's UI is expected to surface a
    // "Restart to update" affordance (the menu/tray check-for-updates item already does
    // this label-wise — see _menuItemFieldsForState).
    if (
      patch.code === 'downloaded'
      && prevCode !== 'downloaded'
      && !autoUpdater._userInitiated
      && !autoUpdater._isDevMode()
    ) {
      autoUpdater._startIdleInstallWatcher();
    }
  },

  // Start (or restart) the idle-install watcher. Called when an update transitions to
  // 'downloaded' from a non-user-initiated check. Idempotent — clears any prior watcher
  // first. The watcher tick runs every IDLE_WATCHER_INTERVAL_MS:
  //   - If now - _lastActivityAt >= IDLE_INSTALL_THRESHOLD_MS → installNow() (which exits)
  //   - Else if we haven't prompted for this version yet → show the dialog
  //   - Else: do nothing this tick, check again next tick
  _startIdleInstallWatcher() {
    if (autoUpdater._idleWatcherId) clearInterval(autoUpdater._idleWatcherId);
    logger.log(`Update downloaded — starting idle-install watcher (threshold=${IDLE_INSTALL_THRESHOLD_MS / 60000}min, tick=${IDLE_WATCHER_INTERVAL_MS / 1000}s).`);
    // Run one tick immediately so a downloaded update during a long idle stretch installs
    // promptly instead of waiting another full interval.
    autoUpdater._idleInstallTick();
    autoUpdater._idleWatcherId = setInterval(() => autoUpdater._idleInstallTick(), IDLE_WATCHER_INTERVAL_MS);
  },

  _idleInstallTick() {
    if (autoUpdater._state.code !== 'downloaded') {
      // Update was applied or cleared — stop the watcher.
      if (autoUpdater._idleWatcherId) {
        clearInterval(autoUpdater._idleWatcherId);
        autoUpdater._idleWatcherId = null;
      }
      return;
    }

    const idleMs = Date.now() - autoUpdater._lastActivityAt;
    if (idleMs >= IDLE_INSTALL_THRESHOLD_MS) {
      logger.log(`User idle for ${Math.round(idleMs / 60000)}min — auto-installing update v${autoUpdater._state.version}.`);
      try { autoUpdater.installNow(); }
      catch (e) { logger.warn(`idle auto-install failed: ${e.message}`); }
      return;
    }

    // User is active — prompt once per version.
    const v = autoUpdater._state.version;
    if (v && autoUpdater._promptedForVersion !== v) {
      autoUpdater._promptedForVersion = v;
      autoUpdater._promptToInstall(v).catch((e) => logger.warn(`install prompt failed: ${e.message}`));
    }
  },

  // Show a native dialog asking the user to restart now. Non-blocking (fire-and-forget).
  // Dismissal ("Later") is fine — the watcher keeps polling and will auto-install once
  // the user goes idle.
  async _promptToInstall(version) {
    try {
      const electron = require('electron');
      const { dialog, BrowserWindow } = electron;
      if (!dialog) return;

      const focusedWindow = BrowserWindow?.getFocusedWindow?.() || null;
      const productName = autoUpdater._manager?.config?.app?.productName
        || autoUpdater._manager?.config?.brand?.name
        || 'this app';

      const result = await dialog.showMessageBox(focusedWindow, {
        type:    'info',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId:  1,
        title:   'Update Ready',
        message: `${productName} is ready to install version ${version}.`,
        detail:  `Restart to apply the update now, or it will install automatically the next time you're idle.`,
      });

      if (result.response === 0) {
        logger.log(`User accepted install prompt — installing v${version}.`);
        autoUpdater.installNow();
      } else {
        logger.log(`User dismissed install prompt for v${version} — watcher continues.`);
        // Bump activity so we don't re-prompt within the same tick window.
        autoUpdater.markActive();
      }
    } catch (e) {
      logger.warn(`_promptToInstall failed: ${e.message}`);
    }
  },

  // Wire main-process activity hooks. Idempotent — only runs once per process.
  // Renderer-side activity arrives via the 'em:auto-updater:activity' IPC listener
  // wired in initialize() (mouse/keyboard/wheel/touch/focus debounced in preload).
  // This method covers main-process signals that don't go through the renderer:
  //   - browser-window-focus: user alt-tabbed back, clicked a window from elsewhere,
  //     or surfaced the app via tray click / dock click — any path that gives the
  //     window focus fires this. Tray/menu clicks that show/focus a window are also
  //     covered by this transitively.
  // Deep-link arrivals are a softer signal (the user might have clicked a link in a
  // browser hours ago and walked away) — we deliberately don't bump activity from
  // them. If a consumer wants to count something specific, they can call markActive().
  _wireActivityHooks() {
    if (autoUpdater._activityHooksWired) return;
    autoUpdater._activityHooksWired = true;

    try {
      const { app } = require('electron');
      app.on('browser-window-focus', () => autoUpdater.markActive());
    } catch (e) { /* electron not available */ }
  },

  _broadcastStatus() {
    const m = autoUpdater._manager;
    if (m && m.ipc && typeof m.ipc.broadcast === 'function') {
      m.ipc.broadcast('em:auto-updater:status', autoUpdater.getStatus());
    }
    autoUpdater._updateMenuItem();
    autoUpdater._updateTrayItem();
    logger.log(`status → ${autoUpdater._state.code}${autoUpdater._state.version ? ` v${autoUpdater._state.version}` : ''}${autoUpdater._state.percent ? ` (${autoUpdater._state.percent}%)` : ''}`);
  },

  // Compute the label + enabled fields for any "check for updates" UI item from current state.
  // Used by both the menu and tray patchers so they stay in lockstep.
  _menuItemFieldsForState() {
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
    return { label, enabled };
  },

  // Reflect updater state into the EM Check-for-Updates item. The item lives under
  // `main/check-for-updates` on macOS (App menu) and `help/check-for-updates` on win/linux —
  // we just patch whichever one exists. Consumer can remove either via
  // manager.menu.remove('main/check-for-updates') in their integrations/menu/index.js.
  _updateMenuItem() {
    const m = autoUpdater._manager;
    if (!m || !m.menu || typeof m.menu.update !== 'function') return;
    const { label, enabled } = autoUpdater._menuItemFieldsForState();

    // Patch whichever id-path exists. .update() returns false (and warns) if missing,
    // so try both without doubling up on warnings — silence by checking has() first.
    try {
      if (m.menu.has?.('main/check-for-updates')) {
        m.menu.update('main/check-for-updates', { label, enabled });
      } else if (m.menu.has?.('help/check-for-updates')) {
        m.menu.update('help/check-for-updates', { label, enabled });
      }
    } catch (e) { /* menu not built yet */ }
  },

  // Reflect updater state into the tray's `check-for-updates` item, if present. Same
  // label/enabled semantics as the menu item — keeps both UIs in lockstep.
  _updateTrayItem() {
    const m = autoUpdater._manager;
    if (!m || !m.tray || typeof m.tray.update !== 'function') return;
    const { label, enabled } = autoUpdater._menuItemFieldsForState();

    try {
      if (m.tray.has?.('check-for-updates')) {
        m.tray.update('check-for-updates', { label, enabled });
      }
    } catch (e) { /* tray not built yet */ }
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
