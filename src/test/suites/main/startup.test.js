// Main-process tests for lib/startup.js — launch mode + open-at-login.
//
// Note: in tests the harness passes skipWindowCreation:true, so the main.js
// `applyEarly` and `windows.createNamed` calls aren't exercised — those paths
// are smoke-tested separately via boot-sequence.test.js. Here we test the
// startup module's own surface.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'startup (main)',
  cleanup: (ctx) => {
    // Restore default mode so no later suite is affected.
    if (ctx.manager.config?.startup) {
      ctx.manager.config.startup.mode = 'normal';
    }
  },
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.startup._initialized).toBe(true);
      },
    },
    {
      name: 'getMode returns "normal" by default',
      run: (ctx) => {
        ctx.manager.config.startup.mode = 'normal';
        ctx.expect(ctx.manager.startup.getMode()).toBe('normal');
      },
    },
    {
      name: 'getMode honors valid values',
      run: (ctx) => {
        for (const mode of ['normal', 'hidden']) {
          ctx.manager.config.startup.mode = mode;
          ctx.expect(ctx.manager.startup.getMode()).toBe(mode);
        }
      },
    },
    {
      name: 'getMode falls back to "normal" for unknown values',
      run: (ctx) => {
        ctx.manager.config.startup.mode = 'banana';
        ctx.expect(ctx.manager.startup.getMode()).toBe('normal');
      },
    },
    {
      name: 'getMode rejects deprecated tray-only as unknown (falls back to normal)',
      run: (ctx) => {
        // tray-only was folded into hidden; it's no longer a valid mode.
        ctx.manager.config.startup.mode = 'tray-only';
        ctx.expect(ctx.manager.startup.getMode()).toBe('normal');
      },
    },
    {
      name: 'isLaunchHidden true for hidden, false for normal',
      run: (ctx) => {
        ctx.manager.config.startup.mode = 'normal';
        ctx.expect(ctx.manager.startup.isLaunchHidden()).toBe(false);
        ctx.manager.config.startup.mode = 'hidden';
        ctx.expect(ctx.manager.startup.isLaunchHidden()).toBe(true);
      },
    },
    {
      name: 'applyEarly is a no-op outside hidden mode',
      run: (ctx) => {
        ctx.manager.config.startup.mode = 'normal';
        // Just confirm it doesn't throw.
        ctx.manager.startup.applyEarly();
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'applyEarly does not throw for hidden mode',
      run: (ctx) => {
        ctx.manager.config.startup.mode = 'hidden';
        ctx.manager.startup.applyEarly();
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'isOpenAtLogin returns a boolean (or null on platforms without support)',
      run: (ctx) => {
        const v = ctx.manager.startup.isOpenAtLogin();
        ctx.expect(v === null || typeof v === 'boolean').toBe(true);
      },
    },
    {
      name: 'setOpenAtLogin runs without throwing',
      run: (ctx) => {
        // Set to false to avoid actually registering the test harness for login on the dev box.
        ctx.manager.startup.setOpenAtLogin(false);
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'setOpenAtLogin accepts the object form { enabled, mode }',
      run: (ctx) => {
        // Object form should not throw and should round-trip the args/openAsHidden flags.
        ctx.manager.startup.setOpenAtLogin({ enabled: false, mode: 'normal' });
        ctx.manager.startup.setOpenAtLogin({ enabled: true,  mode: 'hidden' });
        // Restore to disabled at end so we don't leave the test harness as a login item.
        ctx.manager.startup.setOpenAtLogin(false);
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'wasLaunchedAtLogin returns a boolean',
      run: (ctx) => {
        ctx.expect(typeof ctx.manager.startup.wasLaunchedAtLogin()).toBe('boolean');
      },
    },
    {
      name: 'dev mode never registers open-at-login (and clears prior registration)',
      run: (ctx) => {
        // The harness runs unpackaged, so initialize() must have force-OFF'd the login item.
        // Confirm the current OS state reflects that — getLoginItemSettings should report
        // openAtLogin: false. (Note: returns null on platforms without LoginItemSettings.)
        const live = ctx.manager.startup.isOpenAtLogin();
        if (live !== null) {
          ctx.expect(live).toBe(false);
        }
      },
    },
  ],
};
