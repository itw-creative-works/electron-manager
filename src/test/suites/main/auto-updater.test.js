// Main-process tests for lib/auto-updater.js — state machine, dev simulation,
// 30-day pending-update gate (first-download-wins).
//
// Each test resets the updater + clears storage so we get clean state.

const STORAGE_KEY = 'autoUpdater';

async function reinit(ctx, env) {
  const updater = ctx.manager.autoUpdater;
  updater.shutdown();
  ctx.manager.storage.set(STORAGE_KEY, null);

  // Snapshot + override env for this run.
  const saved = { EM_DEV_UPDATE: process.env.EM_DEV_UPDATE };
  for (const [k, v] of Object.entries(env || {})) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  await updater.initialize(ctx.manager);
  return async () => {
    updater.shutdown();
    for (const [k, v] of Object.entries(saved)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    // Re-init with the original env so subsequent tests have a working updater + IPC handlers.
    await updater.initialize(ctx.manager);
  };
}

function waitFor(predicate, { timeout = 3000, step = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (predicate()) return resolve();
      } catch (e) { /* keep polling */ }
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(tick, step);
    };
    tick();
  });
}

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'auto-updater (main)',
  cleanup: async (ctx) => {
    ctx.manager.autoUpdater.shutdown();
    ctx.manager.storage.set(STORAGE_KEY, null);
    delete process.env.EM_DEV_UPDATE;
    await ctx.manager.autoUpdater.initialize(ctx.manager);
  },
  tests: [
    {
      name: 'initialize ran during boot — initial status is idle',
      run: (ctx) => {
        const status = ctx.manager.autoUpdater.getStatus();
        ctx.expect(status.code).toBe('idle');
        ctx.expect(status.percent).toBe(0);
        ctx.expect(status.error).toBe(null);
      },
    },
    {
      name: 'dev simulation: available scenario walks state through downloaded',
      run: async (ctx) => {
        const restore = await reinit(ctx, { EM_DEV_UPDATE: 'available' });
        try {
          await ctx.manager.autoUpdater.checkNow({ userInitiated: true });
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'downloaded', { timeout: 5000 });

          const s = ctx.manager.autoUpdater.getStatus();
          ctx.expect(s.code).toBe('downloaded');
          ctx.expect(s.version).toBe('999.0.0');
          ctx.expect(s.percent).toBe(100);
          ctx.expect(typeof s.downloadedAt).toBe('number');
        } finally { await restore(); }
      },
    },
    {
      name: 'dev simulation: unavailable scenario lands in not-available',
      run: async (ctx) => {
        const restore = await reinit(ctx, { EM_DEV_UPDATE: 'unavailable' });
        try {
          await ctx.manager.autoUpdater.checkNow({ userInitiated: false });
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'not-available');

          const s = ctx.manager.autoUpdater.getStatus();
          ctx.expect(s.code).toBe('not-available');
          ctx.expect(s.error).toBe(null);
        } finally { await restore(); }
      },
    },
    {
      name: 'dev simulation: error scenario lands in error',
      run: async (ctx) => {
        const restore = await reinit(ctx, { EM_DEV_UPDATE: 'error' });
        try {
          await ctx.manager.autoUpdater.checkNow({ userInitiated: false });
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'error');

          const s = ctx.manager.autoUpdater.getStatus();
          ctx.expect(s.code).toBe('error');
          ctx.expect(s.error).toBeDefined();
          ctx.expect(s.error.message).toMatch(/Simulated/);
        } finally { await restore(); }
      },
    },
    {
      name: 'first download persists pendingUpdate to storage',
      run: async (ctx) => {
        const restore = await reinit(ctx, { EM_DEV_UPDATE: 'available' });
        try {
          await ctx.manager.autoUpdater.checkNow({ userInitiated: false });
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'downloaded', { timeout: 5000 });

          const stored = ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`);
          ctx.expect(stored).toBeDefined();
          ctx.expect(stored.version).toBe('999.0.0');
          ctx.expect(typeof stored.downloadedAt).toBe('number');
        } finally { await restore(); }
      },
    },
    {
      name: 'subsequent download does NOT reset downloadedAt — first download wins',
      run: async (ctx) => {
        const restore = await reinit(ctx, { EM_DEV_UPDATE: 'available' });
        try {
          // Plant an older pending-update record manually.
          const oldTs = Date.now() - (10 * 24 * 60 * 60 * 1000);  // 10 days ago
          ctx.manager.storage.set(`${STORAGE_KEY}.pendingUpdate`, { version: '888.0.0', downloadedAt: oldTs });

          // Call _recordDownloadedAt for a "new" download.
          ctx.manager.autoUpdater._recordDownloadedAt('999.0.0');

          const stored = ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`);
          ctx.expect(stored.version).toBe('888.0.0');           // unchanged
          ctx.expect(stored.downloadedAt).toBe(oldTs);          // unchanged
        } finally { await restore(); }
      },
    },
    {
      name: '30-day gate: pending update older than maxAgeMs forces installNow',
      run: async (ctx) => {
        const restore = await reinit(ctx, {});
        let installCalled = false;
        try {
          // Override installNow to capture the trigger without actually quitting.
          const origInstall = ctx.manager.autoUpdater.installNow;
          ctx.manager.autoUpdater.installNow = async () => { installCalled = true; return true; };

          // Plant an old pending-update.
          const oldTs = Date.now() - (31 * 24 * 60 * 60 * 1000);
          ctx.manager.autoUpdater._state.downloadedAt = oldTs;
          ctx.manager.autoUpdater._options.maxAgeMs = 30 * 24 * 60 * 60 * 1000;

          const triggered = ctx.manager.autoUpdater._enforceMaxAgeGate();
          ctx.expect(triggered).toBe(true);
          ctx.expect(installCalled).toBe(true);

          ctx.manager.autoUpdater.installNow = origInstall;
        } finally { await restore(); }
      },
    },
    {
      name: '30-day gate: fresh pending update does NOT force install',
      run: async (ctx) => {
        const restore = await reinit(ctx, {});
        try {
          ctx.manager.autoUpdater._state.downloadedAt = Date.now() - (5 * 24 * 60 * 60 * 1000);
          ctx.manager.autoUpdater._options.maxAgeMs = 30 * 24 * 60 * 60 * 1000;

          const triggered = ctx.manager.autoUpdater._enforceMaxAgeGate();
          ctx.expect(triggered).toBe(false);
        } finally { await restore(); }
      },
    },
    {
      name: 'pendingUpdate cleared when current version matches (update was applied)',
      run: async (ctx) => {
        const restore = await reinit(ctx, {});
        try {
          // Stash a pending-update entry whose version matches our current package version.
          const currentVersion = ctx.manager.autoUpdater._getCurrentVersion();
          ctx.expect(typeof currentVersion).toBe('string');

          ctx.manager.storage.set(`${STORAGE_KEY}.pendingUpdate`, {
            version: currentVersion,
            downloadedAt: Date.now() - (5 * 24 * 60 * 60 * 1000),
          });

          // Re-init triggers the reconciler.
          ctx.manager.autoUpdater.shutdown();
          await ctx.manager.autoUpdater.initialize(ctx.manager);

          const stillThere = ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`);
          ctx.expect(stillThere).toBe(null);
        } finally { await restore(); }
      },
    },
    {
      name: 'checkNow returns current status object',
      run: async (ctx) => {
        const restore = await reinit(ctx, { EM_DEV_UPDATE: 'unavailable' });
        try {
          const result = await ctx.manager.autoUpdater.checkNow();
          ctx.expect(typeof result.code).toBe('string');
          ctx.expect('percent' in result).toBe(true);
        } finally { await restore(); }
      },
    },
    {
      name: 'IPC handler registered: em:auto-updater:status returns status',
      run: async (ctx) => {
        const result = await ctx.manager.ipc.invoke('em:auto-updater:status');
        ctx.expect(typeof result.code).toBe('string');
      },
    },
    {
      name: 'enabled=false: skip wiring, no library, no interval',
      run: async (ctx) => {
        ctx.manager.autoUpdater.shutdown();
        const cfg = ctx.manager.config;
        const orig = cfg.autoUpdate;
        cfg.autoUpdate = { enabled: false };
        try {
          await ctx.manager.autoUpdater.initialize(ctx.manager);
          ctx.expect(ctx.manager.autoUpdater._intervalId).toBe(null);
          ctx.expect(ctx.manager.autoUpdater._library).toBe(null);
        } finally {
          cfg.autoUpdate = orig;
          ctx.manager.autoUpdater.shutdown();
          await ctx.manager.autoUpdater.initialize(ctx.manager);
        }
      },
    },
  ],
};
