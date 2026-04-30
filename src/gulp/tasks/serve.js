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

  logger.log(`Spawning electron: ${electronBin} ${projectRoot}`);

  // Strip ELECTRON_RUN_AS_NODE if present — it makes electron run as plain Node (process.type
  // becomes undefined, require('electron') returns the path string instead of the API). Our test
  // runner sets it for build-layer suites and it can leak into the shell environment.
  const childEnv = Object.assign({}, process.env, {
    EM_LIVERELOAD_PORT: String(port),
    // Force chalk to keep colors when stdout is a pipe; the tee strips them before writing
    // to the log file but the terminal still gets colored output.
    FORCE_COLOR: '1',
  });
  delete childEnv.ELECTRON_RUN_AS_NODE;

  // Pipe stdio (instead of 'inherit') so our parent-process attach-log-file tee can capture
  // electron's stdout/stderr too. We forward each chunk to process.stdout/stderr.write, which
  // is the function the tee already wraps.
  const child = spawn(electronBin, ['.'], {
    cwd:   projectRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
    env:   childEnv,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

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
