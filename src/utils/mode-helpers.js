// Runtime mode helpers (BEM-pattern), shared across all three context Managers
// (main / renderer / preload) and the build-time Manager.
//
// Three MUTUALLY EXCLUSIVE environments — exactly one is true:
//   isDevelopment() — app run from source / being developed (unpackaged, e.g. `electron .`,
//                     gulp dev), and NOT testing. Authoritative signal: `app.isPackaged ===
//                     false`. Falls back to NODE_ENV when `app` isn't available (preload,
//                     build-time scripts, renderer).
//   isTesting()     — app being tested (EM's test framework running this process). Single
//                     canonical env var: `EM_TEST_MODE=true`. TAKES PRECEDENCE over dev:
//                     a test run is unpackaged, but it's a TEST, not development.
//   isProduction()  — app packaged & distributed to users (`app.isPackaged === true`),
//                     and NOT testing. A real positive check — NOT `!isDevelopment()`.
//
// To gate "anything non-production" (skip OS side effects, isolate data) use
// `!isProduction()` or `isDevelopment() || isTesting()` intentionally — never assume two
// values.
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

// The three environment checks are MUTUALLY EXCLUSIVE — exactly one is true:
//   isDevelopment() — app run from source / being developed (unpackaged, NOT testing).
//   isTesting()     — app being tested (EM_TEST_MODE=true). Takes precedence over dev.
//   isProduction()  — app packaged & distributed to users (real positive check, NOT testing).
// Testing wins first: a test run is unpackaged, but it's a TEST, not development.

// getEnvironment() — the SINGLE SOURCE OF TRUTH. Reads every raw signal and resolves to
// exactly ONE of 'development' | 'testing' | 'production' (mutually exclusive; testing wins).
// Precedence: testing → explicit config override → Electron app.isPackaged → build-time signal.
function getEnvironment() {
  // 1. Testing wins — set by EM's test runners (EM_TEST_MODE=true), regardless of packaged state.
  if (process.env.EM_TEST_MODE === 'true') return 'testing';

  // 2. An explicit config.em.environment override — the consumer's deliberate decision. It beats
  //    the auto-detected app.isPackaged (e.g. a packaged app the consumer wants to treat as dev).
  const cfgEnv = this?.config?.em?.environment;
  if (cfgEnv === 'development' || cfgEnv === 'testing' || cfgEnv === 'production') return cfgEnv;

  // 3. In Electron main, `app.isPackaged` is the authoritative runtime signal (more accurate
  //    than env vars). In renderer/preload, `electron` has no `app`; from plain Node (gulp/CLI),
  //    `require('electron')` returns the binary path string — `.app` is undefined in both, so we
  //    fall through to the build signals below.
  const { app } = require('electron');
  if (app && typeof app.isPackaged === 'boolean') return app.isPackaged ? 'production' : 'development';

  // 4. Build-time / Node signals. EM_BUILD_MODE=true is set during a production build
  //    (npm run build / npm run release); NODE_ENV=development is the dev fallback.
  if (process.env.EM_BUILD_MODE === 'true') return 'production';
  if (process.env.NODE_ENV === 'development') return 'development';

  // 5. Default: production. EM's deployed RUNTIME can reach here without a dev signal — a
  //    packaged app whose `app.isPackaged` somehow didn't resolve is still a shipped binary,
  //    so production is the safe assumption for a distributed artifact. (Contrast UJM/BXM,
  //    whose deployed artifacts always carry their signal, so they default to development —
  //    a bare context there is just build tooling.)
  return 'production';
}

// The three checks DERIVE from getEnvironment() — they never read raw signals, so they can
// never disagree with it. isDevelopment() is NOT true in testing; isProduction() is a real
// positive check (never `!isDevelopment()`).
function isDevelopment() {
  return getEnvironment.call(this) === 'development';
}

function isProduction() {
  return getEnvironment.call(this) === 'production';
}

function isTesting() {
  return getEnvironment.call(this) === 'testing';
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

// Mix the helpers into a Manager constructor's prototype + the constructor itself
// (so `Manager.isTesting()` works statically too, matching BEM's pattern). getEnvironment()
// is attached here too so all four entry points share one resolver — the URL helpers in
// url-helpers.js depend on this.getEnvironment() existing.
function attachTo(Manager) {
  Manager.prototype.isDevelopment  = isDevelopment;
  Manager.prototype.isProduction   = isProduction;
  Manager.prototype.isTesting      = isTesting;
  Manager.prototype.getEnvironment = getEnvironment;
  Manager.prototype.getVersion     = getVersion;
  Manager.isDevelopment  = isDevelopment;
  Manager.isProduction   = isProduction;
  Manager.isTesting      = isTesting;
  Manager.getEnvironment = getEnvironment;
  Manager.getVersion     = getVersion;
}

module.exports = {
  attachTo,
  isDevelopment,
  isProduction,
  isTesting,
  getEnvironment,
  getVersion,
};
