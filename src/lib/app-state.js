// App state — first-launch / launch-count / crash-sentinel / startup-context flags.
//
// Storage shape (under storage key `appState`):
//   {
//     installedAt:    1700000000000,    // first time the app booted (ms epoch)
//     launchCount:    42,
//     lastLaunchAt:   1700000000000,    // previous launch timestamp (set BEFORE this launch increments)
//     lastQuitAt:     1700000000000,    // last graceful quit; null/missing if previous launch crashed
//     version:        '1.2.3',          // version of THIS launch
//     previousVersion: '1.2.2',         // version before this launch, if it changed
//     sentinel:       true,             // set on launch, cleared on graceful quit; survival = crash
//   }
//
// Public API on `manager.appState`:
//   isFirstLaunch()        — true only for the very first boot of the app on this machine
//   getLaunchCount()       — total successful launches (including this one)
//   getInstalledAt()       — Date of first launch
//   getLastLaunchAt()      — Date of the previous launch, or null
//   getLastQuitAt()        — Date of the last graceful quit, or null if it crashed
//   recoveredFromCrash()   — true if the previous launch did not exit cleanly
//   getVersion()           — package.json version of this launch
//   getPreviousVersion()   — version before this launch (if it changed), else null
//   wasUpgraded()          — true if version differs from previousVersion
//   launchedAtLogin()      — true if OS launched the app via openAtLogin (mac/win)
//   launchedFromDeepLink() — set later by lib/deep-link if argv had a deep-link payload
//
// Side effects on initialize():
//   - increments launchCount
//   - migrates lastLaunchAt → previous launch timestamp
//   - records previousVersion if version changed
//   - writes the crash sentinel
//   - registers app-quit listeners that clear the sentinel + write lastQuitAt

const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('app-state');

const STORAGE_KEY = 'appState';

const appState = {
  _initialized:        false,
  _quitWired:          false,
  _manager:            null,
  _electron:           null,

  // Cached snapshot of the state AS LOADED at the start of this launch.
  // (Mutators write through to storage; readers can use either source.)
  _snapshot: null,

  // Specifically: the previous-run sentinel value, captured BEFORE we overwrite it.
  // True = previous launch never wrote `lastQuitAt` → it crashed.
  _recoveredFromCrash: false,

  // Set by lib/deep-link.initialize when argv contains a deep-link payload.
  _launchedFromDeepLink: false,

  async initialize(manager) {
    if (appState._initialized) {
      return;
    }

    appState._manager = manager;

    try {
      appState._electron = require('electron');
    } catch (e) {
      logger.warn(`electron not available — app-state running in no-op mode. (${e.message})`);
      appState._initialized = true;
      return;
    }

    const storage = manager?.storage;
    if (!storage?.get) {
      logger.warn('storage not available — app-state can only report ephemeral values.');
      appState._initialized = true;
      return;
    }

    const now = Date.now();
    const previous = storage.get(STORAGE_KEY) || {};
    const isFirstLaunch = !previous.installedAt;

    // Crash detection: previous launch wrote sentinel=true but never cleared it via lastQuitAt.
    // First launch has no previous sentinel, so it can't be "recovered from crash."
    const previousSentinel = !!previous.sentinel;
    const previousQuitAt   = previous.lastQuitAt || null;
    appState._recoveredFromCrash = !isFirstLaunch && previousSentinel && !previousQuitAt;

    // Version detection.
    const currentVersion  = manager?.config?.app?.version
                         || tryGetVersionFromPackage()
                         || null;
    const previousVersion = previous.version || null;
    const versionChanged  = currentVersion && previousVersion && currentVersion !== previousVersion;

    // Build the next snapshot.
    const next = {
      installedAt:     previous.installedAt || now,
      launchCount:     (previous.launchCount || 0) + 1,
      lastLaunchAt:    now,
      lastQuitAt:      null,                                          // cleared; will be set on quit
      version:         currentVersion,
      previousVersion: versionChanged ? previousVersion : (previous.previousVersion || null),
      sentinel:        true,                                          // crash-sentinel for THIS launch
    };

    storage.set(STORAGE_KEY, next);
    appState._snapshot = {
      ...next,
      _previousLaunchAt: previous.lastLaunchAt || null,                // exposed via getLastLaunchAt()
      _isFirstLaunch:    isFirstLaunch,
      _wasUpgraded:      Boolean(versionChanged),                      // true only if THIS launch differs from prior
    };

    // Wire graceful-quit cleanup. We listen to both `before-quit` and `will-quit`
    // so a quick `app.quit()` from the main process is captured even if the
    // window-close path didn't fire. Either firing clears the sentinel.
    appState._wireGracefulQuit();

    logger.log(`initialize — firstLaunch=${isFirstLaunch} count=${next.launchCount} version=${currentVersion || '(unknown)'} recoveredFromCrash=${appState._recoveredFromCrash}`);

    appState._initialized = true;
  },

  _wireGracefulQuit() {
    if (appState._quitWired) return;
    if (!appState._electron?.app) return;
    appState._quitWired = true;
    const { app } = appState._electron;

    let cleared = false;
    const onQuit = () => {
      if (cleared) return;
      cleared = true;
      try {
        const storage = appState._manager?.storage;
        if (!storage?.get || !storage?.set) return;
        const cur = storage.get(STORAGE_KEY) || {};
        cur.sentinel  = false;
        cur.lastQuitAt = Date.now();
        storage.set(STORAGE_KEY, cur);
      } catch (e) {
        logger.error('graceful-quit cleanup threw:', e);
      }
    };

    app.on('before-quit', onQuit);
    app.on('will-quit',   onQuit);
  },

  // Public API ─────────────────────────────────────────────────────────────────

  isFirstLaunch() {
    return Boolean(appState._snapshot?._isFirstLaunch);
  },

  getLaunchCount() {
    return appState._snapshot?.launchCount || 0;
  },

  getInstalledAt() {
    const ms = appState._snapshot?.installedAt;
    return ms ? new Date(ms) : null;
  },

  getLastLaunchAt() {
    const ms = appState._snapshot?._previousLaunchAt;
    return ms ? new Date(ms) : null;
  },

  getLastQuitAt() {
    // The CURRENT snapshot's lastQuitAt is null (we cleared it on init).
    // What the consumer wants is "when did we previously quit gracefully" — read storage live,
    // because at the moment of the call this launch hasn't quit yet.
    const cur = appState._manager?.storage?.get?.(STORAGE_KEY) || {};
    const ms  = cur.lastQuitAt;
    return ms ? new Date(ms) : null;
  },

  recoveredFromCrash() {
    return Boolean(appState._recoveredFromCrash);
  },

  getVersion() {
    return appState._snapshot?.version || null;
  },

  getPreviousVersion() {
    return appState._snapshot?.previousVersion || null;
  },

  wasUpgraded() {
    return Boolean(appState._snapshot?._wasUpgraded);
  },

  launchedAtLogin() {
    if (!appState._electron?.app?.getLoginItemSettings) return false;
    try {
      const s = appState._electron.app.getLoginItemSettings();
      // Electron exposes `wasOpenedAtLogin` on macOS (via NSWorkspace) and
      // `openAtLogin` plus a `launchItems` array on Windows. The shorthand:
      // if the OS booted us via the login-item path, the field is true.
      return Boolean(s.wasOpenedAtLogin);
    } catch (e) {
      return false;
    }
  },

  launchedFromDeepLink() {
    return appState._launchedFromDeepLink;
  },

  // Hook for lib/deep-link to call when it parses a cold-start deep link from argv.
  setLaunchedFromDeepLink(value) {
    appState._launchedFromDeepLink = Boolean(value);
  },

  // Test helper — wipe persisted state and reset the in-memory snapshot.
  // (Public, intentionally — used by integration tests + by consumers who want a "reset to factory" command.)
  reset() {
    if (appState._manager?.storage?.delete) {
      appState._manager.storage.delete(STORAGE_KEY);
    }
    appState._snapshot = null;
    appState._recoveredFromCrash = false;
    appState._launchedFromDeepLink = false;
  },
};

function tryGetVersionFromPackage() {
  try {
    const Manager = require('../build.js');
    const pkg = Manager.getPackage('project') || {};
    return pkg.version || null;
  } catch (e) {
    return null;
  }
}

module.exports = appState;
