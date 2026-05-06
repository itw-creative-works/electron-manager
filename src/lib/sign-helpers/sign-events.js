// Structured signing event log — appends JSONL lines to `<runner-dir>/em-signing.log`
// (or another path via `EM_SIGN_LOG`) so a separate `mgr runner monitor` process can
// tail + pretty-print them in real time on the Windows box.
//
// Why JSONL not plain text: lets the monitor pretty-print durations, color the failure
// events distinctively, and group sign-start / sign-done pairs without parsing English.
//
// Where the file lands (resolved in this priority order):
//   1. `EM_SIGN_LOG` env var (explicit override) — wins if set
//   2. `<EM_RUNNER_HOME>/em-signing.log` — when caller has set the runner home
//   3. `C:\actions-runners\em-signing.log` on Windows — the default EM_RUNNER_HOME
//      (matches `defaultRunnerHome()` in src/commands/runner.js). This is the
//      machine-wide default so EVERY signing job from every org/repo writes to
//      the same file, and `npx mgr runner monitor` with no args picks it up.
//   4. `<RUNNER_TOOLSDIRECTORY>/em-signing.log` — legacy fallback if someone runs
//      sign-windows outside the runner-installed path
//   5. `<process.cwd()>/em-signing.log` — last resort

const fs   = require('fs');
const os   = require('os');
const path = require('path');

function resolveLogPath() {
  if (process.env.EM_SIGN_LOG) return process.env.EM_SIGN_LOG;
  if (process.env.EM_RUNNER_HOME) {
    return path.join(process.env.EM_RUNNER_HOME, 'em-signing.log');
  }
  if (process.platform === 'win32') {
    return 'C:\\actions-runners\\em-signing.log';
  }
  const root = process.env.RUNNER_TOOLSDIRECTORY
    || process.env.RUNNER_WORKSPACE
    || process.env.RUNNER_ROOT
    || process.cwd();
  return path.join(root, 'em-signing.log');
}

const logPath = resolveLogPath();

function emit(event, data) {
  const line = JSON.stringify({
    ts:    new Date().toISOString(),
    pid:   process.pid,
    host:  os.hostname(),
    event,
    ...data,
  }) + '\n';
  try {
    fs.appendFileSync(logPath, line);
  } catch (e) {
    // If we can't write the event file, don't crash the sign — write to stderr so the
    // GH Actions runner log still has the trace.
    process.stderr.write(`[sign-events] write failed: ${e.message}\n`);
  }
}

module.exports = {
  getLogPath: () => logPath,
  emit,
};
