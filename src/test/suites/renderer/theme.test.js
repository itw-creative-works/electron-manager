// Renderer-layer suite — verifies the `window.em.theme` surface and the REAL
// propagation mechanism: main sets nativeTheme.themeSource → this renderer's
// `prefers-color-scheme` media query flips → matchMedia listeners fire.
//
// Runs inside a hidden BrowserWindow. Test bodies are reconstructed via
// `new Function('ctx', body)` — no closures over module scope, so each test
// inlines its own poll helper.
//
// The last test restores 'system' + clears the persisted override so the
// harness leaves no theme residue for later suites.

module.exports = {
  type: 'suite',
  layer: 'renderer',
  description: 'theme surface + matchMedia propagation',
  tests: [
    {
      name: 'window.em.theme has get / set / onChange',
      run: (ctx) => {
        ctx.expect(typeof window.em.theme.get).toBe('function');
        ctx.expect(typeof window.em.theme.set).toBe('function');
        ctx.expect(typeof window.em.theme.onChange).toBe('function');
      },
    },
    {
      name: 'get() returns a { source, resolved } pair',
      run: async (ctx) => {
        const state = await window.em.theme.get();
        ctx.expect(['system', 'light', 'dark'].includes(state.source)).toBe(true);
        ctx.expect(['light', 'dark'].includes(state.resolved)).toBe(true);
      },
    },
    {
      name: 'set("dark") flips prefers-color-scheme in this renderer',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for media query flip');
            await new Promise((r) => setTimeout(r, 25));
          }
        };
        const media = window.matchMedia('(prefers-color-scheme: dark)');

        const state = await window.em.theme.set('dark');
        ctx.expect(state).toEqual({ source: 'dark', resolved: 'dark' });
        await until(() => media.matches === true);
        ctx.expect(media.matches).toBe(true);
      },
    },
    {
      name: 'set("light") flips it back',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for media query flip');
            await new Promise((r) => setTimeout(r, 25));
          }
        };
        const media = window.matchMedia('(prefers-color-scheme: dark)');

        const state = await window.em.theme.set('light');
        ctx.expect(state).toEqual({ source: 'light', resolved: 'light' });
        await until(() => media.matches === false);
        ctx.expect(media.matches).toBe(false);
      },
    },
    {
      name: 'onChange fires on a theme flip and unsubscribes cleanly',
      run: async (ctx) => {
        const events = [];
        const unsub = window.em.theme.onChange((payload) => events.push(payload));

        const current = await window.em.theme.get();
        const target = current.resolved === 'dark' ? 'light' : 'dark';
        await window.em.theme.set(target);

        const t0 = Date.now();
        while (events.length === 0) {
          if (Date.now() - t0 > 3000) throw new Error('timed out waiting for onChange');
          await new Promise((r) => setTimeout(r, 25));
        }
        ctx.expect(events[0]).toEqual({ resolved: target });

        unsub();
        const seen = events.length;
        await window.em.theme.set(target === 'dark' ? 'light' : 'dark');
        await new Promise((r) => setTimeout(r, 200));
        ctx.expect(events.length).toBe(seen);
      },
    },
    {
      name: 'set() rejects invalid sources',
      run: async (ctx) => {
        let threw = false;
        try {
          await window.em.theme.set('midnight');
        } catch (e) {
          threw = true;
        }
        ctx.expect(threw).toBe(true);
      },
    },
    {
      name: 'restore: back to system + no persisted override left behind',
      run: async (ctx) => {
        const state = await window.em.theme.set('system');
        ctx.expect(state.source).toBe('system');
        await window.em.storage.delete('theme.appearance');
        const has = await window.em.storage.has('theme.appearance');
        ctx.expect(has).toBe(false);
      },
    },
  ],
};
