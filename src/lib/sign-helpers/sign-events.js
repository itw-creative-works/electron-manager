// Structured signing event log — appends JSONL lines to `<runner-dir>/em-signing.log`
// (or another path via `EM_SIGN_LOG`) so a separate `mgr runner monitor` process can
// tail + pretty-print them in real time on the Windows box.
//
// Why JSONL not plain text: lets the monitor pretty-print durations, color the failure
// events distinctively, and group sign-start / sign-done pairs without parsing English.
//
// Where the file lands:
//   - `EM_SIGN_LOG` env var (explicit override) — wins if set
//   - `<RUNNER_TOOLS_DIRECTORY>/em-signing.log` — when running inside a GH Actions self-hosted runner
//   - `<process.cwd()>/em-signing.log` — fallback (works for `mgr sign-windows` outside CI)

const fs   = require('fs');
const os   = require('os');
const path = require('path');

function resolveLogPath() {
  if (process.env.EM_SIGN_LOG) return process.env.EM_SIGN_LOG;
  // GH Actions runner sets RUNNER_TOOLSDIRECTORY (and RUNNER_WORKSPACE/_ROOT). Use the
  // RUNNER_WORKSPACE root if present so the log persists across job runs at a known
  // location. Otherwise fall back to cwd.
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
