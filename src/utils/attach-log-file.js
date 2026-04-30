// attachLogFile(filePath) — duplicate process.stdout + process.stderr writes to a log file.
//
// Inspired by BEM's serve.log pattern. Lets devs (and Claude) `tail -f serve.log` to see
// every line of output the app produces — gulp tasks, electron child, console.log calls in
// the main process, IPC traffic, the works.
//
// ANSI color codes are stripped from the file output so it's grep-friendly. The console
// continues to receive the original colored output unchanged.
//
// Idempotent: calling twice with the same path just returns the existing handle.

const fs = require('fs');
const path = require('path');

const ANSI_PATTERN = /\x1B\[[0-9;]*[a-zA-Z]/g;

let activeStream = null;
let activePath   = null;
let originalStdoutWrite = null;
let originalStderrWrite = null;

function attachLogFile(filePath) {
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

function detach() {
  if (originalStdoutWrite) process.stdout.write = originalStdoutWrite;
  if (originalStderrWrite) process.stderr.write = originalStderrWrite;
  if (activeStream) activeStream.end();
  activeStream = null;
  activePath   = null;
  originalStdoutWrite = null;
  originalStderrWrite = null;
}

function stripAnsi(s) {
  return String(s).replace(ANSI_PATTERN, '');
}

module.exports = attachLogFile;
module.exports.detach   = detach;
module.exports.stripAnsi = stripAnsi;
