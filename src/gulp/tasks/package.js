// Package the app via electron-builder, using the materialized config at
// `dist/electron-builder.yml` (produced by gulp/build-config from electron-manager.json).
// Consumers never ship an electron-builder.yml — the dist version is the only source of truth.
//
// This task does NOT publish — it just produces local artifacts under `release/`.
// For publishing, see gulp/release.js.
//
// Skip Windows code signing during this step on the windows runner if EM_SKIP_WIN_SIGN=true
// is set — the windows-sign job in CI signs separately.

const path    = require('path');
const jetpack = require('fs-jetpack');
const Manager = new (require('../../build.js'));

const logger = Manager.logger('package');

module.exports = function packageApp(done) {
  const projectRoot = process.cwd();
  const config = path.join(projectRoot, 'dist', 'electron-builder.yml');

  if (!jetpack.exists(config)) {
    return done(new Error(`Missing ${config}. Run gulp/build-config first (it generates this file from electron-manager.json).`));
  }

  // Resolve electron-builder from the consumer's node_modules first, then EM's bundled one.
  let builder;
  try {
    builder = Manager.require('electron-builder');
  } catch (e) {
    return done(new Error(`Could not resolve electron-builder: ${e.message}. Run \`npm i -D electron-builder\` in the consumer.`));
  }

  const relConfig = path.relative(projectRoot, config);
  logger.log(`Packaging via electron-builder (config=${relConfig})...`);

  const opts = {
    config,
    publish: 'never',          // package only — release.js handles publishing
  };

  // electron-builder's programmatic API returns a Promise<string[]> of artifact paths.
  builder.build(opts)
    .then((artifacts) => {
      const list = (artifacts || []).map((a) => path.relative(projectRoot, a));
      logger.log(`Packaged ${list.length} artifact(s):`);
      list.forEach((a) => logger.log(`  • ${a}`));
      done();
    })
    .catch((e) => {
      logger.error(`electron-builder failed: ${e.message}`);
      done(e);
    });
};
