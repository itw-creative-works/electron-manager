// Default export — re-exports per-process Managers + version.
// Most consumers should use the per-process subpath imports instead:
//   require('electron-manager/main')
//   require('electron-manager/renderer')
//   require('electron-manager/preload')
const package = require('../package.json');

module.exports = {
  version:  package.version,
  Main:     require('./main.js'),
  Renderer: require('./renderer.js'),
  Preload:  require('./preload.js'),
  Build:    require('./build.js'),
};
