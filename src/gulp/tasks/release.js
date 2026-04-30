// Release task — runs electron-builder with `--publish always`, which packages AND
// uploads artifacts to the configured publish provider (GitHub Releases by default,
// per src/defaults/electron-builder.yml).
//
// Auth: the GH_TOKEN env var (loaded from .env or CI secrets) authorizes the upload.
//
// Cross-platform behavior:
//   - macOS: signs + notarizes (via the afterSign hook) + uploads .dmg / .zip
//   - Linux: builds + uploads .AppImage / .deb (no signing)
//   - Windows: when EM_SKIP_WIN_SIGN=true (CI macOS/linux runners), this never runs the
//              Windows target. The dedicated windows-sign job in CI handles that path.
//
// For local single-platform release runs, electron-builder targets only the host OS by default.

const path    = require('path');
const jetpack = require('fs-jetpack');
const Manager = new (require('../../build.js'));

const logger = Manager.logger('release');

module.exports = function release(done) {
  const projectRoot = process.cwd();
  const distConfig  = path.join(projectRoot, 'dist', 'electron-builder.yml');
  const srcConfig   = path.join(projectRoot, 'electron-builder.yml');

  const config = jetpack.exists(distConfig) ? distConfig
                : jetpack.exists(srcConfig) ? srcConfig
                : null;

  if (!config) {
    return done(new Error('No electron-builder.yml found — cannot release.'));
  }

  if (!process.env.GH_TOKEN) {
    logger.warn('GH_TOKEN not set — electron-builder will fail to publish to GitHub Releases.');
  }

  let builder;
  try {
    builder = Manager.require('electron-builder');
  } catch (e) {
    return done(new Error(`Could not resolve electron-builder: ${e.message}. Run \`npm i -D electron-builder\` in the consumer.`));
  }

  const relConfig = path.relative(projectRoot, config);
  logger.log(`Releasing via electron-builder (config=${relConfig}, publish=always)...`);

  builder.build({
    config,
    publish: 'always',
  })
    .then((artifacts) => {
      const list = (artifacts || []).map((a) => path.relative(projectRoot, a));
      logger.log(`Released ${list.length} artifact(s):`);
      list.forEach((a) => logger.log(`  • ${a}`));
      done();
    })
    .catch((e) => {
      logger.error(`Release failed: ${e.message}`);
      done(e);
    });
};
