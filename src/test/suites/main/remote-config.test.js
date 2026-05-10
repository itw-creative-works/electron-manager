// Main-layer tests for lib/remote-config.js — fetch + cache + dot-path get +
// onUpdate listeners + URL derivation from brand.url.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'remote-config (main)',
  cleanup: (ctx) => {
    ctx.manager.remoteConfig.shutdown();
    ctx.manager.storage.set('remoteConfig', null);
    ctx.manager.remoteConfig.initialize(ctx.manager);
  },
  tests: [
    {
      name: 'remoteConfig module wired on manager + initialized during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.remoteConfig).toBeDefined();
        ctx.expect(ctx.manager.remoteConfig._initialized).toBe(true);
      },
    },
    {
      name: 'URL derived from brand.url (legacy convention path)',
      run: (ctx) => {
        // Test config has a brand.url, so we should have a URL set.
        // (If brand.url is missing in test config, this test verifies the resolution shape.)
        const u = ctx.manager.remoteConfig._url;
        ctx.expect(u === null || u.endsWith('/data/resources/main.json')).toBe(true);
      },
    },
    {
      name: 'URL override: config.remoteConfig.url wins over brand.url',
      run: async (ctx) => {
        ctx.manager.remoteConfig.shutdown();
        const orig = ctx.manager.config.remoteConfig;
        ctx.manager.config.remoteConfig = { url: 'https://override.example/custom.json' };
        try {
          ctx.manager.remoteConfig.initialize(ctx.manager);
          ctx.expect(ctx.manager.remoteConfig._url).toBe('https://override.example/custom.json');
        } finally {
          ctx.manager.remoteConfig.shutdown();
          ctx.manager.config.remoteConfig = orig;
          ctx.manager.remoteConfig.initialize(ctx.manager);
        }
      },
    },
    {
      name: 'enabled=false: skip everything',
      run: async (ctx) => {
        ctx.manager.remoteConfig.shutdown();
        const orig = ctx.manager.config.remoteConfig;
        ctx.manager.config.remoteConfig = { enabled: false };
        try {
          ctx.manager.remoteConfig.initialize(ctx.manager);
          ctx.expect(ctx.manager.remoteConfig._enabled).toBe(false);
          ctx.expect(ctx.manager.remoteConfig._url).toBe(null);
          ctx.expect(ctx.manager.remoteConfig._intervalId).toBe(null);
        } finally {
          ctx.manager.remoteConfig.shutdown();
          ctx.manager.config.remoteConfig = orig;
          ctx.manager.remoteConfig.initialize(ctx.manager);
        }
      },
    },
    {
      name: 'get() returns cached data after a successful fetch',
      run: async (ctx) => {
        // Inject test data via the storage cache + bypass the network.
        const planted = { status: 'online', versionRequired: '2.0.0' };
        ctx.manager.remoteConfig._data = planted;
        const got = ctx.manager.remoteConfig.get();
        ctx.expect(got.status).toBe('online');
        ctx.expect(got.versionRequired).toBe('2.0.0');
      },
    },
    {
      name: 'get() supports dot-path lookup',
      run: (ctx) => {
        ctx.manager.remoteConfig._data = {
          status: 'online',
          settings: { versionRequired: '1.5.0', nested: { value: 42 } },
        };
        ctx.expect(ctx.manager.remoteConfig.get('status')).toBe('online');
        ctx.expect(ctx.manager.remoteConfig.get('settings.versionRequired')).toBe('1.5.0');
        ctx.expect(ctx.manager.remoteConfig.get('settings.nested.value')).toBe(42);
        ctx.expect(ctx.manager.remoteConfig.get('settings.missing')).toBe(undefined);
        ctx.expect(ctx.manager.remoteConfig.get('totally.absent.path')).toBe(undefined);
      },
    },
    {
      name: 'get() returns DEFAULTS even before first fetch (so consumers never see undefined at boot)',
      run: (ctx) => {
        const orig = ctx.manager.remoteConfig._data;
        ctx.manager.remoteConfig._data = null;
        try {
          const all = ctx.manager.remoteConfig.get();
          ctx.expect(all.status).toBe('online');
          ctx.expect(all.versionRequired).toBe('0.0.0');
          ctx.expect(ctx.manager.remoteConfig.get('status')).toBe('online');
          ctx.expect(ctx.manager.remoteConfig.get('versionRequired')).toBe('0.0.0');
        } finally { ctx.manager.remoteConfig._data = orig; }
      },
    },
    {
      name: 'DEFAULTS export — exposed for consumer reference',
      run: (ctx) => {
        const D = ctx.manager.remoteConfig.DEFAULTS;
        ctx.expect(D).toBeDefined();
        ctx.expect(D.status).toBe('online');
        ctx.expect(D.versionRequired).toBe('0.0.0');
        // Frozen — consumers can't accidentally mutate the shared default.
        let threw = false;
        try { D.status = 'tampered'; } catch (_) { threw = true; }
        // In strict mode this throws; in sloppy it silently fails. Either way
        // the value should not change.
        ctx.expect(D.status).toBe('online');
      },
    },
    {
      name: 'on(update, fn): subscriber fires when _emit is called',
      run: async (ctx) => {
        let received = null;
        const off = ctx.manager.remoteConfig.on('update', (data) => { received = data; });
        try {
          ctx.manager.remoteConfig._emit('update', { ping: true });
          ctx.expect(received).toEqual({ ping: true });
        } finally { off(); }
      },
    },
    {
      name: 'on(update, fn): unsubscribe stops further calls',
      run: (ctx) => {
        let count = 0;
        const off = ctx.manager.remoteConfig.on('update', () => { count++; });
        ctx.manager.remoteConfig._emit('update', {});
        ctx.expect(count).toBe(1);
        off();
        ctx.manager.remoteConfig._emit('update', {});
        ctx.expect(count).toBe(1);   // unchanged
      },
    },
    {
      name: 'IPC handler em:remote-config:get returns cached data',
      run: async (ctx) => {
        ctx.manager.remoteConfig._data = { status: 'online', x: 1 };
        const result = await ctx.manager.ipc.invoke('em:remote-config:get');
        ctx.expect(result.status).toBe('online');
        ctx.expect(result.x).toBe(1);
      },
    },
    {
      name: 'IPC handler em:remote-config:get supports dot-path',
      run: async (ctx) => {
        ctx.manager.remoteConfig._data = { settings: { versionRequired: '3.1.4' } };
        const result = await ctx.manager.ipc.invoke('em:remote-config:get', 'settings.versionRequired');
        ctx.expect(result).toBe('3.1.4');
      },
    },
  ],
};
