// Main-process tests for lib/window-manager.js — createNamed, dedup, hide/show/close lifecycle.
//
// Note: createNamed requires src/views/<view>/index.html to exist on disk in the test cwd.
// The harness uses EM's defaults config but runs from EM's repo root, where there are no built views.
// So we test the API surface and dedup behavior using the manager's electron handle but skip
// actual file-loading in createNamed (it logs an error and returns the BrowserWindow anyway,
// which is enough to verify the registry behavior).

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'window-manager (main)',
  tests: [
    {
      name: 'initialize was called during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.windows._initialized).toBe(true);
      },
    },
    {
      name: 'list returns empty array when no windows are open',
      run: (ctx) => {
        // skipWindowCreation: true means no window was auto-created.
        ctx.expect(Array.isArray(ctx.manager.windows.list())).toBe(true);
        ctx.expect(ctx.manager.windows.list().length).toBe(0);
      },
    },
    {
      name: 'get returns null for unknown name',
      run: (ctx) => {
        ctx.expect(ctx.manager.windows.get('nonexistent')).toBeNull();
      },
    },
    {
      name: 'createNamed registers a window in the registry (uses about view)',
      run: async (ctx) => {
        // We need a view file. Use EM's own defaults dir as the cwd-equivalent by setting a custom html path.
        // For simplicity, just verify createNamed creates a BrowserWindow even when the html file is missing
        // (loadFile catches the error; the window object still exists in the registry).
        const win = await ctx.manager.windows.createNamed('about');
        ctx.state.win = win;
        ctx.expect(win).toBeTruthy();
        ctx.expect(ctx.manager.windows.get('about')).toBe(win);
        ctx.expect(ctx.manager.windows.list()).toContain('about');
      },
    },
    {
      name: 'createNamed dedups — second call returns the same window',
      run: async (ctx) => {
        const again = await ctx.manager.windows.createNamed('about');
        ctx.expect(again).toBe(ctx.state.win);
      },
    },
    {
      name: 'hide / show do not throw',
      run: (ctx) => {
        ctx.manager.windows.hide('about');
        ctx.manager.windows.show('about');
        // No assertion beyond "didn't throw" — visibility is OS-side state we can't reliably read.
      },
    },
    {
      name: 'close removes the window from the registry',
      run: async (ctx) => {
        const win = ctx.manager.windows.get('about');
        ctx.expect(win).toBeTruthy();

        // close fires asynchronously — wait for the 'closed' event rather than guessing a timeout.
        const closedPromise = new Promise((resolve) => {
          if (win.isDestroyed()) return resolve();
          win.once('closed', resolve);
        });

        ctx.manager.windows.close('about');
        await closedPromise;

        ctx.expect(ctx.manager.windows.get('about')).toBeNull();
      },
    },
    {
      name: 'manager.quit + manager.relaunch exposed and set _allowQuit',
      run: (ctx) => {
        ctx.expect(typeof ctx.manager.quit).toBe('function');
        ctx.expect(typeof ctx.manager.relaunch).toBe('function');
        ctx.manager._allowQuit = false;

        // Calling quit({force:true}) should set _allowQuit BEFORE invoking app.quit().
        // We can't actually let app.quit() run mid-test (it'd kill the harness), so we
        // stub electron.app.quit with a noop, observe the flag, then restore.
        const electron = require('electron');
        const origQuit = electron.app.quit;
        electron.app.quit = () => {};
        try {
          ctx.manager.quit({ force: true });
          ctx.expect(ctx.manager._allowQuit).toBe(true);
        } finally {
          electron.app.quit = origQuit;
          ctx.manager._allowQuit = false;
        }
      },
    },
    {
      name: 'auto-updater installNow flips manager._allowQuit',
      run: (ctx) => {
        ctx.manager._allowQuit = false;

        // Force the autoUpdater state to "downloaded" + stub the underlying library
        // so installNow doesn't actually quit the harness.
        const prevState = ctx.manager.autoUpdater._state;
        const prevLib   = ctx.manager.autoUpdater._library;
        ctx.manager.autoUpdater._state = { code: 'downloaded', version: '9.9.9' };
        ctx.manager.autoUpdater._library = { quitAndInstall: () => {} };

        try {
          ctx.manager.autoUpdater.installNow();
          ctx.expect(ctx.manager._allowQuit).toBe(true);
        } finally {
          ctx.manager.autoUpdater._state   = prevState;
          ctx.manager.autoUpdater._library = prevLib;
          ctx.manager._allowQuit = false;
        }
      },
    },
  ],
};
