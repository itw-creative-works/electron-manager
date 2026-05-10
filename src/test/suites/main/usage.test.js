// Main-layer tests for lib/usage.js — opens, hours-total accumulation, hours-this-session live.

const STORAGE_KEY = 'usage';

async function reinitWithSnapshot(ctx, snapshot) {
  // Reset and re-init with a planted previous snapshot.
  ctx.manager.usage.shutdown();
  ctx.manager.storage.set(STORAGE_KEY, snapshot);
  ctx.manager.usage.initialize(ctx.manager);
}

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'usage (main)',
  cleanup: (ctx) => {
    ctx.manager.usage.shutdown();
    ctx.manager.storage.set(STORAGE_KEY, null);
    ctx.manager.usage.initialize(ctx.manager);
  },
  tests: [
    {
      name: 'usage module wired on manager + initialized during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.usage).toBeDefined();
        ctx.expect(ctx.manager.usage._initialized).toBe(true);
      },
    },
    {
      name: 'opens() returns at least 1 (this launch)',
      run: (ctx) => {
        ctx.expect(ctx.manager.usage.opens() >= 1).toBe(true);
      },
    },
    {
      name: 'hoursThisSession() is a small positive number',
      run: (ctx) => {
        const h = ctx.manager.usage.hoursThisSession();
        ctx.expect(typeof h).toBe('number');
        ctx.expect(h >= 0).toBe(true);
        ctx.expect(h < 1).toBe(true);   // tests run in seconds, not hours
      },
    },
    {
      name: 'opens() bumps on each re-init',
      run: async (ctx) => {
        // Plant a known starting state so this test isn't sensitive to whatever
        // accumulated in the prior test's storage.
        ctx.manager.usage.shutdown();
        ctx.manager.storage.set('usage', { opens: 5, hoursTotal: 0, installedAt: '2024-01-01T00:00:00Z', lastLaunchAt: null, lastQuitAt: null });
        ctx.manager.usage.initialize(ctx.manager);
        const before = ctx.manager.usage.opens();
        ctx.expect(before).toBe(6);   // 5 + this re-init
        ctx.manager.usage.shutdown();
        ctx.manager.usage.initialize(ctx.manager);
        const after = ctx.manager.usage.opens();
        ctx.expect(after).toBe(before + 1);   // 7
      },
    },
    {
      name: 'hoursTotal accumulates from a clean prior session (lastQuitAt set)',
      run: async (ctx) => {
        // Plant a 2-hour completed session.
        const launched = new Date(Date.now() - 3 * 60 * 60 * 1000);   // 3h ago
        const quit     = new Date(Date.now() - 1 * 60 * 60 * 1000);   // 1h ago = 2h session
        await reinitWithSnapshot(ctx, {
          opens:        5,
          hoursTotal:   10,
          lastLaunchAt: launched.toISOString(),
          lastQuitAt:   quit.toISOString(),
          installedAt:  '2024-01-01T00:00:00.000Z',
        });
        // After re-init we should have hoursTotal = 10 + 2 = 12 (within rounding).
        const ht = ctx.manager.usage.hoursTotal();
        ctx.expect(ht > 11.9).toBe(true);
        ctx.expect(ht < 12.1).toBe(true);
        ctx.expect(ctx.manager.usage.opens()).toBe(6);
      },
    },
    {
      name: 'hoursTotal does NOT accumulate when prior session crashed (lastQuitAt null)',
      run: async (ctx) => {
        await reinitWithSnapshot(ctx, {
          opens:        3,
          hoursTotal:   5,
          lastLaunchAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),  // 1h ago
          lastQuitAt:   null,                                                  // crashed
          installedAt:  '2024-01-01T00:00:00.000Z',
        });
        // Should still be 5 — crashed sessions don't credit hours.
        ctx.expect(ctx.manager.usage.hoursTotal()).toBe(5);
      },
    },
    {
      name: 'installedAt persists across re-inits',
      run: async (ctx) => {
        await reinitWithSnapshot(ctx, {
          opens:        2,
          hoursTotal:   1,
          installedAt:  '2023-06-15T10:00:00.000Z',
          lastLaunchAt: new Date().toISOString(),
          lastQuitAt:   null,
        });
        ctx.expect(ctx.manager.usage.installedAt()).toBe('2023-06-15T10:00:00.000Z');
      },
    },
    {
      name: 'toJSON includes opens, hoursTotal, hoursThisSession, installedAt',
      run: (ctx) => {
        const j = ctx.manager.usage.toJSON();
        ctx.expect(typeof j.opens).toBe('number');
        ctx.expect(typeof j.hoursTotal).toBe('number');
        ctx.expect(typeof j.hoursThisSession).toBe('number');
        ctx.expect('installedAt' in j).toBe(true);
      },
    },
    {
      name: 'IPC handler em:usage:get returns the snapshot',
      run: async (ctx) => {
        const snap = await ctx.manager.ipc.invoke('em:usage:get');
        ctx.expect(snap.opens).toBe(ctx.manager.usage.opens());
      },
    },
  ],
};
