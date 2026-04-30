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
        for (const mode of ['normal', 'hidden', 'tray-only']) {
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
      name: 'isLaunchHidden true for hidden + tray-only, false for normal',
      run: (ctx) => {
        ctx.manager.config.startup.mode = 'normal';
        ctx.expect(ctx.manager.startup.isLaunchHidden()).toBe(false);
        ctx.manager.config.startup.mode = 'hidden';
        ctx.expect(ctx.manager.startup.isLaunchHidden()).toBe(true);
        ctx.manager.config.startup.mode = 'tray-only';
        ctx.expect(ctx.manager.startup.isLaunchHidden()).toBe(true);
      },
    },
    {
      name: 'isTrayOnly only true for tray-only mode',
      run: (ctx) => {
        ctx.manager.config.startup.mode = 'normal';
        ctx.expect(ctx.manager.startup.isTrayOnly()).toBe(false);
        ctx.manager.config.startup.mode = 'hidden';
        ctx.expect(ctx.manager.startup.isTrayOnly()).toBe(false);
        ctx.manager.config.startup.mode = 'tray-only';
        ctx.expect(ctx.manager.startup.isTrayOnly()).toBe(true);
      },
    },
    {
      name: 'applyEarly is a no-op outside hidden/tray-only',
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
  ],
};
