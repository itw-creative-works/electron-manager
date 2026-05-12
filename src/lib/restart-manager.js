// Restart Manager — auxiliary tiny app that handles restarting/relaunching this
// app on behalf of EM. Same idea as legacy electron-manager: this app sends a
// `restart-manager://message?command=register|unregister&payload=<json>` URL via
// `shell.openExternal`, restart-manager itself is the registered handler for that
// scheme, and it relaunches us cleanly from outside our own process tree.
//
// Why an external helper? On all three OSes there are restart edge cases
// (post-update install, hidden-mode rehydrate, crashed-then-relaunch) where you
// can't reliably restart yourself from inside your own quitting process. RM is
// always alive, so it can wait, observe, and re-launch.
//
// Lifecycle:
//   1. After whenReady (15s prod / 3s dev) → setupRestartManager('register').
//   2. On clean before-quit → setupRestartManager('unregister').
//   3. setupRestartManager probes `app.getApplicationNameForProtocol('restart-manager')`.
//      - returns a real handler (not 'Electron' / not '') → openExternal the URL.
//      - returns 'Electron' (means we're the only handler — i.e. running unpackaged
//        in dev with no installed RM) → skip silently in dev unless EM_RESTART_MANAGER_DEV=1.
//      - returns nothing → handler isn't installed → ensureInstalled() then retry.
//
// ensureInstalled() per platform:
//   mac     — download Restart-Manager-mac.zip → unzip into appData/Restart Manager/
//             resources/Restart Manager.app → `open` it. No DMG mount, no Volumes flash,
//             no prompts. The zip is already signed + notarized (electron-builder
//             produces it as part of the normal mac release).
//   win     — download Restart-Manager-Setup.exe → spawn it. NSIS one-click installer
//             pops briefly. There's no clean unzipped path on Windows due to per-machine
//             vs per-user signing semantics.
//   linux   — open the .deb URL in the user's browser. We don't `sudo apt install` —
//             that requires a TTY or pkexec dance we can't guarantee.
//
// Bail conditions (any one means we don't even try):
//   - manager.config.brand.id === 'restart-manager' (RM doesn't restart-manager itself)
//   - config.restartManager.enabled === false
//   - manager.isDevelopment() && !process.env.EM_RESTART_MANAGER_DEV (skip dev noise)
//   - 3 install attempts already burned in this process (legacy budget)

const path       = require('path');
const fs         = require('fs');
const https      = require('https');
const { spawn }  = require('child_process');
const jetpack    = require('fs-jetpack');
const LoggerLite = require('./logger-lite.js');
const sanitizeURL = require('../utils/sanitize-url.js');

const logger = new LoggerLite('restart-manager');

// Public restart-manager-download-server URLs — installer tag, stable filenames.
// These are framework constants because consumers don't fork RM. If a consumer
// ever needs a private mirror (air-gapped enterprise install), they can override
// post-init by reassigning `manager.restartManager._urls`. Not a config field.
const URLS = Object.freeze({
  mac:     'https://github.com/restart-manager/download-server/releases/download/installer/Restart-Manager-mac.zip',
  windows: 'https://github.com/restart-manager/download-server/releases/download/installer/Restart-Manager-Setup.exe',
  linux:   'https://github.com/restart-manager/download-server/releases/download/installer/restart-manager_amd64.deb',
});

const MAX_INSTALL_ATTEMPTS = 3;
const REGISTER_DELAY_PROD_MS = 15000;
const REGISTER_DELAY_DEV_MS  = 3000;

const restartManager = {
  _initialized:     false,
  _manager:         null,
  _enabled:         true,
  _registered:      false,
  _installAttempts: 0,
  _registerTimer:   null,
  _urls:            URLS,                  // overridable for tests/private mirrors

  initialize(manager) {
    if (restartManager._initialized) return;
    restartManager._initialized = true;
    restartManager._manager = manager;

    const cfg = manager.config.restartManager || {};
    restartManager._enabled = cfg.enabled !== false;     // default on

    // Bail #1: test mode. Absolutely nothing fires — no register, no unregister,
    // no probe, no download, no shell.openExternal. Tests should never poke real
    // OS state (protocol handlers, downloads dir, /Applications). The public
    // methods (register/unregister/ensureInstalled/_send) also re-check this so
    // a test that manually invokes one of them stays a no-op too.
    if (manager.isTesting()) {
      logger.log('skipping (test mode).');
      restartManager._enabled = false;       // force-disable so direct calls bail too
      return;
    }

    // Bail #2: this app IS restart-manager. RM doesn't manage itself.
    if (manager.config.brand.id === 'restart-manager') {
      logger.log('skipping (this app is restart-manager itself).');
      return;
    }

    // Bail #3: explicitly disabled by config.
    if (!restartManager._enabled) {
      logger.log('restartManager.enabled=false — skipping.');
      return;
    }

    // Bail #4: dev mode unless explicitly opted in. Avoids spam during local dev
    // where RM almost certainly isn't installed and we'd just thrash retries.
    const devOptIn = process.env.EM_RESTART_MANAGER_DEV === '1';
    if (manager.isDevelopment() && !devOptIn) {
      logger.log('skipping in dev (set EM_RESTART_MANAGER_DEV=1 to test).');
      return;
    }

    // Schedule register after whenReady. Use a single timer so re-init guards
    // don't pile up timers; tests can shutdown() to clear it.
    const { app } = require('electron');
    const delay = manager.isDevelopment() ? REGISTER_DELAY_DEV_MS : REGISTER_DELAY_PROD_MS;
    app.whenReady().then(() => {
      restartManager._registerTimer = setTimeout(() => {
        restartManager.register().catch((e) => logger.warn(`register failed: ${e.message}`));
      }, delay);
    });

    // On clean before-quit, unregister so RM stops watching us.
    app.on('before-quit', () => {
      restartManager.unregister().catch((e) => logger.warn(`unregister failed: ${e.message}`));
    });

    logger.log(`restart-manager initialized — register scheduled in ${delay}ms.`);
  },

  // ─── Public API ─────────────────────────────────────────────────────────────

  async register()   { return restartManager._send('register'); },
  async unregister() { return restartManager._send('unregister'); },

  // Force the install path. Useful for "Reinstall Restart Manager" UI.
  async ensureInstalled() {
    if (restartManager._manager.isTesting()) {
      logger.log('ensureInstalled — skipping in test mode.');
      return;
    }
    return restartManager._installRM();
  },

  // ─── Internals ──────────────────────────────────────────────────────────────

  // Build + send the restart-manager:// URL. If RM isn't installed, fall through
  // to download + install + retry once.
  async _send(command) {
    if (!restartManager._enabled) return;
    if (restartManager._manager.isTesting()) {
      logger.log(`_send(${command}) — skipping in test mode.`);
      return;
    }

    const manager = restartManager._manager;
    const { app, shell } = require('electron');

    const url = restartManager._buildUrl(command);
    // getApplicationNameForProtocol is sync. Returns the registered app name,
    // 'Electron' if we're the only handler (dev), or '' if no handler exists.
    const handler = app.getApplicationNameForProtocol('restart-manager://') || '';

    logger.log(`_send(${command}) handler="${handler}"`);

    // 'Electron' means we're the registered handler ourselves (running unpackaged
    // and macOS picked us as the protocol owner) — i.e. real RM isn't installed.
    // Empty string also means not installed.
    const installed = handler && handler !== 'Electron';

    if (installed) {
      try {
        await shell.openExternal(url);
        if (command === 'register')   restartManager._registered = true;
        if (command === 'unregister') restartManager._registered = false;
        return;
      } catch (e) {
        logger.warn(`openExternal failed: ${e.message}`);
        // Fall through to install path on openExternal failure.
      }
    }

    // Not installed (or openExternal blew up). Install + retry once.
    if (restartManager._installAttempts >= MAX_INSTALL_ATTEMPTS) {
      logger.warn(`install attempts exhausted (${MAX_INSTALL_ATTEMPTS}); giving up.`);
      return;
    }

    restartManager._installAttempts++;
    try {
      await restartManager._installRM();
    } catch (e) {
      logger.warn(`install failed: ${e.message}`);
      return;
    }

    // After install, give the OS a beat to pick up the new protocol handler,
    // then re-send. Single retry — if THIS one fails too, we'll wait for the
    // next `register`/`unregister` call rather than loop here.
    setTimeout(() => {
      restartManager._send(command).catch((e) => logger.warn(`retry failed: ${e.message}`));
    }, 5000);
  },

  _buildUrl(command) {
    const manager = restartManager._manager;
    const { app } = require('electron');

    const url = new URL('restart-manager://message');
    const payload = {
      name:        app.getName(),
      id:          manager.config.brand.id,
      path:        app.getPath('exe'),
      environment: manager.getEnvironment(),
    };
    url.searchParams.set('command', command);
    url.searchParams.set('payload', JSON.stringify(payload));
    return url.toString();
  },

  // Per-platform install. Mac/Windows download + invoke; Linux opens the .deb URL
  // in the browser (no sudo prompt).
  async _installRM() {
    if (restartManager._manager.isTesting()) {
      logger.log('_installRM — skipping in test mode.');
      return;
    }
    const { app, shell } = require('electron');

    const platform = process.platform;
    const url = platform === 'darwin' ? restartManager._urls.mac
              : platform === 'win32'  ? restartManager._urls.windows
              :                         restartManager._urls.linux;
    if (!url) throw new Error(`no install URL for platform=${platform}`);

    const resourcesDir = path.join(app.getPath('appData'), 'Restart Manager', 'resources');
    jetpack.dir(resourcesDir);

    if (platform === 'linux') {
      // No silent install on linux — just open the .deb in the browser. The user
      // double-clicks, their package manager (Software Center, gdebi, etc.) takes
      // it from there. No sudo prompt from us.
      const safe = sanitizeURL(url);
      if (!safe) {
        logger.warn(`refused to openExternal non-http(s) URL: ${url}`);
        return;
      }
      logger.log(`opening linux installer URL in browser: ${safe}`);
      await shell.openExternal(safe);
      return;
    }

    const filename = url.split('/').pop();
    const filePath = path.join(resourcesDir, filename);

    logger.log(`downloading ${url} → ${filePath}`);
    await downloadFile(url, filePath);

    if (platform === 'darwin') {
      // Unzip into resources/. The zip's top-level entry is `Restart Manager.app`.
      const extractZip = require('extract-zip');
      const appPath = path.join(resourcesDir, 'Restart Manager.app');
      if (jetpack.exists(appPath)) {
        // Replace any prior copy. process.noAsar so jetpack walks into asar dirs.
        const prev = process.noAsar;
        process.noAsar = true;
        try { jetpack.remove(appPath); } finally { process.noAsar = prev; }
      }
      await extractZip(filePath, { dir: resourcesDir });
      logger.log(`extracted to ${appPath}; opening...`);
      // `open` registers the app with LaunchServices (so getApplicationNameForProtocol
      // returns it next call) and starts it.
      await new Promise((resolve, reject) => {
        const child = spawn('open', [appPath], { detached: true, stdio: 'ignore' });
        child.on('error', reject);
        child.unref();
        resolve();
      });
      return;
    }

    if (platform === 'win32') {
      // Spawn the NSIS installer. It pops briefly, registers itself with the OS
      // protocol-handler list, and exits.
      logger.log(`spawning windows installer ${filePath}`);
      await new Promise((resolve, reject) => {
        const child = spawn(filePath, [], { detached: true, stdio: 'ignore' });
        child.on('error', reject);
        child.unref();
        resolve();
      });
      return;
    }
  },

  // Test teardown.
  shutdown() {
    if (restartManager._registerTimer) {
      clearTimeout(restartManager._registerTimer);
      restartManager._registerTimer = null;
    }
    restartManager._initialized     = false;
    restartManager._manager         = null;
    restartManager._registered      = false;
    restartManager._installAttempts = 0;
  },
};

// Plain HTTPS download helper. Follows redirects (GitHub release assets 302 to S3).
function downloadFile(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part`;
    const out = fs.createWriteStream(tmp);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        out.close();
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        return downloadFile(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        out.close();
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try { fs.renameSync(tmp, dest); resolve(); }
          catch (e) { reject(e); }
        });
      });
    });
    req.on('error', (e) => {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      reject(e);
    });
  });
}

restartManager._downloadFile = downloadFile;     // exposed for tests

module.exports = restartManager;
