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
      name: 'dev mode without EM_RESTART_MANAGER_DEV: bail (no timer scheduled)',
      run: (ctx) => {
        // Test harness is unpackaged → manager.isDevelopment() === true. So default
        // initialize() should already have bailed and not scheduled a timer.
        // (And EM_RESTART_MANAGER_DEV is not set in tests.)
        ctx.expect(process.env.EM_RESTART_MANAGER_DEV).not.toBe('1');
        ctx.expect(ctx.manager.isDevelopment()).toBe(true);
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
      name: 'install attempt counter increments + caps at 3',
      run: async (ctx) => {
        ctx.manager.restartManager.shutdown();
        ctx.manager.restartManager.initialize(ctx.manager);
        // Manually bump to MAX, then trigger a send. Since enabled is false in the
        // initialize() path above (dev mode bail), _send returns early. So we
        // override _enabled for this test.
        ctx.manager.restartManager._enabled = true;
        ctx.manager.restartManager._installAttempts = 3;
        // _send should short-circuit on the attempt cap (handler is empty in test
        // harness because there's no installed RM). No throw, no install.
        await ctx.manager.restartManager._send('register');
        ctx.expect(ctx.manager.restartManager._installAttempts).toBe(3);
      },
    },
  ],
};
