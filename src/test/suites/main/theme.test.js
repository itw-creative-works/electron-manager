// Main-process tests for lib/theme.js — source/resolved round-trip, nativeTheme
// wiring, persistence, change events (with dedupe), IPC handlers, validation.
//
// ctx.manager is a fully-initialized EM Manager. Every test that mutates the theme
// restores it; cleanup() resets to the pre-suite source and clears the persisted
// override so later suites (and re-runs) start clean.

let originalSource = null;

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'theme (main)',
  cleanup: async (ctx) => {
    if (originalSource) {
      ctx.manager.theme.set(originalSource);
    }
    ctx.manager.storage.delete('theme.appearance');
  },
  tests: [
    {
      name: 'manager.theme is initialized with the full API surface',
      run: (ctx) => {
        originalSource = ctx.manager.theme.get();
        ctx.expect(ctx.manager.theme._initialized).toBe(true);
        ctx.expect(typeof ctx.manager.theme.get).toBe('function');
        ctx.expect(typeof ctx.manager.theme.set).toBe('function');
        ctx.expect(typeof ctx.manager.theme.resolved).toBe('function');
        ctx.expect(typeof ctx.manager.theme.onChange).toBe('function');
      },
    },
    {
      name: 'get() returns a valid source and resolved() a concrete appearance',
      run: (ctx) => {
        ctx.expect(['system', 'light', 'dark'].includes(ctx.manager.theme.get())).toBe(true);
        ctx.expect(['light', 'dark'].includes(ctx.manager.theme.resolved())).toBe(true);
      },
    },
    {
      name: 'set("dark") drives nativeTheme.themeSource, resolution, and persistence',
      run: (ctx) => {
        const { nativeTheme } = require('electron');
        ctx.manager.theme.set('dark');
        ctx.expect(ctx.manager.theme.get()).toBe('dark');
        ctx.expect(ctx.manager.theme.resolved()).toBe('dark');
        ctx.expect(nativeTheme.themeSource).toBe('dark');
        ctx.expect(nativeTheme.shouldUseDarkColors).toBe(true);
        ctx.expect(ctx.manager.storage.get('theme.appearance')).toBe('dark');
      },
    },
    {
      name: 'set("light") flips the resolution',
      run: (ctx) => {
        ctx.manager.theme.set('light');
        ctx.expect(ctx.manager.theme.get()).toBe('light');
        ctx.expect(ctx.manager.theme.resolved()).toBe('light');
        ctx.expect(ctx.manager.storage.get('theme.appearance')).toBe('light');
      },
    },
    {
      name: 'set("system") returns to following the OS',
      run: (ctx) => {
        const { nativeTheme } = require('electron');
        ctx.manager.theme.set('system');
        ctx.expect(ctx.manager.theme.get()).toBe('system');
        ctx.expect(nativeTheme.themeSource).toBe('system');
        // In system mode the resolution is whatever the OS says — assert coherence,
        // not a specific value (the test machine's OS preference is not ours to pin).
        ctx.expect(ctx.manager.theme.resolved()).toBe(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
      },
    },
    {
      name: 'set() throws on anything outside system|light|dark',
      run: (ctx) => {
        let threw = false;
        try {
          ctx.manager.theme.set('auto');
        } catch (e) {
          threw = true;
        }
        ctx.expect(threw).toBe(true);

        threw = false;
        try {
          ctx.manager.theme.set(undefined);
        } catch (e) {
          threw = true;
        }
        ctx.expect(threw).toBe(true);
      },
    },
    {
      name: 'onChange fires once per effective change (deduped) and unsubscribes',
      run: (ctx) => {
        ctx.manager.theme.set('light');

        const calls = [];
        const unsub = ctx.manager.theme.onChange((payload) => calls.push(payload));

        ctx.manager.theme.set('dark');   // change → fires
        ctx.manager.theme.set('dark');   // no-op → silent
        ctx.manager.theme.set('light');  // change → fires

        unsub();
        ctx.manager.theme.set('dark');   // unsubscribed → silent

        ctx.expect(calls.length).toBe(2);
        ctx.expect(calls[0]).toEqual({ source: 'dark', resolved: 'dark' });
        ctx.expect(calls[1]).toEqual({ source: 'light', resolved: 'light' });
      },
    },
    {
      name: 'em:theme:get / em:theme:set IPC handlers round-trip',
      run: async (ctx) => {
        const set = await ctx.manager.ipc.invoke('em:theme:set', { source: 'dark' });
        ctx.expect(set).toEqual({ source: 'dark', resolved: 'dark' });

        const got = await ctx.manager.ipc.invoke('em:theme:get');
        ctx.expect(got).toEqual({ source: 'dark', resolved: 'dark' });
      },
    },
    {
      name: 'em:theme:set rejects invalid sources',
      run: async (ctx) => {
        let threw = false;
        try {
          await ctx.manager.ipc.invoke('em:theme:set', { source: 'midnight' });
        } catch (e) {
          threw = true;
        }
        ctx.expect(threw).toBe(true);
      },
    },
  ],
};
