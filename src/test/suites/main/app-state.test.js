// Main-process tests for lib/app-state.js — storage-backed launch flags + crash sentinel.
//
// The harness already booted Manager once, which incremented launchCount and seeded
// state. We test by calling appState.reset() then re-initializing with crafted
// storage state to simulate first-launch / repeat-launch / crash-recovery / upgrade.

const STORAGE_KEY = 'appState';

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'app-state (main)',
  cleanup: async (ctx) => {
    // Restore a sane state for any later suites that look at appState.
    ctx.manager.appState.reset();
    // Mark _initialized=false so we can re-init cleanly.
    ctx.manager.appState._initialized = false;
    await ctx.manager.appState.initialize(ctx.manager);
  },
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.appState._initialized).toBe(true);
      },
    },
    {
      name: 'first launch: flags + counters seeded correctly',
      run: async (ctx) => {
        ctx.manager.appState.reset();
        ctx.manager.appState._initialized = false;
        await ctx.manager.appState.initialize(ctx.manager);

        ctx.expect(ctx.manager.appState.isFirstLaunch()).toBe(true);
        ctx.expect(ctx.manager.appState.getLaunchCount()).toBe(1);
        ctx.expect(ctx.manager.appState.getInstalledAt()).toBeInstanceOf(Date);
        ctx.expect(ctx.manager.appState.getLastLaunchAt()).toBeNull();
        ctx.expect(ctx.manager.appState.recoveredFromCrash()).toBe(false);
      },
    },
    {
      name: 'second launch: not first, count incremented, lastLaunchAt populated',
      run: async (ctx) => {
        ctx.manager.appState.reset();
        ctx.manager.appState._initialized = false;
        await ctx.manager.appState.initialize(ctx.manager);

        // Simulate a graceful quit from the first launch.
        const after1 = ctx.manager.storage.get(STORAGE_KEY);
        after1.sentinel  = false;
        after1.lastQuitAt = Date.now();
        ctx.manager.storage.set(STORAGE_KEY, after1);

        // Boot again.
        ctx.manager.appState._initialized = false;
        await ctx.manager.appState.initialize(ctx.manager);

        ctx.expect(ctx.manager.appState.isFirstLaunch()).toBe(false);
        ctx.expect(ctx.manager.appState.getLaunchCount()).toBe(2);
        ctx.expect(ctx.manager.appState.getLastLaunchAt()).toBeInstanceOf(Date);
        ctx.expect(ctx.manager.appState.recoveredFromCrash()).toBe(false);
      },
    },
    {
      name: 'crash detection: previous launch left sentinel and no quit timestamp',
      run: async (ctx) => {
        // Seed storage with a "we were running and never gracefully quit" state.
        ctx.manager.storage.set(STORAGE_KEY, {
          installedAt:  Date.now() - 10000,
          launchCount:  3,
          lastLaunchAt: Date.now() - 1000,
          lastQuitAt:   null,                 // never quit gracefully
          sentinel:     true,                 // was running
          version:      '1.0.0',
        });

        ctx.manager.appState._initialized = false;
        await ctx.manager.appState.initialize(ctx.manager);

        ctx.expect(ctx.manager.appState.recoveredFromCrash()).toBe(true);
        ctx.expect(ctx.manager.appState.getLaunchCount()).toBe(4);
      },
    },
    {
      name: 'graceful quit: sentinel cleared on next boot, no crash flag',
      run: async (ctx) => {
        ctx.manager.storage.set(STORAGE_KEY, {
          installedAt:  Date.now() - 10000,
          launchCount:  5,
          lastLaunchAt: Date.now() - 1000,
          lastQuitAt:   Date.now() - 500,    // graceful quit happened
          sentinel:     false,
          version:      '1.0.0',
        });

        ctx.manager.appState._initialized = false;
        await ctx.manager.appState.initialize(ctx.manager);

        ctx.expect(ctx.manager.appState.recoveredFromCrash()).toBe(false);
        ctx.expect(ctx.manager.appState.getLaunchCount()).toBe(6);
      },
    },
    {
      name: 'version upgrade: previousVersion populated when version changes',
      run: async (ctx) => {
        ctx.manager.storage.set(STORAGE_KEY, {
          installedAt:  Date.now() - 10000,
          launchCount:  10,
          lastLaunchAt: Date.now() - 1000,
          lastQuitAt:   Date.now() - 500,
          sentinel:     false,
          version:      '0.9.0',     // previous version
        });

        // Force the manager's reported version to differ.
        const origConfig = ctx.manager.config.app;
        ctx.manager.config.app = { ...origConfig, version: '1.0.0' };

        try {
          ctx.manager.appState._initialized = false;
          await ctx.manager.appState.initialize(ctx.manager);

          ctx.expect(ctx.manager.appState.getVersion()).toBe('1.0.0');
          ctx.expect(ctx.manager.appState.getPreviousVersion()).toBe('0.9.0');
          ctx.expect(ctx.manager.appState.wasUpgraded()).toBe(true);
        } finally {
          ctx.manager.config.app = origConfig;
        }
      },
    },
    {
      name: 'no version change: wasUpgraded false, previousVersion preserved',
      run: async (ctx) => {
        // Seed with a previousVersion that should NOT be overwritten when version doesn't change.
        ctx.manager.storage.set(STORAGE_KEY, {
          installedAt:     Date.now() - 10000,
          launchCount:     20,
          lastLaunchAt:    Date.now() - 1000,
          lastQuitAt:      Date.now() - 500,
          sentinel:        false,
          version:         '1.0.0',
          previousVersion: '0.9.0',
        });

        const origConfig = ctx.manager.config.app;
        ctx.manager.config.app = { ...origConfig, version: '1.0.0' };

        try {
          ctx.manager.appState._initialized = false;
          await ctx.manager.appState.initialize(ctx.manager);

          ctx.expect(ctx.manager.appState.wasUpgraded()).toBe(false);
          // Should preserve the historical previousVersion rather than nuking it.
          ctx.expect(ctx.manager.appState.getPreviousVersion()).toBe('0.9.0');
        } finally {
          ctx.manager.config.app = origConfig;
        }
      },
    },
    {
      name: 'launchedFromDeepLink: defaults false, set/cleared via setter',
      run: (ctx) => {
        ctx.expect(ctx.manager.appState.launchedFromDeepLink()).toBe(false);
        ctx.manager.appState.setLaunchedFromDeepLink(true);
        ctx.expect(ctx.manager.appState.launchedFromDeepLink()).toBe(true);
        ctx.manager.appState.setLaunchedFromDeepLink(false);
        ctx.expect(ctx.manager.appState.launchedFromDeepLink()).toBe(false);
      },
    },
    {
      name: 'launchedAtLogin returns a boolean',
      run: (ctx) => {
        ctx.expect(typeof ctx.manager.appState.launchedAtLogin()).toBe('boolean');
      },
    },
    {
      name: 'getLastQuitAt reads live storage (returns null when sentinel is active)',
      run: async (ctx) => {
        ctx.manager.appState.reset();
        ctx.manager.appState._initialized = false;
        await ctx.manager.appState.initialize(ctx.manager);
        // After init, sentinel=true and lastQuitAt=null.
        ctx.expect(ctx.manager.appState.getLastQuitAt()).toBeNull();
      },
    },
    {
      name: 'reset() wipes persisted state',
      run: (ctx) => {
        ctx.expect(ctx.manager.storage.has(STORAGE_KEY)).toBe(true);
        ctx.manager.appState.reset();
        ctx.expect(ctx.manager.storage.has(STORAGE_KEY)).toBe(false);
      },
    },
  ],
};
