// serve — spawn `electron .` against the consumer project.
//
// Pass 2.0: minimum viable serve. Just launches Electron and pipes its stdio.
// Future passes will add: livereload websocket, watch + rebuild, renderer reload via webContents.reload(),
// main reload via app.relaunch().

const Manager = new (require('../../build.js'));
const logger = Manager.logger('serve');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = Manager.getRootPath('project');

module.exports = function serve(done) {
  const port = Manager.getLiveReloadPort();
  logger.log(`serve — livereload port=${port}`);

  // Resolve the electron binary relative to the consumer project's node_modules.
  // require.resolve gives us the package, then we read `bin.electron` relative to that.
  let electronBin;
  try {
    electronBin = require(path.join(projectRoot, 'node_modules', 'electron'));
  } catch (e) {
    logger.error('Could not find electron in consumer node_modules. Run `npm i electron`.');
    return done(e);
  }

  // Forward all --flags from process.argv to the Electron child. Chromium silently ignores
  // flags it doesn't recognize, so gulp's own (--cwd, --gulpfile, etc.) are harmless noise.
  // Usage: `npm start -- --remote-debugging-port=9222`
  // Shorthand: `EM_CDP_PORT=9222 npm start`
  const extraArgs = process.argv.slice(2).filter(arg => arg.startsWith('--'));
  if (process.env.EM_CDP_PORT && !extraArgs.some(a => a.startsWith('--remote-debugging-port'))) {
    extraArgs.push(`--remote-debugging-port=${process.env.EM_CDP_PORT}`);
  }
  const electronArgs = ['.', ...extraArgs];

  logger.log(`Spawning electron: ${electronBin} ${electronArgs.join(' ')} (cwd=${projectRoot})`);

  // ELECTRON_RUN_AS_NODE is already stripped by gulp/main.js at the gulp boundary, so the
  // child env is clean — no extra delete here.
  const childEnv = Object.assign({}, process.env, {
    EM_LIVERELOAD_PORT: String(port),
    // Force chalk to keep colors when stdout is a pipe; the tee strips them before writing
    // to the log file but the terminal still gets colored output.
    FORCE_COLOR: '1',
  });

  // Pipe stdio (instead of 'inherit') so our parent-process attach-log-file tee can capture
  // electron's stdout/stderr too. We forward each chunk to process.stdout/stderr.write, which
  // is the function the tee already wraps.
  const child = spawn(electronBin, electronArgs, {
    cwd:   projectRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
    env:   childEnv,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  // If CDP was requested, verify the port came up after Electron boots.
  const cdpPort = (process.env.EM_CDP_PORT || '').trim()
    || (extraArgs.find(a => a.startsWith('--remote-debugging-port=')) || '').split('=')[1];
  if (cdpPort) {
    setTimeout(() => {
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${cdpPort}/json/version`, (res) => {
        let body = '';
        res.on('data', (d) => body += d);
        res.on('end', () => {
          try {
            const info = JSON.parse(body);
            logger.log(`CDP active on port ${cdpPort} — ${info.Browser || 'unknown'}`);
          } catch (_) {
            logger.log(`CDP active on port ${cdpPort}`);
          }
        });
      });
      req.on('error', () => {
        logger.warn(`CDP port ${cdpPort} not responding — port may be taken by another process. Try a different port: EM_CDP_PORT=${Number(cdpPort) + 1} npm start`);
      });
      req.setTimeout(3000, () => { req.destroy(); });
    }, 5000);
  }

  child.on('exit', (code) => {
    logger.log(`electron exited with code ${code}`);
    // When electron quits, end the gulp task. In dev with watch this would re-spawn instead.
    done();
  });

  child.on('error', (err) => {
    logger.error('electron spawn error:', err);
    done(err);
  });
};
