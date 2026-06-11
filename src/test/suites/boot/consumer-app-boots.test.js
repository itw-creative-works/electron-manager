// Boot-layer self-test — EM's analog of "does the extension load?" (BXM) / "does the
// site boot?" (UJM). The boot runner webpack-builds the bundled fixture consumer
// (src/test/fixtures/consumer-app) into a real dist/main.bundle.js, spawns Electron with
// it (the actual production boot path — bundled, not the unbundled lib code that the
// `main` layer exercises), then runs these inspects against the live manager.
//
// In EM's own test run, EM_TEST_BOOT_PROJECT points at the fixture (auto-set in
// src/commands/test.js when the cwd is the electron-manager repo). In a real consumer's
// `npx mgr test` run, the framework boot/ suites are excluded entirely (runner.js
// discovery skips boot/** unless isFrameworkSelfTest) — consumers write their own
// boot tests under <cwd>/test/boot/.
//
// NOTE: inspect bodies are serialized to the spawned Electron process — no closures over
// module scope. `require`, `process`, and `Buffer` are injected; { manager, expect,
// projectRoot } is the inspect argument (projectRoot = the fixture root).

module.exports = {
  type: 'group',
  layer: 'boot',
  description: 'fixture consumer app — boots end-to-end (real bundle)',
  timeout: 30000,
  tests: [
    {
      description: 'manager initialized with all core libs wired',
      inspect: async ({ manager, expect }) => {
        expect(manager).toBeTruthy();
        expect(manager._initialized).toBe(true);
        for (const lib of ['storage', 'ipc', 'windows', 'tray', 'menu', 'contextMenu', 'webManager']) {
          expect(Boolean(manager[lib])).toBe(true);
        }
      },
    },

    {
      description: 'the fixture main.js created the main window and loaded the built view',
      inspect: async ({ manager, expect }) => {
        const { BrowserWindow } = require('electron');

        // windows.create() runs inside the consumer's initialize().then(); poll for it.
        let url = '';
        for (let i = 0; i < 40; i++) {
          const win = manager.windows.get('main') || BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            url = win.webContents.getURL();
            if (url.includes('/views/main/')) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        expect(Boolean(manager.windows.get('main'))).toBe(true);
        expect(url.includes('/views/main/')).toBe(true);
      },
    },

    {
      description: 'webpack produced the real production bundle + view on disk',
      inspect: async ({ expect, projectRoot }) => {
        const fs = require('fs');
        const path = require('path');
        expect(fs.existsSync(path.join(projectRoot, 'dist', 'main.bundle.js'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, 'dist', 'views', 'main', 'index.html'))).toBe(true);
      },
    },
  ],
};
