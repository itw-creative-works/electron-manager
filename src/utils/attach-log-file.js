// attachLogFile(filePath) — duplicate process.stdout + process.stderr writes to a log file.
//
// Inspired by BEM's per-command log pattern. Lets devs (and Claude) `tail -f logs/dev.log` to
// see every line of output the app produces — gulp tasks, electron child, console.log calls in
// the main process, IPC traffic, the works.
//
// ANSI color codes are stripped from the file output so it's grep-friendly. The console
// continues to receive the original colored output unchanged.
//
// The default export is a process-wide SINGLETON (the common case: a CLI command tees its
// whole run to one file). `attachLogFile.createTee()` returns an INDEPENDENT tee with its own
// state. Tees STACK: a later attach() captures the CURRENT `process.stdout.write` (which may
// already be an outer tee) as its "original", so writes fan out through every layer and
// detach() restores the exact prior writer in LIFO order. That stacking is what lets the
// attach-log-file unit tests exercise attach/detach on a throwaway instance WITHOUT killing
// the live singleton tee that's capturing the actual test run — the bug that previously
// truncated `logs/test.log` to ~9 lines (the test detached the live tee mid-run).
//
// Idempotent: calling attach() twice with the same path on one tee returns the existing handle.

const fs = require('fs');
const path = require('path');

const ANSI_PATTERN = /\x1B\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(s) {
  return String(s).replace(ANSI_PATTERN, '');
}

// Factory — each call returns an independent tee with its own closure state.
function createTee() {
  let activeStream = null;
  let activePath   = null;
  let originalStdoutWrite = null;
  let originalStderrWrite = null;

  function attach(filePath) {
    if (!filePath) return null;
    const abs = path.resolve(filePath);

    if (activeStream && activePath === abs) return activeStream;
    if (activeStream) detach();

    // Truncate fresh on each invocation — same as BEM's `flags: 'w'`. Devs running multiple
    // sessions back to back don't want stale lines from the previous run mixed in.
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const stream = fs.createWriteStream(abs, { flags: 'w' });

    // Header so the file is self-documenting.
    stream.write(`# em log — ${new Date().toISOString()} — pid=${process.pid}\n`);

    // Capture whatever the CURRENT writer is — could be the raw stream OR an outer tee.
    // Restoring this exact reference on detach() is what makes stacked tees safe.
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    originalStderrWrite = process.stderr.write.bind(process.stderr);

    process.stdout.write = function (chunk, ...rest) {
      try { stream.write(stripAnsi(String(chunk))); } catch (e) { /* ignore */ }
      return originalStdoutWrite(chunk, ...rest);
    };
    process.stderr.write = function (chunk, ...rest) {
      try { stream.write(stripAnsi(String(chunk))); } catch (e) { /* ignore */ }
      return originalStderrWrite(chunk, ...rest);
    };

    activeStream = stream;
    activePath   = abs;

    return stream;
  }

  // Restores stdout/stderr and ends the stream. Returns a Promise that resolves once all
  // buffered writes have been flushed to disk — await it before process.exit(), otherwise the
  // tail of the log is silently dropped.
  function detach() {
    if (originalStdoutWrite) process.stdout.write = originalStdoutWrite;
    if (originalStderrWrite) process.stderr.write = originalStderrWrite;
    const stream = activeStream;
    activeStream = null;
    activePath   = null;
    originalStdoutWrite = null;
    originalStderrWrite = null;

    return new Promise((resolve) => {
      if (!stream) {
        return resolve();
      }
      stream.end(resolve);
    });
  }

  return { attach, detach };
}

// Process-wide singleton — the production entry point.
const singleton = createTee();

function attachLogFile(filePath) {
  return singleton.attach(filePath);
}

module.exports = attachLogFile;
module.exports.detach    = singleton.detach;
module.exports.stripAnsi = stripAnsi;
module.exports.createTee = createTee;
