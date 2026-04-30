// Main-process tests for window-manager bounds persistence.
//
// Storage key shape: windows.<name>.bounds = { x, y, width, height, maximized, fullscreen }
// Verified behavior:
//   - createNamed without saved bounds uses config defaults (no x/y → centered)
//   - close persists current bounds
//   - createNamed with saved bounds restores them
//   - off-screen bounds are clamped (position dropped, size kept)
//   - persistBounds: false opts out of save AND restore

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'window-manager bounds persistence (main)',
  cleanup: (ctx) => {
    // Drop everything we wrote so reruns are clean.
    ctx.manager.storage.delete('windows.settings.bounds');
    ctx.manager.storage.delete('windows.about.bounds');
    ctx.manager.storage.delete('windows.bounds-test.bounds');
    // Make sure no test-leftover windows remain.
    ['settings', 'about', 'bounds-test'].forEach((name) => {
      const w = ctx.manager.windows.get(name);
      if (w) {
        w._emForceClose = true;
        w.close();
      }
    });
  },
  tests: [
    {
      name: '_loadBounds returns null when nothing is saved',
      run: (ctx) => {
        ctx.manager.storage.delete('windows.bounds-test.bounds');
        ctx.expect(ctx.manager.windows._loadBounds('bounds-test', ctx.manager)).toBeNull();
      },
    },
    {
      name: '_loadBounds returns the saved object',
      run: (ctx) => {
        const saved = { x: 50, y: 60, width: 800, height: 600 };
        ctx.manager.storage.set('windows.bounds-test.bounds', saved);
        ctx.expect(ctx.manager.windows._loadBounds('bounds-test', ctx.manager)).toEqual(saved);
      },
    },
    {
      name: '_loadBounds rejects malformed entries',
      run: (ctx) => {
        ctx.manager.storage.set('windows.bounds-test.bounds', { width: 'oops' });
        ctx.expect(ctx.manager.windows._loadBounds('bounds-test', ctx.manager)).toBeNull();

        ctx.manager.storage.set('windows.bounds-test.bounds', { width: 50, height: 50 }); // below sanity floor
        ctx.expect(ctx.manager.windows._loadBounds('bounds-test', ctx.manager)).toBeNull();
      },
    },
    {
      name: '_clampToDisplays drops x/y when off-screen, keeps width/height',
      run: (ctx) => {
        // Way off-screen (huge negative coordinates).
        const out = ctx.manager.windows._clampToDisplays({
          x: -99999, y: -99999, width: 800, height: 600,
        });
        ctx.expect(out.x).toBeUndefined();
        ctx.expect(out.y).toBeUndefined();
        ctx.expect(out.width).toBe(800);
        ctx.expect(out.height).toBe(600);
      },
    },
    {
      name: '_clampToDisplays keeps x/y when on-screen',
      run: (ctx) => {
        // Use a primary-display point we know is on-screen: (100, 100).
        const out = ctx.manager.windows._clampToDisplays({
          x: 100, y: 100, width: 800, height: 600,
        });
        ctx.expect(out.x).toBe(100);
        ctx.expect(out.y).toBe(100);
      },
    },
    {
      name: 'createNamed restores saved bounds',
      run: async (ctx) => {
        // Pre-seed storage with bounds for the about window.
        const wanted = { x: 120, y: 140, width: 720, height: 540 };
        ctx.manager.storage.set('windows.about.bounds', wanted);

        const win = await ctx.manager.windows.createNamed('about');
        ctx.state.win = win;
        const got = win.getBounds();
        ctx.expect(got.width).toBe(720);
        ctx.expect(got.height).toBe(540);
        // x/y depend on the OS chrome (title bars etc.) but should be at least within a few px of what we asked.
        ctx.expect(Math.abs(got.x - 120)).toBeLessThan(50);
        ctx.expect(Math.abs(got.y - 140)).toBeLessThan(50);
      },
    },
    {
      name: '_saveBoundsNow writes the current bounds to storage',
      run: (ctx) => {
        const win = ctx.state.win;
        ctx.expect(win).toBeTruthy();

        // Move + resize, then trigger save.
        win.setBounds({ x: 200, y: 220, width: 640, height: 480 });
        ctx.manager.windows._saveBoundsNow('about');

        const saved = ctx.manager.storage.get('windows.about.bounds');
        ctx.expect(saved).toBeTruthy();
        ctx.expect(saved.width).toBe(640);
        ctx.expect(saved.height).toBe(480);
        ctx.expect(saved.maximized).toBe(false);
        ctx.expect(saved.fullscreen).toBe(false);
      },
    },
    {
      name: 'close flushes the bounds save',
      run: async (ctx) => {
        const win = ctx.state.win;
        win.setBounds({ x: 300, y: 300, width: 555, height: 444 });

        const closedPromise = new Promise((r) => {
          if (win.isDestroyed()) return r();
          win.once('closed', r);
        });
        ctx.manager.windows.close('about');
        await closedPromise;

        const saved = ctx.manager.storage.get('windows.about.bounds');
        ctx.expect(saved.width).toBe(555);
        ctx.expect(saved.height).toBe(444);
      },
    },
    {
      name: 'persistBounds: false → no auto-save on resize, no restore on create',
      run: async (ctx) => {
        // Pre-seed bounds that SHOULD be ignored when persistBounds: false.
        ctx.manager.storage.set('windows.about.bounds', { x: 50, y: 60, width: 999, height: 888 });

        const origConfig = ctx.manager.config.windows.about;
        ctx.manager.config.windows.about = { ...origConfig, persistBounds: false };

        try {
          const win = await ctx.manager.windows.createNamed('about');

          // Saved 999x888 must NOT have been restored — should fall back to config defaults.
          const got = win.getBounds();
          ctx.expect(got.width).not.toBe(999);
          ctx.expect(got.height).not.toBe(888);

          // Now resize and confirm no auto-save fires past the debounce window.
          ctx.manager.storage.delete('windows.about.bounds');
          win.setBounds({ x: 30, y: 30, width: 700, height: 500 });
          await new Promise((r) => setTimeout(r, 350));
          ctx.expect(ctx.manager.storage.get('windows.about.bounds')).toBeUndefined();

          const closedPromise = new Promise((r) => win.once('closed', r));
          ctx.manager.windows.close('about');
          await closedPromise;

          // close also must NOT have written under persistBounds:false.
          ctx.expect(ctx.manager.storage.get('windows.about.bounds')).toBeUndefined();
        } finally {
          ctx.manager.config.windows.about = origConfig;
        }
      },
    },
  ],
};
