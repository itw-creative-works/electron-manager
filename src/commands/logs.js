// `npx mgr logs` — show / tail / locate the consumer app's runtime log file.
//
// Resolves to the same file the runtime logger writes to:
//   - Dev (running from a project directory): <projectRoot>/logs/runtime.log
//   - Outside a project: prints the conventional Electron user-data path the runtime
//     would resolve to in production, but doesn't read it (we don't know the AppName
//     from outside the running app).
//
// Flags:
//   (default)        Print the resolved path, then `tail -50` of the file.
//   --tail / -f      Follow mode — keep printing as the file grows. Ctrl+C to stop.
//   --path / -p      Just print the resolved path. Useful for piping to your own tools.
//   --open           Open the log file in the OS default editor.
//   --lines=<N>      How many lines for the default (non-follow) read. Defaults to 50.

const path    = require('path');
const fs      = require('fs');
const jetpack = require('fs-jetpack');
const { spawn, spawnSync } = require('child_process');

module.exports = async function logs(options) {
  options = options || {};

  const logPath = resolveLogPath();
  const exists = jetpack.exists(logPath) === 'file';

  // --path: print and exit. Pipe-friendly.
  if (options.path || options.p) {
    console.log(logPath);
    return;
  }

  // --open: open in default editor and exit.
  if (options.open) {
    if (!exists) {
      console.error(`No log file at ${logPath}. Run the app at least once to generate logs.`);
      process.exitCode = 1;
      return;
    }
    openInDefaultEditor(logPath);
    console.log(`Opened ${logPath}`);
    return;
  }

  // --tail / -f: follow mode.
  if (options.tail || options.f) {
    if (!exists) {
      // It's fine to follow a file that doesn't exist yet — we'll start tailing once
      // it appears. Useful workflow: launch `mgr logs --tail` in one terminal, then
      // `npm start` in another, and watch the log appear.
      console.log(`Watching for log file at ${logPath} (will start tailing once it exists)...`);
      jetpack.dir(path.dirname(logPath));
    }
    return tailFollow(logPath);
  }

  // Default: print path + last N lines.
  const lines = parseInt(options.lines, 10) || 50;
  console.log(`Log file: ${logPath}`);
  if (!exists) {
    console.log('(file does not exist yet — launch the app to generate logs)');
    return;
  }
  console.log(`(last ${lines} lines)`);
  console.log('─'.repeat(60));
  const content = fs.readFileSync(logPath, 'utf8');
  const allLines = content.split(/\r?\n/);
  const tailLines = allLines.slice(Math.max(0, allLines.length - lines));
  process.stdout.write(tailLines.join('\n'));
  if (!tailLines[tailLines.length - 1]?.endsWith('\n')) process.stdout.write('\n');
};

// Resolve the runtime log path the same way lib/logger-lite.js does. We don't
// require logger-lite here because that would attempt to load `electron`, which
// is only available when running inside the Electron runtime (not from a CLI).
function resolveLogPath() {
  // CLI runs from the consumer project root, so this matches dev-mode logger
  // resolution exactly: <cwd>/logs/runtime.log.
  return path.join(process.cwd(), 'logs', 'runtime.log');
}

// Cross-platform "open in default app" — uses the OS's URL/file handler.
function openInDefaultEditor(filePath) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawnSync('open', [filePath], { stdio: 'inherit' });
  } else if (platform === 'win32') {
    // start needs the shell to interpret it. Empty quoted title arg avoids cmd
    // treating the first quoted token as a window title.
    spawnSync('cmd', ['/c', 'start', '""', filePath], { stdio: 'inherit' });
  } else {
    spawnSync('xdg-open', [filePath], { stdio: 'inherit' });
  }
}

// `tail -f` semantics, implemented in pure Node so it works on Windows where there's
// no `tail` binary. Strategy:
//   1. Print everything in the file already (so user has full context).
//   2. Watch the file for size changes; on each change, read from the previous size
//      to the new size and print the delta.
//   3. Handle truncation (file rotation) by resetting the offset to 0.
//
// Returns a Promise that resolves when the user Ctrl+Cs (or the watcher errors).
function tailFollow(logPath) {
  return new Promise((resolve) => {
    let lastSize = 0;

    // Initial dump of everything currently in the file.
    if (jetpack.exists(logPath) === 'file') {
      const data = fs.readFileSync(logPath, 'utf8');
      process.stdout.write(data);
      lastSize = Buffer.byteLength(data, 'utf8');
    }

    // fs.watch fires on rename / change events. We poll on change rather than
    // streaming because Node's stream interface against a growing file is fiddly
    // (you have to manage your own offset anyway).
    let watcher;
    try {
      jetpack.dir(path.dirname(logPath));
      watcher = fs.watch(path.dirname(logPath), { persistent: true }, (eventType, filename) => {
        if (filename !== path.basename(logPath)) return;
        try {
          if (jetpack.exists(logPath) !== 'file') return;
          const stat = fs.statSync(logPath);
          if (stat.size < lastSize) {
            // File was truncated (rotation). Reset and re-read from start.
            lastSize = 0;
            process.stdout.write('\n--- log rotated ---\n');
          }
          if (stat.size > lastSize) {
            const fd = fs.openSync(logPath, 'r');
            try {
              const buf = Buffer.alloc(stat.size - lastSize);
              fs.readSync(fd, buf, 0, buf.length, lastSize);
              process.stdout.write(buf.toString('utf8'));
              lastSize = stat.size;
            } finally {
              fs.closeSync(fd);
            }
          }
        } catch (e) {
          // File may have been momentarily missing during rotation — just wait
          // for the next event.
        }
      });
      watcher.on('error', (e) => {
        console.error(`watcher error: ${e.message}`);
        resolve();
      });
    } catch (e) {
      console.error(`Could not watch ${logPath}: ${e.message}`);
      resolve();
      return;
    }

    // Clean up on Ctrl+C.
    process.on('SIGINT', () => {
      if (watcher) watcher.close();
      console.log('\n(stopped following)');
      resolve();
    });
  });
}
