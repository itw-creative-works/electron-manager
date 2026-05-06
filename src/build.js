// Libraries
const path = require('path');
const jetpack = require('fs-jetpack');
const fs = require('fs');
const JSON5 = require('json5');
const { force, execute } = require('node-powertools');

// argv is parsed lazily — yargs is ESM-only and can't be `require()`'d in older Node runtimes.
let _argv = null;
function getArgv() {
  if (_argv) return _argv;
  _argv = require('yargs')(process.argv.slice(2)).parseSync();
  return _argv;
}

// Class
function Manager() {
  const self = this;

  // Properties
  self._logger = null;

  // Return
  return self;
}

// Initialize (build-time hook)
Manager.prototype.initialize = function () {
  console.log('initialize:');
};

// Logger
Manager.prototype.logger = function (name) {
  // Static-style call
  if (!(this instanceof Manager)) {
    return new (require('./lib/logger'))(name);
  }

  // Cache one logger per Manager instance
  if (!this._logger) {
    this._logger = new (require('./lib/logger'))(name);
  }

  return this._logger;
};

// argv (yargs is loaded on first call so the runtime build.js doesn't pull in ESM-only deps)
Manager.getArguments = function () {
  const options = getArgv() || {};

  options._ = options._ || [];
  options.debug = force(options.debug === undefined ? false : options.debug, 'boolean');

  return options;
};
Manager.prototype.getArguments = Manager.getArguments;

// Report build errors with notification (parity with BXM)
Manager.reportBuildError = function (error, callback) {
  const logger = new (require('./lib/logger'))('build-error');
  const errorMessage = error.message || error.toString() || 'Unknown error';
  const errorPlugin = error.plugin || 'Build';

  logger.error(`[${errorPlugin}] ${errorMessage}`);

  if (callback) {
    return callback(error);
  }

  return (cb) => cb ? cb(error) : error;
};
Manager.prototype.reportBuildError = Manager.reportBuildError;

// Mode flags
Manager.isBuildMode = function () {
  return process.env.EM_BUILD_MODE === 'true';
};
Manager.prototype.isBuildMode = Manager.isBuildMode;

Manager.isPublishMode = function () {
  return process.env.EM_IS_PUBLISH === 'true';
};
Manager.prototype.isPublishMode = Manager.isPublishMode;

Manager.isServerMode = function () {
  return process.env.EM_IS_SERVER === 'true';
};
Manager.prototype.isServerMode = Manager.isServerMode;

// Quick mode: skips slow / network-bound operations during setup, clean, and gulp tasks.
// Mirrors UJM's UJ_QUICK pattern. Triggered by `--quick` / `-q` CLI flag OR `EM_QUICK=true` env.
// CLI flag is preferred ergonomically; env var lets nested tools (gulp tasks, child processes)
// still see the signal without re-parsing argv.
Manager.isQuickMode = function () {
  if (process.env.EM_QUICK === 'true') return true;
  try {
    const argv = getArgv() || {};
    if (argv.quick === true || argv.q === true) {
      // Propagate so child processes (gulp, electron, npm install shell-outs) inherit it.
      process.env.EM_QUICK = 'true';
      return true;
    }
  } catch (_) { /* yargs not available — fall through */ }
  return false;
};
Manager.prototype.isQuickMode = Manager.isQuickMode;

Manager.actLikeProduction = function () {
  return Boolean(Manager.isBuildMode() || process.env.EM_AUDIT_FORCE === 'true');
};
Manager.prototype.actLikeProduction = Manager.actLikeProduction;

Manager.getEnvironment = function () {
  return Manager.isBuildMode()
    ? 'production'
    : 'development';
};
Manager.prototype.getEnvironment = Manager.getEnvironment;

Manager.getMode = function () {
  return {
    build:   Manager.isBuildMode(),
    publish: Manager.isPublishMode(),
    server:  Manager.isServerMode(),
    environment: Manager.getEnvironment(),
  };
};
Manager.prototype.getMode = Manager.getMode;

// Config — reads config/electron-manager.json (JSON5) and applies derived defaults.
// Derivations:
//   app.appId       ← `com.itwcreativeworks.${brand.id}` if not set
//   app.productName ← brand.name if not set
// These keep the consumer's config minimal: setting `brand: { id: 'foo', name: 'Foo' }` is
// enough; appId/productName flow through automatically.
Manager.getConfig = function () {
  const file = path.join(process.cwd(), 'config', 'electron-manager.json');
  const raw = jetpack.read(file);

  if (!raw) {
    return {};
  }

  const config = JSON5.parse(raw);

  // Apply derived defaults.
  config.brand = config.brand || {};
  config.app   = config.app   || {};
  if (!config.app.appId       && config.brand.id)   config.app.appId       = `com.itwcreativeworks.${config.brand.id}`;
  if (!config.app.productName && config.brand.name) config.app.productName = config.brand.name;

  return config;
};
Manager.prototype.getConfig = Manager.getConfig;

// package.json
Manager.getPackage = function (type) {
  const basePath = type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..');

  const pkgPath = path.join(basePath, 'package.json');
  const raw = jetpack.read(pkgPath);

  if (!raw) {
    return {};
  }

  return JSON5.parse(raw);
};
Manager.prototype.getPackage = Manager.getPackage;

// Root path
Manager.getRootPath = function (type) {
  return type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..');
};
Manager.prototype.getRootPath = Manager.getRootPath;

// Live reload port
Manager.getLiveReloadPort = function () {
  process.env.EM_LIVERELOAD_PORT = process.env.EM_LIVERELOAD_PORT || 35729;
  return parseInt(process.env.EM_LIVERELOAD_PORT, 10);
};
Manager.prototype.getLiveReloadPort = Manager.getLiveReloadPort;

// Windows signing strategy. Config-only — `targets.win.signing.strategy` in
// electron-manager.json. Default 'self-hosted'.
Manager.getWindowsSignStrategy = function () {
  const config = Manager.getConfig();
  return config?.targets?.win?.signing?.strategy || 'self-hosted';
};
Manager.prototype.getWindowsSignStrategy = Manager.getWindowsSignStrategy;

// Touch files to trigger a rebuild watcher
Manager.triggerRebuild = function (files, logger) {
  logger = this?._logger || logger || console;

  if (typeof files === 'string') {
    files = [files];
  } else if (Array.isArray(files)) {
    // already an array
  } else if (typeof files === 'object' && files !== null) {
    files = Object.keys(files);
  } else {
    logger.error('Invalid files for triggerRebuild()');
    return;
  }

  const now = new Date();

  files.forEach((file) => {
    try {
      fs.utimesSync(file, now, now);
      logger.log(`Triggered build: ${file}`);
    } catch (e) {
      logger.error(`Failed to trigger build ${file}`, e);
    }
  });
};
Manager.prototype.triggerRebuild = Manager.triggerRebuild;

// Generic require passthrough (lets gulp tasks dynamically load lib modules).
// Only ever called from gulp tasks (release / package), which run un-bundled — so plain require
// is fine. Don't change this to __non_webpack_require__; that adds noise without solving anything.
Manager.require = function (p) {
  return require(p);
};
Manager.prototype.require = Manager.require;

// Memory usage
Manager.getMemoryUsage = function () {
  const used = process.memoryUsage();
  return {
    rss:       Math.round(used.rss / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    heapUsed:  Math.round(used.heapUsed / 1024 / 1024),
    external:  Math.round(used.external / 1024 / 1024),
  };
};
Manager.prototype.getMemoryUsage = Manager.getMemoryUsage;

Manager.logMemory = function (logger, label) {
  const mem = Manager.getMemoryUsage();
  logger.log(`[Memory ${label}] RSS: ${mem.rss}MB | Heap Used: ${mem.heapUsed}MB / ${mem.heapTotal}MB | External: ${mem.external}MB`);
};
Manager.prototype.logMemory = Manager.logMemory;

// Export
module.exports = Manager;
