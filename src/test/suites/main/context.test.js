// Main-layer tests for lib/context.js — session id, deviceId resolution,
// client info, geolocation cache restore + persistence.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'context (main)',
  tests: [
    {
      name: 'context module wired on manager + initialized during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.context).toBeDefined();
        ctx.expect(ctx.manager.context._initialized).toBe(true);
      },
    },
    {
      name: 'session has id (UUID), startTime (ISO), deviceId (string)',
      run: (ctx) => {
        const s = ctx.manager.context.session;
        ctx.expect(typeof s.id).toBe('string');
        ctx.expect(s.id.length).toBe(36);
        ctx.expect(typeof s.startTime).toBe('string');
        ctx.expect(s.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        ctx.expect(typeof s.deviceId).toBe('string');
        ctx.expect(s.deviceId.length > 0).toBe(true);
      },
    },
    {
      name: 'deviceId is stable — re-init preserves the same id',
      run: async (ctx) => {
        const before = ctx.manager.context.session.deviceId;
        ctx.manager.context.shutdown();
        await ctx.manager.context.initialize(ctx.manager);
        const after = ctx.manager.context.session.deviceId;
        ctx.expect(after).toBe(before);
      },
    },
    {
      name: 'client.platform is set (matches os.platform())',
      run: (ctx) => {
        const expected = require('os').platform();
        ctx.expect(ctx.manager.context.client.platform).toBe(expected);
      },
    },
    {
      name: 'client.arch is set',
      run: (ctx) => {
        ctx.expect(typeof ctx.manager.context.client.arch).toBe('string');
        ctx.expect(ctx.manager.context.client.arch.length > 0).toBe(true);
      },
    },
    {
      name: 'client.mobile is false on desktop',
      run: (ctx) => {
        ctx.expect(ctx.manager.context.client.mobile).toBe(false);
      },
    },
    {
      name: 'app.environment matches manager.getEnvironment()',
      run: (ctx) => {
        ctx.expect(ctx.manager.context.app.environment).toBe(ctx.manager.getEnvironment());
      },
    },
    {
      name: 'app.version matches manager.getVersion()',
      run: (ctx) => {
        ctx.expect(ctx.manager.context.app.version).toBe(ctx.manager.getVersion());
      },
    },
    {
      name: 'toJSON returns plain JSON snapshot (structured-cloneable)',
      run: (ctx) => {
        const snap = ctx.manager.context.toJSON();
        ctx.expect(snap.geolocation).toBeDefined();
        ctx.expect(snap.client).toBeDefined();
        ctx.expect(snap.session).toBeDefined();
        ctx.expect(snap.app).toBeDefined();
        // Must JSON-roundtrip without errors.
        const roundtripped = JSON.parse(JSON.stringify(snap));
        ctx.expect(roundtripped.session.id).toBe(snap.session.id);
      },
    },
    {
      name: '_readFirstMac returns null or a MAC-shaped string',
      run: (ctx) => {
        const mac = ctx.manager.context._readFirstMac();
        if (mac !== null) {
          ctx.expect(mac).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i);
        }
      },
    },
    {
      name: 'IPC handler em:context:get returns the snapshot',
      run: async (ctx) => {
        const snap = await ctx.manager.ipc.invoke('em:context:get');
        ctx.expect(snap.session.id).toBe(ctx.manager.context.session.id);
        ctx.expect(snap.client.platform).toBe(ctx.manager.context.client.platform);
      },
    },
  ],
};
