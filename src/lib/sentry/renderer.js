// Renderer-process sentry wiring. Uses @sentry/electron/renderer.
// Window error + unhandledrejection events are captured automatically by the SDK.

const { resolveConfig, normalizeUser, resolveRelease, logger } = require('./core.js');

const renderer = {
  _initialized: false,
  _enabled:     false,
  _Sentry:      null,

  initialize(manager) {
    renderer._initialized = true;
    const { shouldEnable, options, reason } = resolveConfig(manager);
    if (!shouldEnable) {
      logger.log(`renderer disabled — ${reason}`);
      renderer._enabled = false;
      return;
    }

    let Sentry;
    try {
      Sentry = require('@sentry/electron/renderer');
    } catch (e) {
      logger.warn(`@sentry/electron not installed — sentry disabled. (${e.message})`);
      return;
    }

    Sentry.init({
      dsn:              options.dsn,
      environment:      options.environment,
      release:          resolveRelease(manager) || undefined,
      tracesSampleRate: options.tracesSampleRate,
    });

    renderer._Sentry = Sentry;
    renderer._enabled = true;
    logger.log(`renderer initialized — env=${options.environment}`);
  },

  setUser(user) {
    if (!renderer._enabled) return;
    renderer._Sentry.setUser(normalizeUser(user));
  },

  captureException(error, extra) {
    if (!renderer._enabled) return;
    renderer._Sentry.captureException(error, extra ? { extra } : undefined);
  },

  captureMessage(message, level) {
    if (!renderer._enabled) return;
    renderer._Sentry.captureMessage(message, level);
  },
};

module.exports = renderer;
