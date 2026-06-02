// Main-layer tests for lib/restart-manager.js — wiring, bail conditions, URL
// shape, ensureInstalled stub. Doesn't actually download or shell-execute
// anything (those are network/UI side-effects).

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'restart-manager (main)',
  cleanup: (ctx) => {
    ctx.manager.restartManager.shutdown();
    ctx.manager.restartManager.initialize(ctx.manager);
  },
  tests: [
    {
      name: 'restartManager module wired on manager',
      run: (ctx) => {
        ctx.expect(ctx.manager.restartManager).toBeDefined();
        ctx.expect(typeof ctx.manager.restartManager.register).toBe('function');
        ctx.expect(typeof ctx.manager.restartManager.unregister).toBe('function');
        ctx.expect(typeof ctx.manager.restartManager.ensureInstalled).toBe('function');
      },
    },
    {
      name: 'enabled=false: bail (no register timer scheduled)',
      run: (ctx) => {
        ctx.manager.restartManager.shutdown();
        const orig = ctx.manager.config.restartManager;
        ctx.manager.config.restartManager = { enabled: false };
        try {
          ctx.manager.restartManager.initialize(ctx.manager);
          ctx.expect(ctx.manager.restartManager._enabled).toBe(false);
          ctx.expect(ctx.manager.restartManager._registerTimer).toBe(null);
        } finally {
          ctx.manager.restartManager.shutdown();
          ctx.manager.config.restartManager = orig;
          ctx.manager.restartManager.initialize(ctx.manager);
        }
      },
    },
    {
      name: 'brand.id === "restart-manager": bail (RM does not manage itself)',
      run: (ctx) => {
        ctx.manager.restartManager.shutdown();
        const origBrand = ctx.manager.config.brand;
        ctx.manager.config.brand = { ...origBrand, id: 'restart-manager' };
        try {
          ctx.manager.restartManager.initialize(ctx.manager);
          // _enabled doesn't get flipped for this bail (the flag is purely the
          // config knob); the proof is that no timer was scheduled.
          ctx.expect(ctx.manager.restartManager._registerTimer).toBe(null);
        } finally {
          ctx.manager.restartManager.shutdown();
          ctx.manager.config.brand = origBrand;
          ctx.manager.restartManager.initialize(ctx.manager);
        }
      },
    },
    {
      name: 'non-production without EM_RESTART_MANAGER_DEV: bail (no timer scheduled)',
      run: (ctx) => {
        // The harness runs under EM_TEST_MODE → getEnvironment() === 'testing', so
        // isProduction() === false. restart-manager bails outside production (gate:
        // `!manager.isProduction() && !devOptIn`), so initialize() should NOT have
        // scheduled a timer. (EM_RESTART_MANAGER_DEV is not set in tests.)
        ctx.expect(process.env.EM_RESTART_MANAGER_DEV).not.toBe('1');
        ctx.expect(ctx.manager.isProduction()).toBe(false);
        ctx.expect(ctx.manager.restartManager._registerTimer).toBe(null);
      },
    },
    {
      name: '_buildUrl produces valid restart-manager:// URL with payload',
      run: (ctx) => {
        const url = ctx.manager.restartManager._buildUrl('register');
        ctx.expect(typeof url).toBe('string');
        ctx.expect(url.startsWith('restart-manager://message')).toBe(true);
        ctx.expect(url).toContain('command=register');
        ctx.expect(url).toContain('payload=');
      },
    },
    {
      name: '_buildUrl payload carries brand.id + name + environment',
      run: (ctx) => {
        const url = ctx.manager.restartManager._buildUrl('unregister');
        const u = new URL(url);
        const cmd = u.searchParams.get('command');
        const payload = JSON.parse(u.searchParams.get('payload'));
        ctx.expect(cmd).toBe('unregister');
        ctx.expect(typeof payload).toBe('object');
        ctx.expect(typeof payload.id).toBe('string');
        ctx.expect(typeof payload.name).toBe('string');
        ctx.expect(typeof payload.environment).toBe('string');
      },
    },
    {
      name: '_urls has mac/windows/linux entries pointing at the public download server',
      run: (ctx) => {
        const u = ctx.manager.restartManager._urls;
        ctx.expect(typeof u.mac).toBe('string');
        ctx.expect(typeof u.windows).toBe('string');
        ctx.expect(typeof u.linux).toBe('string');
        ctx.expect(u.mac).toContain('restart-manager/download-server');
        ctx.expect(u.mac.endsWith('Restart-Manager-mac.zip')).toBe(true);
        ctx.expect(u.windows.endsWith('Restart-Manager-Setup.exe')).toBe(true);
        ctx.expect(u.linux.endsWith('restart-manager_amd64.deb')).toBe(true);
      },
    },
    {
      name: 'test mode: _send is a no-op even when _enabled=true (test guard wins)',
      run: async (ctx) => {
        // The whole point of the test-mode bail: even if someone monkey-patches
        // _enabled, _send still refuses to do anything. No protocol probe, no
        // shell.openExternal, no install, no counter bump. Tests must never
        // touch real OS state.
        ctx.manager.restartManager.shutdown();
        ctx.manager.restartManager.initialize(ctx.manager);
        ctx.manager.restartManager._enabled = true;
        ctx.manager.restartManager._installAttempts = 0;
        await ctx.manager.restartManager._send('register');
        ctx.expect(ctx.manager.restartManager._installAttempts).toBe(0);   // never bumped
      },
    },
    {
      name: 'test mode: ensureInstalled is a no-op',
      run: async (ctx) => {
        // ensureInstalled() is the public force-install hook. In test mode it
        // must short-circuit before touching the network or filesystem.
        const result = await ctx.manager.restartManager.ensureInstalled();
        ctx.expect(result).toBe(undefined);
      },
    },
  ],
};
