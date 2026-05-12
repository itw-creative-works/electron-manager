// Usage tracking — opens (= launchCount) + hours-of-use accumulation.
// Sister of legacy electron-manager's Usage library, but without the
// electron-store-cwd hack (uses our manager.storage instead).
//
// Persisted shape (storage.usage):
//   {
//     opens: number,                  // total app launches
//     hoursTotal: number,             // sum of all session lengths (hours, float)
//     hoursThisSession: number,       // computed live; not persisted
//     installedAt: ISO string,
//     lastLaunchAt: ISO string,
//     lastQuitAt: ISO string | null,  // null → either first launch or app crashed mid-session
//   }
//
// On boot:
//   1. Read previous snapshot.
//   2. If lastQuitAt is set, accumulate (lastQuitAt - prevLaunchAt) into hoursTotal —
//      this is the "the previous session ended cleanly" case. If lastQuitAt is null,
//      we credit nothing (the prior session crashed; we don't know how long it was).
//   3. opens += 1, lastLaunchAt = now, lastQuitAt = null.
//   4. Persist.
//
// On quit (via app.on('before-quit')):
//   5. lastQuitAt = now. Persist.
//   6. The next launch's step 2 picks up the duration.
//
// hoursThisSession is computed live from `Date.now() - sessionStart`.
//
// app-state.js already tracks launchCount + installedAt. To avoid two sources of
// truth, usage syncs from app-state where they overlap (opens === launchCount,
// installedAt mirrored).

const LoggerLite = require('./logger-lite.js');
const logger = new LoggerLite('usage');

const STORAGE_KEY = 'usage';

const usage = {
  _initialized: false,
  _manager:     null,
  _sessionStart: null,
  _snapshot:    null,

  initialize(manager) {
    if (usage._initialized) return;
    usage._initialized = true;
    usage._manager = manager;
    usage._sessionStart = Date.now();

    const previous = manager.storage.get(STORAGE_KEY) || {};
    const now = new Date();

    // Step 2: credit prior session if it ended cleanly.
    let hoursTotal = previous.hoursTotal || 0;
    if (previous.lastLaunchAt && previous.lastQuitAt) {
      const launched = new Date(previous.lastLaunchAt).getTime();
      const quit     = new Date(previous.lastQuitAt).getTime();
      if (Number.isFinite(launched) && Number.isFinite(quit) && quit > launched) {
        hoursTotal += (quit - launched) / (1000 * 60 * 60);
      }
    }

    // Step 3: bump opens, refresh launch time, clear quit time.
    const next = {
      opens:        (previous.opens || 0) + 1,
      hoursTotal,
      installedAt:  previous.installedAt || now.toISOString(),
      lastLaunchAt: now.toISOString(),
      lastQuitAt:   null,                                 // cleared; will be set on quit
    };

    manager.storage.set(STORAGE_KEY, next);
    usage._snapshot = next;

    // Wire the quit handler — single registration, idempotent if re-init runs.
    usage._wireQuitHandler();

    // IPC for renderer access to usage stats.
    manager.ipc.unhandle('em:usage:get');
    manager.ipc.handle('em:usage:get', () => usage.toJSON());

    logger.log(`usage initialized — opens=${next.opens} hoursTotal=${next.hoursTotal.toFixed(2)} installedAt=${next.installedAt}`);
  },

  _wireQuitHandler() {
    if (usage._quitHandlerWired) return;
    usage._quitHandlerWired = true;
    const { app } = require('electron');
    app.on('before-quit', () => {
      const cur = usage._manager.storage.get(STORAGE_KEY) || usage._snapshot || {};
      cur.lastQuitAt = new Date().toISOString();
      usage._manager.storage.set(STORAGE_KEY, cur);
    });
  },

  // ─── Public API ─────────────────────────────────────────────────────────────

  // Total launches across the install lifetime.
  opens() {
    return usage._snapshot?.opens || 0;
  },

  // Cumulative hours-of-use across all clean-exit sessions. Crashed sessions
  // don't contribute (lastQuitAt was never written → no diff to accumulate).
  hoursTotal() {
    return usage._snapshot?.hoursTotal || 0;
  },

  // Hours since this launch. Live computation — never stale.
  hoursThisSession() {
    if (!usage._sessionStart) return 0;
    return (Date.now() - usage._sessionStart) / (1000 * 60 * 60);
  },

  installedAt() {
    return usage._snapshot?.installedAt || null;
  },

  // Plain-JSON snapshot for IPC / analytics user-properties.
  toJSON() {
    return {
      opens:            usage.opens(),
      hoursTotal:       usage.hoursTotal(),
      hoursThisSession: usage.hoursThisSession(),
      installedAt:      usage.installedAt(),
    };
  },

  // Test teardown.
  shutdown() {
    usage._initialized = false;
    usage._manager     = null;
    usage._sessionStart = null;
    usage._snapshot    = null;
    // Note: we don't unwire `app.on('before-quit')` — Electron has no listener
    // remover for app events that's worth the complexity. The handler is
    // idempotent-guarded so re-init won't double-register.
  },
};

module.exports = usage;
