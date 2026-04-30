// Preload sentry — minimal. The renderer SDK takes over once the renderer initializes; the preload
// scope is small and short-lived. We don't init a separate SDK here, but we expose a tiny surface
// the preload script can call if it ever wants to log a setup error before the renderer loads.

const { resolveConfig, logger } = require('./core.js');

const preload = {
  _enabled: false,

  initialize(manager) {
    const { shouldEnable, reason } = resolveConfig(manager);
    preload._enabled = shouldEnable;
    if (!shouldEnable) logger.log(`preload disabled — ${reason}`);
  },

  // Forward to renderer SDK if it exists in this context (it should, after the renderer module
  // initializes). Otherwise no-op — preload is short-lived.
  captureException(error) {
    if (!preload._enabled) return;
    try {
      const Sentry = require('@sentry/electron/renderer');
      Sentry.captureException(error);
    } catch (e) { /* sentry not available */ }
  },
};

module.exports = preload;
