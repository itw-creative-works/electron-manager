// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('main');
const argv = Manager.getArguments();
const { series, parallel } = require('gulp');
const path = require('path');
const glob = require('glob').globSync;

// Load packages
const package = Manager.getPackage('main');
const project = Manager.getPackage('project');
const projectRoot = Manager.getRootPath('project');

// Load .env file from project root
require('dotenv').config({ path: path.join(projectRoot, '.env') });

// Tee all stdout/stderr to <projectRoot>/logs/dev.log for easy `tail -f` / grep / Claude inspection.
// Disable via EM_LOG_FILE=false. Override path via EM_LOG_FILE=<path>.
const attachLogFile = require('../utils/attach-log-file.js');
const logFileEnv = process.env.EM_LOG_FILE;
if (logFileEnv !== 'false' && logFileEnv !== '0') {
  const logPath = (logFileEnv && logFileEnv !== 'true') ? logFileEnv : path.join(projectRoot, 'logs', 'dev.log');
  attachLogFile(logPath);
  logger.log(`Logs tee'd to ${logPath}`);
}

logger.log('Starting...', argv);

// Auto-load tasks from src/gulp/tasks/*.js
const tasks = glob('*.js', { cwd: `${__dirname}/tasks` });

// Globals (parity with BXM)
global.tasks = {};
global.websocket = null;

tasks.forEach((file) => {
  const name = file.replace('.js', '');
  logger.log('Loading task:', name);
  exports[name] = require(path.join(__dirname, 'tasks', file));
});

global.tasks = exports;

// Lifecycle hook tasks — each invokes the consumer's <projectRoot>/hooks/<name>.js file if it
// exists, or no-ops. Inserted around the build/release stages so consumers can extend the
// pipeline without forking gulp tasks.
const runConsumerHook = require('../utils/run-consumer-hook.js');
function makeHookTask(name) {
  const fn = async () => {
    const Manager = new (require('../build.js'));
    await runConsumerHook(name, { manager: Manager, projectRoot: process.cwd(), mode: process.env.EM_BUILD_MODE === 'true' ? 'production' : 'development' });
  };
  // Set displayName for nicer gulp logs.
  Object.defineProperty(fn, 'name', { value: `hook:${name.replace('/', ':')}` });
  return fn;
}
exports['hook:build:pre']   = makeHookTask('build/pre');
exports['hook:build:post']  = makeHookTask('build/post');
exports['hook:release:pre'] = makeHookTask('release/pre');
exports['hook:release:post'] = makeHookTask('release/post');

// Build pipeline: hook:build:pre → defaults → distribute → (sass | webpack | html in parallel)
// → audit → build-config → hook:build:post.
// build-config generates dist/electron-builder.yml entirely from EM defaults +
// config/electron-manager.json (no consumer-shipped electron-builder.yml). Mode-dependent
// injections (e.g. LSUIElement for tray-only) happen here. Must run BEFORE package/release.
exports.build = series(
  exports['hook:build:pre'],
  exports.defaults,
  exports.distribute,
  parallel(exports.sass, exports.webpack, exports.html),
  exports.audit,
  exports['build-config'],
  exports['hook:build:post'],
);

// Production package: build + electron-builder package (no publish)
exports.packageBuild = series(
  exports.build,
  exports.package,
);

// Publish: build + hook:release:pre + electron-builder release + mirror + hook:release:post.
// Single sign+notarize pass; mirror is post-publish (re-uploads artifacts under stable names).
exports.publish = series(
  exports.build,
  exports['hook:release:pre'],
  exports.release,
  exports['mirror-downloads'],
  exports['hook:release:post'],
);

// Default dev pipeline: build, then launch electron.
exports.default = series(
  exports.build,
  exports.serve,
);
