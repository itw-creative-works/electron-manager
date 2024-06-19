const jetpack = require('fs-jetpack');
// const package = require('../../../../package.json');
const path = require('path');
const glob = require('glob');

let hashPath;

function Hash() {}

Hash.build = function (options) {
  return new Promise(async function(resolve, reject) {
    let hashes = {};
    let _options = null;
    options = options || {};
    const cwd = options._appPath ? options._appPath : process.cwd();

    if (options && options.build && options.build.hash) {
      _options = options.build.hash;
    } else {
      const electronManagerOptions = require(path.join(cwd, 'electron-manager', 'config.json'))
      if (electronManagerOptions && electronManagerOptions.build && electronManagerOptions.build.hash) {
        _options = electronManagerOptions.build.hash;
      }
    }

    const globPattern = _options.glob || '**/*.{js,html,json}';
    const globIgnore = _options.ignore || '{assets,development,generated}/**/*';
    const hashDirectory = _options.directory || 'src';

    hashPath = path.join(cwd, _options.directory)

    // Other solution: https://stackoverflow.com/a/5827895/7305269
    // jetpack.findAsync does NOT work with app.asar
    glob(globPattern, {cwd: hashPath, ignore: globIgnore}, function (error, files) {
      // console.log('====', error, files, files.length);
      if (error) {
        return reject(error);
      } else {
        files.forEach((item, i) => {
          // console.log('---item', item);
          let hash = jetpack.inspect(path.join(hashPath, item), {checksum: 'sha256'});
          hash.name = item;
          hash.hash = hash.sha256;
          delete hash.sha256;
          hashes[item] = hash;
        });

        return resolve(hashes);
      }
    })
  });
};

module.exports = Hash;
