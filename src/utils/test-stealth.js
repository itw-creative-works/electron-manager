// test-stealth — single source of truth for "should EM keep test-run UI invisible
// and non-intrusive?".
//
// True when the process is in Testing mode AND the developer hasn't opted into
// watching the run (EM_TEST_SHOW=1). Shared by:
//   - lib/window-manager.js — stealth window surfacing (showInactive + opacity 0
//     + click-through)
//   - main.js — app-level activation suppression on macOS (accessory policy via
//     app.dock.hide(), so a launching test app never steals keyboard focus)
//   - test/harness/main-entry.js — same suppression for the spawned harness app,
//     which initializes its Manager only after app ready (too late to prevent
//     the launch activation)
//
// Pass the Manager when you have one — its isTesting() is authoritative (honors
// config.em.environment overrides). Without one (the harness, pre-Manager code),
// falls back to the standalone mode-helpers check (EM_TEST_MODE=true).
//
// Usage:
//   const isTestStealth = require('./utils/test-stealth.js');
//   if (isTestStealth(manager)) { ... }

const { isTesting } = require('./mode-helpers.js');

function isTestStealth(manager) {
  const testing = manager ? manager.isTesting() : isTesting();
  return testing && process.env.EM_TEST_SHOW !== '1';
}

module.exports = isTestStealth;
