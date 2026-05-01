// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('clean');
const { execSync } = require('child_process');
const jetpack = require('fs-jetpack');

// Dirs to clean
const dirs = [
  '.temp',
  '.em-cache',
  'dist',
  'release',
];

module.exports = async function (options) {
  // Quick mode: keep existing build artifacts so the next gulp run is incremental.
  // Only short-circuit if there's actually a dist/ to reuse — first runs still need a real clean.
  if (Manager.isQuickMode()) {
    if (jetpack.exists('dist')) {
      logger.log('Quick mode: Skipping clean');
      return;
    }
    logger.log('Quick mode: No existing build, running full clean');
  }

  logger.log('Cleaning .temp, .em-cache, dist, release...');

  try {
    dirs.forEach((dir) => {
      if (process.platform !== 'win32') {
        execSync(`rm -rf ${dir}`, { stdio: 'ignore' });
      } else {
        jetpack.remove(dir);
      }
      jetpack.dir(dir);
    });
  } catch (e) {
    logger.error(`Error clearing directories: ${e}`);
  }
};
