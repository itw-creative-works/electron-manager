// Verifies every lib was initialized during the main-process boot sequence.

module.exports = {
  type: 'group',
  layer: 'main',
  description: 'boot sequence (main)',
  tests: [
    {
      name: 'config was loaded',
      run: (ctx) => {
        ctx.expect(ctx.manager.config).toBeTruthy();
        ctx.expect(ctx.manager.config.brand.id).toBeTruthy();
      },
    },
    {
      name: 'storage initialized',
      run: (ctx) => ctx.expect(ctx.manager.storage._initialized).toBe(true),
    },
    {
      name: 'sentry initialized',
      run: (ctx) => ctx.expect(ctx.manager.sentry._initialized).toBe(true),
    },
    {
      name: 'protocol initialized',
      run: (ctx) => ctx.expect(ctx.manager.protocol._initialized).toBe(true),
    },
    {
      name: 'deep-link initialized',
      run: (ctx) => ctx.expect(ctx.manager.deepLink._initialized).toBe(true),
    },
    {
      name: 'app-state initialized',
      run: (ctx) => ctx.expect(ctx.manager.appState._initialized).toBe(true),
    },
    {
      name: 'ipc initialized',
      run: (ctx) => ctx.expect(ctx.manager.ipc._initialized).toBe(true),
    },
    {
      name: 'auto-updater initialized',
      run: (ctx) => ctx.expect(ctx.manager.autoUpdater._initialized).toBe(true),
    },
    {
      name: 'tray initialized',
      run: (ctx) => ctx.expect(ctx.manager.tray._initialized).toBe(true),
    },
    {
      name: 'menu initialized',
      run: (ctx) => ctx.expect(ctx.manager.menu._initialized).toBe(true),
    },
    {
      name: 'context-menu initialized',
      run: (ctx) => ctx.expect(ctx.manager.contextMenu._initialized).toBe(true),
    },
    {
      name: 'startup initialized',
      run: (ctx) => ctx.expect(ctx.manager.startup._initialized).toBe(true),
    },
    {
      name: 'web-manager-bridge initialized',
      run: (ctx) => ctx.expect(ctx.manager.webManager._initialized).toBe(true),
    },
    {
      name: 'window-manager initialized',
      run: (ctx) => ctx.expect(ctx.manager.windows._initialized).toBe(true),
    },
    {
      name: 'getEnvironment returns testing under the test harness',
      run: (ctx) => {
        // The harness spawn sets EM_TEST_MODE=true → testing wins over everything.
        ctx.expect(ctx.manager.getEnvironment()).toBe('testing');
      },
    },
  ],
};
