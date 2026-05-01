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

Manager.prototype.initialize = async function (consumerConfig, options) {
  const self = this;

  // Accept either a parsed config object, a string path to a JSON5 file, or nothing.
  // Default: load `config/electron-manager.json` from the app's working directory.
  if (typeof consumerConfig === 'string') {
    consumerConfig = loadConfigFromFile(consumerConfig);
  } else if (!consumerConfig) {
    const path = require('path');
    consumerConfig = loadConfigFromFile(path.join(process.cwd(), 'config', 'electron-manager.json'));
  }

  self.config = consumerConfig || {};
  self._options = options || {};

  self.logger.log('Initializing electron-manager (main)...');

  // electron is a peer dep — require lazily so this file can be loaded outside Electron for tests
  let electron;
  try {
    electron = require('electron');
  } catch (e) {
    self.logger.warn('electron not available — main Manager running in test/scaffold mode.');
  }

  // 1. Apply early startup-mode hide. For hidden/tray-only we call app.dock.hide() *before* anything
  //    else so macOS spends as little time animating the dock entry as possible. In packaged tray-only
  //    builds the Info.plist's LSUIElement (injected by gulp/build-config) prevents the bounce entirely.
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

  // 13. Conditionally show the main window. Skipped in test mode and in hidden/tray-only startup modes —
  //     the consumer is expected to surface the UI themselves (tray click, deep link, IPC).
  self.windows.initialize(self);
  const shouldAutoCreate = !self._options.skipWindowCreation && !self.startup.isLaunchHidden();
  if (shouldAutoCreate) {
    await self.windows.createNamed('main', self);
  }

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
  const JSON5 = require('json5');

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
