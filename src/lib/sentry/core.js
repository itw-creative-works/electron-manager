// Shared sentry helpers — config parsing, dev-mode gating, user context normalization.
// Used by main / renderer / preload sentry wrappers.

const LoggerLite = require('../logger-lite.js');
const logger = new LoggerLite('sentry');

const DEFAULTS = {
  enabled:        true,
  dsn:            '',
  environment:    null,                  // null = auto-detect from EM_BUILD_MODE
  tracesSampleRate: 0.1,
  attachScreenshot: false,
};

// Resolve runtime config + decide whether sentry should boot.
// Returns { shouldEnable, options, reason } where options is the resolved sentry-init opts.
function resolveConfig(manager) {
  const cfg = (manager && manager.config && manager.config.sentry) || {};
  const opts = { ...DEFAULTS, ...cfg };

  if (process.env.EM_SENTRY_ENABLED === 'false') {
    return { shouldEnable: false, options: opts, reason: 'EM_SENTRY_ENABLED=false' };
  }
  if (opts.enabled === false) {
    return { shouldEnable: false, options: opts, reason: 'config.sentry.enabled=false' };
  }
  if (!opts.dsn) {
    return { shouldEnable: false, options: opts, reason: 'no dsn set' };
  }

  // Dev gating: in development, default to disabled unless EM_SENTRY_FORCE=true.
  const isProduction = process.env.EM_BUILD_MODE === 'true';
  const forced = process.env.EM_SENTRY_FORCE === 'true';
  if (!isProduction && !forced) {
    return { shouldEnable: false, options: opts, reason: 'dev mode (set EM_SENTRY_FORCE=true to override)' };
  }

  // Default environment from build mode.
  if (!opts.environment) opts.environment = isProduction ? 'production' : 'development';

  return { shouldEnable: true, options: opts, reason: null };
}

// Normalize a web-manager / firebase user object into the minimal shape Sentry wants.
// Only the safe fields — never email if `sentry.scrubEmail` is true (default false).
function normalizeUser(user, opts = {}) {
  if (!user) return null;
  const out = {};
  if (user.uid)         out.id = user.uid;
  else if (user.id)     out.id = user.id;
  if (user.email && !opts.scrubEmail) out.email = user.email;
  return Object.keys(out).length === 0 ? null : out;
}

// Resolve the app version. Routes through the cross-context `manager.getVersion()`
// helper (src/utils/mode-helpers.js — `app.getVersion()` first, then package.json
// fallback). Manager arg may be undefined in odd init paths; in that case fall back
// to the same helper as a static via the build-time Manager.
function resolveRelease(manager) {
  if (typeof manager?.getVersion === 'function') return manager.getVersion();
  return require('../../build.js').getVersion();
}

module.exports = {
  resolveConfig,
  normalizeUser,
  resolveRelease,
  logger,
  DEFAULTS,
};
