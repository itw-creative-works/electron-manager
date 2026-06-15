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

    // ── Test stealth (this harness IS Testing mode, so stealth is active) ────
    {
      name: 'stealth: app activation suppressed — dock hidden (accessory policy, macOS)',
      run: (ctx) => {
        if (process.platform !== 'darwin') {
          return ctx.skip('macOS-only — accessory activation policy / dock');
        }
        // Both the harness entry (at require time) and Manager.initialize (step 1a)
        // hide the dock under the stealth predicate, so the launched test app never
        // activates and never steals keyboard focus.
        const { app } = require('electron');
        ctx.expect(app.dock.isVisible()).toBe(false);
      },
    },
    {
      name: 'stealth surfacing: shown but invisible (opacity 0) and never focused',
      run: (ctx) => {
        const { BrowserWindow } = require('electron');

        ctx.expect(ctx.manager.windows._isStealth()).toBe(true);

        const win = new BrowserWindow({ show: false, width: 120, height: 80 });
        ctx.manager.windows._surface(win, 'stealth-probe');

        // Shown (rendering/timers run like a visible window — NOT hide/minimize,
        // which would occlusion-throttle) but fully transparent and inactive.
        ctx.expect(win.isVisible()).toBe(true);
        ctx.expect(win.getOpacity()).toBe(0);
        ctx.expect(win.isFocused()).toBe(false);

        win.destroy();
      },
    },
    {
      name: 'EM_TEST_SHOW=1 opts out: windows surface normally (opacity 1)',
      run: (ctx) => {
        const { BrowserWindow } = require('electron');

        process.env.EM_TEST_SHOW = '1';
        try {
          ctx.expect(ctx.manager.windows._isStealth()).toBe(false);

          // This probe exercises the real non-stealth _surface branch WITHOUT
          // stealing the developer's keyboard focus mid-run. Two activation
          // paths have to be neutralized (measured on macOS):
          //   1. _ensureDockVisible → dock.show() activates the app
          //      (TransformProcessType). Pre-flipping the activation policy to
          //      'regular' makes the dock visible WITHOUT activating, so
          //      _ensureDockVisible no-ops.
          //   2. win.show() hands the window keyboard focus — focusable:false
          //      declines it while still ordering the window front (visible,
          //      opacity 1), which is what this test asserts.
          if (process.platform === 'darwin') {
            require('electron').app.setActivationPolicy('regular');
          }
          const win = new BrowserWindow({ show: false, width: 120, height: 80, x: 0, y: 0, focusable: false });
          ctx.manager.windows._surface(win, 'visible-probe');

          ctx.expect(win.isVisible()).toBe(true);
          ctx.expect(win.getOpacity()).toBe(1);

          win.destroy();
        } finally {
          delete process.env.EM_TEST_SHOW;
          // Restore the launch-time activation suppression for the rest of the run.
          if (process.platform === 'darwin') {
            require('electron').app.dock.hide();
          }
        }

        // Flag removed → stealth is back on for the rest of the run.
        ctx.expect(ctx.manager.windows._isStealth()).toBe(true);
      },
    },
    {
      name: 'trafficLightPosition passes through to the BrowserWindow (mac)',
      run: async (ctx) => {
        if (process.platform !== 'darwin') {
          return; // trafficLightPosition is a macOS-only BrowserWindow option
        }

        const win = await ctx.manager.windows.create('tlp-probe', { trafficLightPosition: { x: 26, y: 24 } });
        ctx.expect(win).toBeTruthy();

        const pos = win.getWindowButtonPosition();
        ctx.expect(pos).toEqual({ x: 26, y: 24 });

        win.destroy();
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
