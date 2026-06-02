// Shared sentry helpers — config parsing, dev-mode gating, user context normalization.
// Used by main / renderer / preload sentry wrappers.

const LoggerLite = require('../logger-lite.js');
const logger = new LoggerLite('sentry');

const DEFAULTS = {
  dsn:            '',
  environment:    null,                  // null = auto-detect from getEnvironment()
  tracesSampleRate: 0.1,
  attachScreenshot: false,
};

// Resolve runtime config + decide whether sentry should boot.
// Presence-driven: a non-empty `dsn` enables sentry. No separate `enabled` flag —
// matches BEM convention (a config block's credentials are its enable signal).
// Returns { shouldEnable, options, reason } where options is the resolved sentry-init opts.
function resolveConfig(manager) {
  const cfg = (manager && manager.config && manager.config.sentry) || {};
  const opts = { ...DEFAULTS, ...cfg };

  if (process.env.EM_SENTRY_ENABLED === 'false') {
    return { shouldEnable: false, options: opts, reason: 'EM_SENTRY_ENABLED=false' };
  }
  if (!opts.dsn) {
    return { shouldEnable: false, options: opts, reason: 'no dsn set' };
  }

  // Dev gating: enable sentry only in a real production BUILD, unless EM_SENTRY_FORCE=true.
  // This intentionally keys on the build-time signal (EM_BUILD_MODE) — NOT the runtime
  // getEnvironment() — because "should we ship telemetry" is a property of the build, not
  // of the current process. A dev machine (no EM_BUILD_MODE) and a test run both correctly
  // resolve to non-production here, so telemetry stays disabled. (getEnvironment()'s
  // no-signal default is 'production' for RUNTIME gating; that's the wrong default for this
  // build-time question, which is why we read EM_BUILD_MODE directly.)
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
// fallback).
function resolveRelease(manager) {
  return manager.getVersion();
}

module.exports = {
  resolveConfig,
  normalizeUser,
  resolveRelease,
  logger,
  DEFAULTS,
};
