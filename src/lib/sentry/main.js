// Main-process sentry wiring. Uses @sentry/electron/main when enabled.
// Captures uncaughtException + unhandledRejection automatically (the SDK installs handlers).
// Provides setUser / captureException / captureMessage forwarding for explicit reporting.

const { resolveConfig, normalizeUser, resolveRelease, logger } = require('./core.js');

const main = {
  _initialized: false,
  _enabled:     false,
  _manager:     null,
  _Sentry:      null,

  initialize(manager) {
    main._manager = manager;
    main._initialized = true;

    const { shouldEnable, options, reason } = resolveConfig(manager);
    if (!shouldEnable) {
      logger.log(`disabled — ${reason}`);
      main._enabled = false;
      return;
    }

    let Sentry;
    try {
      Sentry = require('@sentry/electron/main');
    } catch (e) {
      logger.warn(`@sentry/electron not installed — sentry disabled. (${e.message})`);
      main._enabled = false;
      return;
    }

    Sentry.init({
      dsn:               options.dsn,
      environment:       options.environment,
      release:           resolveRelease(manager) || undefined,
      tracesSampleRate:  options.tracesSampleRate,
      attachScreenshot:  options.attachScreenshot,
    });

    main._Sentry = Sentry;
    main._enabled = true;
    logger.log(`initialized — env=${options.environment} release=${resolveRelease(manager)}`);
  },

  setUser(user) {
    if (!main._enabled) return;
    const normalized = normalizeUser(user);
    main._Sentry.setUser(normalized);
  },

  captureException(error, extra) {
    if (!main._enabled) {
      logger.warn(`captureException (no-op, sentry disabled): ${error?.message || error}`);
      return;
    }
    main._Sentry.captureException(error, extra ? { extra } : undefined);
  },

  captureMessage(message, level) {
    if (!main._enabled) {
      logger.log(`captureMessage (no-op, sentry disabled): ${message}`);
      return;
    }
    main._Sentry.captureMessage(message, level);
  },

  // Used by tests to reset state between cases.
  shutdown() {
    main._initialized = false;
    main._enabled     = false;
    main._Sentry      = null;
  },
};

module.exports = main;
