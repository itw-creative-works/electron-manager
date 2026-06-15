// Main-process tests for the global raw-BrowserWindow test stealth:
// utils/stealth-window.js applied by main.js's `browser-window-created` hook
// (registered during Manager.initialize step 1a-ii — this harness IS Testing
// mode, so the hook is live).
//
// Named windows created through lib/window-manager have their own stealth path
// (_surface — covered by window-manager.test.js); THESE tests prove windows
// that never touch window-manager can't flash or steal focus during a test run.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'stealth-window — raw BrowserWindow stealth (main)',
  tests: [
    {
      name: 'raw BrowserWindow is stealthed at creation (opacity 0, before any show)',
      run: (ctx) => {
        if (process.platform === 'linux') {
          return ctx.skip('setOpacity is unsupported on Linux (getOpacity always returns 1)');
        }
        const { BrowserWindow } = require('electron');
        const win = new BrowserWindow({ show: false, width: 120, height: 80 });
        ctx.state.win = win;
        ctx.expect(win.getOpacity()).toBe(0);
      },
    },
    {
      name: 'show() routes to showInactive — visible, never focused, still invisible',
      run: (ctx) => {
        if (process.platform === 'linux') {
          return ctx.skip('setOpacity is unsupported on Linux');
        }
        const win = ctx.state.win;
        win.show(); // raw consumers call show() — the stealth patch keeps it inactive
        ctx.expect(win.isVisible()).toBe(true);
        ctx.expect(win.isFocused()).toBe(false);
        ctx.expect(win.getOpacity()).toBe(0);
      },
    },
    {
      name: 'focus() is a no-op',
      run: (ctx) => {
        if (process.platform === 'linux') {
          return ctx.skip('setOpacity is unsupported on Linux');
        }
        const win = ctx.state.win;
        win.focus();
        ctx.expect(win.isFocused()).toBe(false);
        win.destroy();
      },
    },
    {
      name: 'EM_TEST_SHOW=1 opts out — raw windows are NOT stealthed at creation',
      run: (ctx) => {
        if (process.platform === 'linux') {
          return ctx.skip('setOpacity is unsupported on Linux');
        }
        const { BrowserWindow } = require('electron');
        process.env.EM_TEST_SHOW = '1';
        try {
          // Never shown — opacity alone proves the hook skipped it, without any
          // risk of activating the test process mid-run.
          const win = new BrowserWindow({ show: false, width: 120, height: 80 });
          ctx.expect(win.getOpacity()).toBe(1);
          win.destroy();
        } finally {
          delete process.env.EM_TEST_SHOW;
        }
      },
    },
  ],
};
