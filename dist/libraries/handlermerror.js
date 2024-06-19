const fsp = require("fs/promises");
const { createHash } = require("crypto");
const jetpack = require('fs-jetpack');

// -----------------------------------------------------
// Returns a buffer with a computed hash of all file's metadata:
//    full path, modification time and filesize
// If you pass inputHash, it must be a Hash object from the crypto library
//   and you must then call .digest() on it yourself when you're done
// If you don't pass inputHash, then one will be created automatically
//   and the digest will be returned to you in a Buffer object
// -----------------------------------------------------

async function computeMetaHash(folder, inputHash = null) {
  const glob = require('glob')
  let hashes = {};
  return new Promise(function(resolve, reject) {
    glob('**/*', {cwd: folder}, function (error, files) {
      // console.log('====', error, files, files.length);
      if (error) {
        return reject(error);
      } else {
        files.forEach((item, i) => {
          let hash = jetpack.inspect(path.join(folder, item), {checksum: 'sha256'});
          hash.name = item;
          hash.hash = hash.sha256;
          delete hash.sha256;
          hashes[item] = hash;
        });

        return resolve(hashes);
      }
    })
  });
    // const hash = inputHash ? inputHash : createHash('sha256');
    // const info = await fsp.readdir(folder, { withFileTypes: true });
    // // construct a string from the modification date, the filename and the filesize
    // for (let item of info) {
    //     const fullPath = path.join(folder, item.name);
    //     if (item.isFile()) {
    //         const statInfo = await fsp.stat(fullPath);
    //         // compute hash string name:size:mtime
    //         const fileInfo = `${fullPath}:${statInfo.size}:${statInfo.mtimeMs}`;
    //         hash.update(fileInfo);
    //     } else if (item.isDirectory()) {
    //         // recursively walk sub-folders
    //         await computeMetaHash(fullPath, hash);
    //     }
    // }
    // // if not being called recursively, get the digest and return it as the hash result
    // if (!inputHash) {
    //     return hash.digest();
    // }
}

(async function() {
  return
  let hash1 = await computeMetaHash('/Users/ianwiedenman/Library/Application Support/Restart Manager/resources/Restart Manager.app')
  let hash2 = await computeMetaHash('/Users/ianwiedenman/Documents/GitHub/ITW-Creative-Works/restart-manager-electron/dist/mac/Restart Manager.app')

  console.log('=====hash1', Object.keys(hash1).length);
  console.log('=====hash2', Object.keys(hash2).length);
}());




if (process.platform === 'darwin') {
  console.log('-11111', path.resolve(localPath, 'Restart Manager.app'));
  // require('fs-jetpack').remove(path.resolve(localPath, 'Restart Manager.app'));
  extractZip(localPathFilename, localPath)
  // execute(`open "${localPathFilename}"`);
  console.log('-22222');
} else if (process.platform === 'win32') {
} else {
}

console.log('Executing downloaded restart-manager:', command);

return
