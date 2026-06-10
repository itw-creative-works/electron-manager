// Main-layer tests for lib/remote-scripts.js — boot wiring, URL resolution,
// config gating, hashing, execution, storage round-trips.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'remote-scripts (main)',
  cleanup: (ctx) => {
    ctx.manager.remoteScripts.shutdown();
    ctx.manager.storage.set('remoteScripts.lastRun', null);
    ctx.manager.remoteScripts.initialize(ctx.manager);
  },
  tests: [
    // ─── Boot wiring ────────────────────────────────────────────────────────
    {
      name: 'remoteScripts module wired on manager + initialized during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.remoteScripts).toBeDefined();
        ctx.expect(ctx.manager.remoteScripts._initialized).toBe(true);
      },
    },
    {
      name: 'URL derived from brand.url + /data/scripts/main.js',
      run: (ctx) => {
        const u = ctx.manager.remoteScripts._url;
        ctx.expect(u === null || u.endsWith('/data/scripts/main.js')).toBe(true);
      },
    },
    {
      name: 'URL override: config.remoteScripts.url wins over brand.url',
      run: (ctx) => {
        ctx.manager.remoteScripts.shutdown();
        const orig = ctx.manager.config.remoteScripts;
        ctx.manager.config.remoteScripts = { url: 'https://override.example/patch.js' };
        try {
          ctx.manager.remoteScripts.initialize(ctx.manager);
          ctx.expect(ctx.manager.remoteScripts._url).toBe('https://override.example/patch.js');
        } finally {
          ctx.manager.remoteScripts.shutdown();
          ctx.manager.config.remoteScripts = orig;
          ctx.manager.remoteScripts.initialize(ctx.manager);
        }
      },
    },
    {
      name: 'enabled=false: skip everything',
      run: (ctx) => {
        ctx.manager.remoteScripts.shutdown();
        const orig = ctx.manager.config.remoteScripts;
        ctx.manager.config.remoteScripts = { enabled: false };
        try {
          ctx.manager.remoteScripts.initialize(ctx.manager);
          ctx.expect(ctx.manager.remoteScripts._enabled).toBe(false);
          ctx.expect(ctx.manager.remoteScripts._url).toBe(null);
          ctx.expect(ctx.manager.remoteScripts._intervalId).toBe(null);
        } finally {
          ctx.manager.remoteScripts.shutdown();
          ctx.manager.config.remoteScripts = orig;
          ctx.manager.remoteScripts.initialize(ctx.manager);
        }
      },
    },

    // ─── Hashing ────────────────────────────────────────────────────────────
    {
      name: '_hash: stable — same input produces same 16-char hex',
      run: (ctx) => {
        const rs = ctx.manager.remoteScripts;
        const h1 = rs._hash('manager.storage.delete("x");');
        const h2 = rs._hash('manager.storage.delete("x");');
        ctx.expect(h1).toBe(h2);
        ctx.expect(typeof h1).toBe('string');
        ctx.expect(h1.length).toBe(16);
      },
    },
    {
      name: '_hash: different input produces different hash',
      run: (ctx) => {
        const rs = ctx.manager.remoteScripts;
        ctx.expect(rs._hash('script v1')).not.toBe(rs._hash('script v2'));
      },
    },

    // ─── Execution ──────────────────────────────────────────────────────────
    {
      name: '_execute: runs code with manager in scope',
      run: async (ctx) => {
        ctx.manager._remoteScriptTestResult = null;
        await ctx.manager.remoteScripts._execute('manager._remoteScriptTestResult = 42;');
        ctx.expect(ctx.manager._remoteScriptTestResult).toBe(42);
        delete ctx.manager._remoteScriptTestResult;
      },
    },
    {
      name: '_execute: supports async code (await)',
      run: async (ctx) => {
        ctx.manager._remoteScriptTestResult = null;
        await ctx.manager.remoteScripts._execute(
          'const v = await Promise.resolve(99); manager._remoteScriptTestResult = v;',
        );
        ctx.expect(ctx.manager._remoteScriptTestResult).toBe(99);
        delete ctx.manager._remoteScriptTestResult;
      },
    },
    {
      name: '_execute: require is available (e.g. require("path"))',
      run: async (ctx) => {
        ctx.manager._remoteScriptTestResult = null;
        await ctx.manager.remoteScripts._execute(
          'const path = require("path"); manager._remoteScriptTestResult = typeof path.join;',
        );
        ctx.expect(ctx.manager._remoteScriptTestResult).toBe('function');
        delete ctx.manager._remoteScriptTestResult;
      },
    },
    {
      name: '_execute: bad code throws (caller catches)',
      run: async (ctx) => {
        let threw = false;
        try {
          await ctx.manager.remoteScripts._execute('throw new Error("boom");');
        } catch (e) {
          threw = true;
          ctx.expect(e.message).toBe('boom');
        }
        ctx.expect(threw).toBe(true);
      },
    },

    // ─── Storage round-trips ────────────────────────────────────────────────
    {
      name: 'getLastRun returns null when no script has run',
      run: (ctx) => {
        ctx.manager.storage.set('remoteScripts.lastRun', null);
        ctx.expect(ctx.manager.remoteScripts.getLastRun()).toBe(null);
      },
    },
    {
      name: 'clearExecuted wipes stored hash',
      run: (ctx) => {
        ctx.manager.storage.set('remoteScripts.lastRun', { hash: 'abc', timestamp: 1 });
        ctx.expect(ctx.manager.remoteScripts.getLastRun()).toEqual({ hash: 'abc', timestamp: 1 });
        ctx.manager.remoteScripts.clearExecuted();
        ctx.expect(ctx.manager.remoteScripts.getLastRun()).toBe(null);
      },
    },
    {
      name: 'refreshNow returns null when disabled',
      run: async (ctx) => {
        ctx.manager.remoteScripts.shutdown();
        const orig = ctx.manager.config.remoteScripts;
        ctx.manager.config.remoteScripts = { enabled: false };
        try {
          ctx.manager.remoteScripts.initialize(ctx.manager);
          const result = await ctx.manager.remoteScripts.refreshNow();
          ctx.expect(result).toBe(null);
        } finally {
          ctx.manager.remoteScripts.shutdown();
          ctx.manager.config.remoteScripts = orig;
          ctx.manager.remoteScripts.initialize(ctx.manager);
        }
      },
    },
    // ─── Real-world pipeline simulation ───────────────────────────────────
    {
      name: 'full pipeline: execute script → storage patched → hash stored → same script skipped → changed script re-runs',
      run: async (ctx) => {
        const rs = ctx.manager.remoteScripts;
        rs.clearExecuted();

        const scriptV1 = 'manager.storage.set("remoteScripts._test.patched", true);';
        const scriptV2 = 'manager.storage.set("remoteScripts._test.patched", "v2");';

        // 1. Execute v1 — should patch storage
        await rs._execute(scriptV1);
        const hashV1 = rs._hash(scriptV1);
        ctx.manager.storage.set('remoteScripts.lastRun', { hash: hashV1, timestamp: Date.now() });

        ctx.expect(ctx.manager.storage.get('remoteScripts._test.patched')).toBe(true);
        ctx.expect(rs.getLastRun().hash).toBe(hashV1);

        // 2. Same script again — hash matches, should be skipped
        const lastRun = rs.getLastRun();
        const sameHash = rs._hash(scriptV1);
        ctx.expect(sameHash).toBe(lastRun.hash); // dedup would skip

        // 3. Changed script — different hash, would re-run
        const hashV2 = rs._hash(scriptV2);
        ctx.expect(hashV2).not.toBe(hashV1); // proves the hash changes

        await rs._execute(scriptV2);
        ctx.expect(ctx.manager.storage.get('remoteScripts._test.patched')).toBe('v2');

        // Cleanup
        ctx.manager.storage.delete('remoteScripts._test.patched');
      },
    },

    {
      name: 'shutdown resets all internal state',
      run: (ctx) => {
        ctx.manager.remoteScripts.shutdown();
        const rs = ctx.manager.remoteScripts;
        ctx.expect(rs._initialized).toBe(false);
        ctx.expect(rs._manager).toBe(null);
        ctx.expect(rs._url).toBe(null);
        ctx.expect(rs._enabled).toBe(true);
        ctx.expect(rs._intervalId).toBe(null);
        // Re-init for cleanup handler
        rs.initialize(ctx.manager);
      },
    },
  ],
};
