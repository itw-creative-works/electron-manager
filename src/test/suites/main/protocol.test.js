// Main-layer tests for lib/protocol.js — single-instance lock + custom URL scheme.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'protocol (main)',
  tests: [
    {
      name: 'protocol module is loaded on the manager',
      run: (ctx) => {
        ctx.expect(ctx.manager.protocol).toBeDefined();
        ctx.expect(ctx.manager.protocol._initialized).toBe(true);
      },
    },
    {
      name: 'hasSingleInstanceLock returns true (test process owns the lock)',
      run: (ctx) => {
        ctx.expect(ctx.manager.protocol.hasSingleInstanceLock()).toBe(true);
      },
    },
    {
      name: 'getSchemes returns brand.id when configured',
      run: (ctx) => {
        const schemes = ctx.manager.protocol.getSchemes();
        ctx.expect(Array.isArray(schemes)).toBe(true);
        const brandId = ctx.manager.config?.brand?.id;
        if (brandId) {
          ctx.expect(schemes).toContain(brandId);
        }
      },
    },
    {
      name: 'getSchemes returns a fresh copy each call (mutation safe)',
      run: (ctx) => {
        const a = ctx.manager.protocol.getSchemes();
        const b = ctx.manager.protocol.getSchemes();
        ctx.expect(a).not.toBe(b);   // different array instances
        ctx.expect(a).toEqual(b);    // same contents
      },
    },
    {
      name: 'isOurScheme matches registered scheme',
      run: (ctx) => {
        const brandId = ctx.manager.config?.brand?.id;
        if (!brandId) return ctx.skip('no brand.id configured');
        ctx.expect(ctx.manager.protocol.isOurScheme(`${brandId}://auth/token?t=abc`)).toBe(true);
      },
    },
    {
      name: 'isOurScheme rejects unregistered schemes',
      run: (ctx) => {
        ctx.expect(ctx.manager.protocol.isOurScheme('https://example.com')).toBe(false);
        ctx.expect(ctx.manager.protocol.isOurScheme('imaginary-scheme://x')).toBe(false);
      },
    },
    {
      name: 'isOurScheme: non-string input returns false (no throw)',
      run: (ctx) => {
        ctx.expect(ctx.manager.protocol.isOurScheme(null)).toBe(false);
        ctx.expect(ctx.manager.protocol.isOurScheme(undefined)).toBe(false);
        ctx.expect(ctx.manager.protocol.isOurScheme(42)).toBe(false);
        ctx.expect(ctx.manager.protocol.isOurScheme({})).toBe(false);
      },
    },
    {
      name: 'initialize is idempotent — re-calling does not change schemes',
      run: async (ctx) => {
        const before = ctx.manager.protocol.getSchemes();
        await ctx.manager.protocol.initialize(ctx.manager);
        const after = ctx.manager.protocol.getSchemes();
        ctx.expect(after).toEqual(before);
      },
    },
  ],
};
