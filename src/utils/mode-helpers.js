// Runtime mode helpers (BEM-pattern), shared across all three context Managers
// (main / renderer / preload) and the build-time Manager.
//
// Three orthogonal concepts:
//   isDevelopment() — running unpackaged (e.g. `electron .`, gulp dev). Authoritative
//                     signal: `app.isPackaged === false`. Falls back to NODE_ENV when
//                     `app` isn't available (preload, build-time scripts, renderer).
//   isProduction()  — inverse. Running from a packaged .app/.exe.
//   isTesting()     — true when EM's test framework is running this process. Set by
//                     EM's test runners and any consumer test setup that wants the
//                     same signal. Single canonical env var: `EM_TEST_MODE=true`.
//
// Use these whenever behavior should differ by *what kind of process* you're in —
// shorter timeouts in tests, DevTools menu items only in dev, prompts suppressed in
// tests. Don't use them for "should we hit dev or prod backends" — that's a config
// concern; use `getEnvironment()` for that (in build.js).
//
// Renderer caveat: Electron's `app` API isn't available in renderer processes
// (the renderer's `electron` import surface has `ipcRenderer`, `contextBridge`,
// etc. — no `app`). Same in preload. So those contexts fall back to NODE_ENV /
// config.em.environment. To get a renderer-truthful signal, the consumer can have
// main inject the value into `EM_BUILD_JSON.runtime` at build time (future
// enhancement); for now, NODE_ENV being inherited from the parent process is the
// pragmatic answer.
//
// In plain Node (gulp tasks, CLI commands), `require('electron')` returns the
// binary path as a string — no `app` object — so the same `app && typeof
// app.isPackaged === 'boolean'` check naturally falls through to NODE_ENV.

function isDevelopment() {
  // In main, `electron.app.isPackaged` is the authoritative signal. In renderer /
  // preload, `electron` resolves to a different surface that has no `app` — so we
  // detect via the optional-chain instead of try/catch. From plain Node (gulp / CLI),
  // `require('electron')` returns the binary path string; `.app` is undefined there
  // too, and we fall through to NODE_ENV.
  const { app } = require('electron');
  if (app && typeof app.isPackaged === 'boolean') return !app.isPackaged;
  if (process.env.NODE_ENV === 'development') return true;
  if (this?.config?.em?.environment === 'development') return true;
  return false;
}

function isProduction() {
  return !this.isDevelopment();
}

function isTesting() {
  // Canonical signal — set by EM's test runners and consumer test setups alike.
  return process.env.EM_TEST_MODE === 'true';
}

// `getVersion()` — returns the app's version string. Sources, in priority order:
//   1. `electron.app.getVersion()` when running inside Electron (main process —
//      authoritative; reads from the packaged app's package.json baked into asar).
//   2. `<cwd>/package.json#version` for build-time scripts / non-Electron contexts.
//   3. null when neither resolves.
//
// Renderer caveat: same as isDevelopment — `electron.app` isn't available in renderer,
// so the fallback to `process.cwd()/package.json` won't find anything useful in a
// packaged app. Renderers that need the version should ask main via IPC, or read
// `EM_BUILD_JSON.package.version` (injected by webpack DefinePlugin).
function getVersion() {
  const { app } = require('electron');
  if (app && typeof app.getVersion === 'function') return app.getVersion();
  // Build-time scripts / non-Electron contexts: read project package.json.
  try {
    const path = require('path');
    const pkg = require(path.join(process.cwd(), 'package.json'));
    return pkg.version || null;
  } catch (_) {
    // Only legitimate failure: no package.json at cwd. Tolerate so build-time
    // tooling running outside a project root still loads cleanly.
    return null;
  }
}

// Mix the three helpers into a Manager constructor's prototype + the constructor
// itself (so `Manager.isTesting()` works statically too, matching BEM's pattern).
function attachTo(Manager) {
  Manager.prototype.isDevelopment = isDevelopment;
  Manager.prototype.isProduction  = isProduction;
  Manager.prototype.isTesting     = isTesting;
  Manager.prototype.getVersion    = getVersion;
  Manager.isDevelopment = isDevelopment;
  Manager.isProduction  = isProduction;
  Manager.isTesting     = isTesting;
  Manager.getVersion    = getVersion;
}

module.exports = {
  attachTo,
  isDevelopment,
  isProduction,
  isTesting,
  getVersion,
};
