// Protocol — single-instance lock + custom URL scheme registration.
//
// Two responsibilities:
//   1. Acquire the OS-level single-instance lock so only one copy of the app runs at a time.
//      If the lock is lost, the user already had the app open — the OS forwarded our argv
//      to that instance via the second-instance event (handled by lib/deep-link.js).
//   2. Register `<brand.id>://` URLs with the OS so the system routes them to this app.
//      On macOS this also enables the open-url event. The scheme is always brand.id —
//      no config knob.

const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('protocol');

const protocol = {
  _initialized: false,
  _manager:     null,
  _electron:    null,
  _hasLock:     true,
  _schemes:     [],

  initialize(manager) {
    if (protocol._initialized) {
      return;
    }

    protocol._manager = manager;

    try {
      protocol._electron = require('electron');
    } catch (e) {
      logger.warn(`electron not available — protocol running in no-op mode. (${e.message})`);
      protocol._initialized = true;
      return;
    }

    const { app } = protocol._electron;
    if (!app) {
      protocol._initialized = true;
      return;
    }

    // Single-instance lock. If we don't get it, the original instance got our argv
    // via second-instance and we should exit immediately.
    if (typeof app.requestSingleInstanceLock === 'function') {
      protocol._hasLock = app.requestSingleInstanceLock();
      if (!protocol._hasLock) {
        logger.warn('single-instance lock lost — another copy of the app is running.');
      } else {
        logger.log('single-instance lock acquired.');
      }
    }

    // Register custom URL scheme. Always derived from brand.id — `<brand.id>://...` is
    // the one and only scheme. No config knob; if you need multiple schemes for the same app,
    // call `app.setAsDefaultProtocolClient(extra)` yourself in main.js.
    const schemes = [];
    const brandId = manager?.config?.brand?.id;
    if (brandId) schemes.push(brandId);
    protocol._schemes = schemes;
    if (typeof app.setAsDefaultProtocolClient === 'function') {
      schemes.forEach((scheme) => {
        try {
          // Windows + Linux need argv passing for cold-start to work properly when
          // launched from `app.exe scheme://...` style invocations during dev.
          if (process.platform === 'win32' || process.platform === 'linux') {
            app.setAsDefaultProtocolClient(scheme, process.execPath, [process.cwd()]);
          } else {
            app.setAsDefaultProtocolClient(scheme);
          }
        } catch (e) {
          logger.error(`failed to register scheme "${scheme}":`, e);
        }
      });
      logger.log(`registered schemes=${JSON.stringify(schemes)}`);
    }

    protocol._initialized = true;
  },

  hasSingleInstanceLock() {
    return protocol._hasLock;
  },

  getSchemes() {
    return protocol._schemes.slice();
  },

  // Returns true if the given URL begins with one of our registered schemes.
  isOurScheme(url) {
    if (typeof url !== 'string') return false;
    return protocol._schemes.some((scheme) => url.startsWith(`${scheme}://`));
  },
};

module.exports = protocol;
