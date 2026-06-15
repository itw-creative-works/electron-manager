// `npx mgr cdp quit` — quit the running dev app and WAIT for its full process
// tree to drain (Electron mains + the npm-start chain), so it's safe to run
// `npx mgr test` the moment this returns. Port-down alone is NOT that signal —
// the chain takes a few more seconds to flush, and a test run started inside
// that window gets contaminated (slow polls, flaky boot suites).
//
// macOS only (osascript).

const { execFileSync } = require('child_process');
const client = require('./client');

const Manager = new (require('../../build.js'))();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function portUp() {
  const response = await fetch(`http://127.0.0.1:${client.port()}/json/version`).catch(() => null);
  return Boolean(response && response.ok);
}

// Electron mains (dev AND stray test instances) + the npm-start chain
// (mgr start / gulp) belonging to THIS project.
function devProcsAlive() {
  const escaped = process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const out = execFileSync('pgrep', ['-f', `${escaped}/node_modules/(electron/dist|\\.bin/(mgr start|gulp))`]);
    return out.toString().trim().split('\n').filter(Boolean).length;
  } catch (error) {
    return 0; // pgrep exits 1 when nothing matches
  }
}

// True when an app was running and has been quit; false when nothing was up.
async function quitAndDrain(names) {
  if (process.platform !== 'darwin') {
    throw new Error('mgr cdp quit/relaunch is macOS-only (osascript)');
  }

  if (!await portUp()) {
    return false;
  }

  // Real app quit (before-quit handlers run).
  let lastError = null;
  for (const name of names) {
    try {
      execFileSync('osascript', ['-e', `tell application "${name}" to quit`]);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw new Error(`could not quit the app (tried: ${names.join(', ')}): ${lastError.message}`);
  }

  for (let i = 0; i < 30; i++) {
    if (!await portUp()) {
      break;
    }
    await sleep(500);
    if (i === 29) {
      throw new Error('app did not release the CDP port after quit');
    }
  }

  // Port-down ≠ process-tree dead — drain it before returning.
  for (let i = 0; i < 30; i++) {
    if (!devProcsAlive()) {
      return true;
    }
    await sleep(500);
  }
  console.warn('warning: app processes still draining — wait a moment before running tests');
  return true;
}

module.exports = async function (options) {
  const wasRunning = await quitAndDrain(client.appNames(Manager.getConfig()));
  console.log(wasRunning ? 'quit running app' : 'app was not running');
};

module.exports.quitAndDrain = quitAndDrain;
