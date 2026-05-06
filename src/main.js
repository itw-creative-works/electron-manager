// Main-process Manager singleton.
// Consumer entry: `new (require('electron-manager/main'))().initialize(require('../config/electron-manager.json'))`.
// Boot sequence below — each step delegates to a `lib/*.js` module. Stubs today, real impls land in pass 2.

const LoggerLite = require('./lib/logger-lite.js');

const storage     = require('./lib/storage.js');
const sentry      = require('./lib/sentry/index.js');
const protocol    = require('./lib/protocol.js');
const deepLink    = require('./lib/deep-link.js');
const appState    = require('./lib/app-state.js');
const ipc         = require('./lib/ipc.js');
const autoUpdater = require('./lib/auto-updater.js');
const tray        = require('./lib/tray.js');
const menu        = require('./lib/menu.js');
const ctxMenu     = require('./lib/context-menu.js');
const startup     = require('./lib/startup.js');
const wmBridge    = require('./lib/web-manager-bridge.js');
const windows     = require('./lib/window-manager.js');

function Manager() {
  const self = this;

  self.config = null;
  self.logger = new LoggerLite('main');

  // Quit-vs-hide gating. The window-manager `close` handler checks `_allowQuit` /
  // `_isQuitting` before deciding whether to actually close (=quit) or to swallow
  // the event and just hide the window. Set true via `manager.quit({ force: true })`,
  // by `app.on('before-quit')` (any user-initiated quit), and by the auto-updater
  // when it's about to call `quitAndInstall()`.
  self._allowQuit  = false;
  self._isQuitting = false;

  // Public lib references (consumer code can call them by name)
  self.storage     = storage;
  self.sentry      = sentry;
  self.protocol    = protocol;
  self.deepLink    = deepLink;
  self.appState    = appState;
  self.ipc         = ipc;
  self.autoUpdater = autoUpdater;
  self.tray        = tray;
  self.menu        = menu;
  self.contextMenu = ctxMenu;
  self.startup     = startup;
  self.webManager  = wmBridge;
  self.windows     = windows;

  return self;
}

// Force a real quit, bypassing per-window `hideOnClose`. Use this anywhere the
// app legitimately wants to exit (tray Quit, Cmd+Q from menu role:'quit',
// auto-updater install). Without `{ force: true }`, the close events still get
// trapped by hide-on-close handlers and the app stays running.
Manager.prototype.quit = function (options) {
  const self = this;
  options = options || {};

  if (options.force) {
    self._allowQuit = true;
  }

  try {
    require('electron').app.quit();
  } catch (e) { /* electron not available — no-op in test/headless */ }
};

// Force a relaunch — same gating as quit, but tells electron to start back up
// after exit. If an update has been downloaded, prefers `quitAndInstall()` so
// the user lands on the new version instead of the old one.
Manager.prototype.relaunch = function (options) {
  const self = this;
  options = options || {};

  if (options.force) {
    self._allowQuit = true;
  }

  let electron;
  try { electron = require('electron'); } catch (e) { return; }

  // If updater downloaded a fresh build, install + relaunch via electron-updater
  // (which calls `app.quit()` internally with the right post-quit script). Falls
  // back to plain relaunch if updater hasn't downloaded anything.
  try {
    const updaterStatus = self.autoUpdater?.getStatus?.();
    if (updaterStatus?.code === 'downloaded' && self.autoUpdater?.installNow) {
      return self.autoUpdater.installNow();
    }
  } catch (_) { /* fall through */ }

  electron.app.relaunch();
  electron.app.quit();
};

Manager.prototype.initialize = async function (consumerConfig, options) {
  const self = this;

  // Accept either a parsed config object, a string path to a JSON5 file, or nothing.
  // Default config resolution order (when called with no arg):
  //   1. EM_BUILD_JSON.config — injected at build time by webpack DefinePlugin. This is
  //      authoritative in packaged apps because config/electron-manager.json is inside the
  //      asar — not loadable as JSON5 from disk. EM_BUILD_JSON is a snapshot of that exact
  //      file taken at build time.
  //   2. <appRoot>/config/electron-manager.json — fallback for dev mode where EM is loaded
  //      directly (no webpack bundling). appRoot resolves to the consumer's project dir.
  if (typeof consumerConfig === 'string') {
    consumerConfig = loadConfigFromFile(consumerConfig);
  } else if (!consumerConfig) {
    // Try EM_BUILD_JSON (set by DefinePlugin in packaged builds) first.
    if (typeof EM_BUILD_JSON !== 'undefined' && EM_BUILD_JSON?.config) {
      consumerConfig = EM_BUILD_JSON.config;
    } else {
      const path = require('path');
      const appRoot = require('./utils/app-root.js')();
      consumerConfig = loadConfigFromFile(path.join(appRoot, 'config', 'electron-manager.json'));
    }
  }

  self.config = consumerConfig || {};
  self._options = options || {};

  self.logger.log(`Initializing electron-manager (main)... pid=${process.pid} platform=${process.platform} arch=${process.arch} packaged=${!!require('electron')?.app?.isPackaged} argv=${JSON.stringify(process.argv.slice(1))}`);

  // electron is a peer dep — require lazily so this file can be loaded outside Electron for tests
  let electron;
  try {
    electron = require('electron');
  } catch (e) {
    self.logger.warn('electron not available — main Manager running in test/scaffold mode.');
  }

  // Lifecycle event logging. These are the high-signal app-level events worth tracing
  // when something goes wrong — quit reasons, window-all-closed, will-finish-launching,
  // ready, render-process-gone, child-process-gone. All cheap to log; one line each.
  if (electron?.app?.on) {
    const app = electron.app;
    app.on('before-quit', () => {
      self._isQuitting = true;
      self.logger.log('app event: before-quit (entering quit sequence — close events bypass hide-on-close)');
    });
    app.on('will-quit', () => self.logger.log('app event: will-quit'));
    app.on('quit', (_e, exitCode) => self.logger.log(`app event: quit code=${exitCode}`));
    app.on('window-all-closed', () => self.logger.log('app event: window-all-closed'));
    app.on('render-process-gone', (_e, webContents, details) => self.logger.warn(`app event: render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`));
    app.on('child-process-gone', (_e, details) => self.logger.warn(`app event: child-process-gone type=${details?.type} reason=${details?.reason} exitCode=${details?.exitCode}`));
    app.on('activate', () => self.logger.log('app event: activate (macOS — dock click or app re-launch)'));
    app.on('open-url', (_e, url) => self.logger.log(`app event: open-url url=${url}`));
    app.on('open-file', (_e, p) => self.logger.log(`app event: open-file path=${p}`));
  }

  // Process-level signals that bypass Electron's app events. Catches uncaught exceptions
  // so we never crash silently — combined with electron-log file transport, this means
  // ANY unhandled throw lands in runtime.log rather than disappearing into stderr.
  process.on('uncaughtException', (e) => {
    self.logger.error(`uncaughtException: ${e?.stack || e?.message || String(e)}`);
  });
  process.on('unhandledRejection', (reason) => {
    self.logger.error(`unhandledRejection: ${reason?.stack || reason?.message || String(reason)}`);
  });
  process.on('exit', (code) => {
    // electron-log's file transport flushes synchronously, so this last line lands.
    self.logger.log(`process exit code=${code}`);
  });

  // 1. Apply early startup-mode hide. For `mode: 'hidden'` we call app.dock.hide() *before*
  //    anything else so macOS spends as little time animating the dock entry as possible.
  //    In packaged builds the Info.plist's LSUIElement (injected by gulp/build-config when
  //    startup.mode === 'hidden') prevents the bounce entirely.
  self.startup._manager = self;
  self.startup._electron = electron || null;
  self.startup.applyEarly();

  // 2. IPC bus online first — storage and other libs register handlers on it
  self.ipc.initialize(self);

  // 3. Storage (precedes sentry + auth so opt-out + persisted session are honored)
  await self.storage.initialize(self);

  // 4. Sentry (earliest catchable global handler)
  self.sentry.initialize(self);

  // 5. Protocol (single-instance lock + custom URL scheme)
  self.protocol.initialize(self);

  if (!self.protocol.hasSingleInstanceLock()) {
    self.logger.warn('Single-instance lock lost. Quitting.');
    electron?.app?.quit?.();
    return self;
  }

  // 6. Deep links (parse cold-start argv, install second-instance handler)
  self.deepLink.initialize(self);

  // 7. App state (first-launch / crash / startup-context flags)
  await self.appState.initialize(self);

  // 8. Wait for app readiness before any UI
  if (electron?.app?.whenReady) {
    await electron.app.whenReady();
  }

  // 9. Auto-updater (queues check, never blocks UI)
  self.autoUpdater.initialize(self);

  // 10. Tray + menu + context menu
  self.tray.initialize(self);
  self.menu.initialize(self);
  self.contextMenu.initialize(self);

  // 11. Open-at-login + hide-on-startup state sync
  self.startup.initialize(self);

  // 12. Web-manager bridge (main-side Firebase Auth source of truth, IPC handlers for renderers)
  await self.webManager.initialize(self);

  // 13. Initialize the windows lib — registers app-level handlers (window-all-closed, etc.)
  //     but does NOT create any windows. Consumers are responsible for calling
  //     `manager.windows.create('main')` (or any other named window) from their main.js
  //     when they want to surface UI. This makes hidden / agent-app patterns trivial:
  //     just don't call create() until something (tray click, deep link, IPC) warrants it.
  self.windows.initialize(self);

  self._initialized = true;
  self.logger.log('electron-manager (main) initialized.');

  // Boot test harness — runs against the live manager AFTER all libs are up. Test runner
  // sets EM_TEST_BOOT=1 + EM_TEST_BOOT_HARNESS=<absolute path> + EM_TEST_BOOT_SPEC=<path>
  // before spawning electron. The harness emits __EM_TEST__ JSON lines on stdout (parsed
  // by runners/boot.js) then app.exit()s.
  //
  // We use a runtime env-var path (not a static `require('./test/harness/...')`) because
  // EM is webpacked into the consumer's bundle, and a static require would either get
  // inlined (bundling test code into production) or dead-code-eliminated. An env-var
  // path stays external and can only resolve when the runner sets it.
  if (process.env.EM_TEST_BOOT === '1') {
    global.__em_manager = self;
    const harnessPath = process.env.EM_TEST_BOOT_HARNESS;
    if (harnessPath) {
      // Defer the harness so the consumer's `manager.initialize().then(() => { ... })`
      // callback gets a chance to run first. EM doesn't auto-create any windows; the
      // consumer's main.js does it inside .then(). If we ran the harness synchronously
      // here, that callback wouldn't have fired yet and `manager.windows.get('main')`
      // would be null. setImmediate flushes the microtask queue (where promise callbacks
      // live) before our boot harness inspects state.
      setImmediate(() => {
        try {
          // __non_webpack_require__ is webpack's magic escape hatch — preserves a runtime
          // require() that webpack won't try to inline. In plain Node it's undefined, so
          // `typeof` gates the branch without ReferenceError.
          // eslint-disable-next-line import/no-dynamic-require, global-require, no-undef
          const realRequire = (typeof __non_webpack_require__ !== 'undefined') ? __non_webpack_require__ : require;
          const harness = realRequire(harnessPath);
          harness.run(self);
        } catch (e) {
          const { app } = require('electron');
          process.stdout.write(`__EM_TEST__${JSON.stringify({ event: 'fatal', message: `boot harness failed to load: ${e.message}` })}\n`);
          app.exit(1);
        }
      });
    } else {
      const { app } = require('electron');
      process.stdout.write(`__EM_TEST__${JSON.stringify({ event: 'fatal', message: 'EM_TEST_BOOT=1 but EM_TEST_BOOT_HARNESS not set' })}\n`);
      app.exit(1);
    }
  }

  return self;
};

function loadConfigFromFile(filepath) {
  const fs = require('fs');
  // json5 is bundled via webpack — handle both interop shapes (`.parse` vs `.default.parse`)
  // depending on how webpack's __esModule wrapping resolves at the call site.
  const json5Mod = require('json5');
  const JSON5 = json5Mod.parse ? json5Mod : (json5Mod.default || json5Mod);

  if (!fs.existsSync(filepath)) {
    return {};
  }

  return JSON5.parse(fs.readFileSync(filepath, 'utf8'));
}

// Environment + API URL helpers — mirror web-manager's contract so EM apps can
// hit the same dev/prod backends as UJM and BXM consumers.

Manager.prototype.isDevelopment = function () {
  return (this.config?.em?.environment || 'production') === 'development';
};

Manager.prototype.getEnvironment = function () {
  return this.config?.em?.environment || 'production';
};

Manager.prototype.getFunctionsUrl = function (environment) {
  const env = environment || this.getEnvironment();
  const projectId = this.config?.firebaseConfig?.projectId;

  if (!projectId) {
    throw new Error('firebaseConfig.projectId not set in config/electron-manager.json');
  }

  if (env === 'development') {
    return `http://localhost:5001/${projectId}/us-central1`;
  }

  return `https://us-central1-${projectId}.cloudfunctions.net`;
};

Manager.prototype.getApiUrl = function (environment) {
  const env = environment || this.getEnvironment();

  if (env === 'development') {
    return 'http://localhost:5002';
  }

  // Prod: api.<authDomain>. Mirrors web-manager.getApiUrl behavior.
  const authDomain = this.config?.firebaseConfig?.authDomain;
  if (!authDomain) {
    throw new Error('firebaseConfig.authDomain not set in config/electron-manager.json');
  }

  return `https://api.${authDomain}`;
};

module.exports = Manager;
