// https://stackoverflow.com/questions/46407362/checksum-mismatch-after-code-sign-electron-builder-updater
const path = require('path');
const fs = require('fs');
const jetpack = require('fs-jetpack');
const crypto = require('crypto');
const argv = require('yargs').argv;
const chalk = require('chalk');
const yaml = require('yaml');
const mime = require('mime-types');
const { Octokit } = require('@octokit/rest');
const executeSync = require('child_process').execSync;
const execute = require('child_process').exec;
const _tokens = require('./._tokens.json');
const powertools = require('node-powertools');

const octokit = new Octokit({
  auth: _tokens.github
});
const package = require('../../package.json');
const builder = require('../../electron-builder.json');
const productName = builder.productName;

const KEY = _tokens.evCertificateKey;
const PASSWORD = _tokens.evCertificatePassword;
const APPLEID = _tokens.appleid;
const APPLEPASSWORD = _tokens.applepassword;
let version = package.version;

const PARENT_PATH_TOP = process.cwd();
const PARENT_PATH = path.join(process.cwd(), `/dist`);
const LATEST_YAML = path.join(PARENT_PATH, `latest.yml`);
const FILE_NAME = `${productName}\ Setup\ ${version}.exe`;
const FILE_NAME_MAC = `${productName}-${version}.dmg`
const FILE_NAME_DEB64 = `${productName}_${version}_amd64.deb`
const FILE_NAME_NEW = FILE_NAME.replace(/ /g, '-');
const FILE_PATH = path.join(PARENT_PATH, FILE_NAME);
const FILE_PATH_NEW = path.join(PARENT_PATH, `_unsigned.exe`);
const FILE_PATH_NEW_SIGNED = path.join(PARENT_PATH, `_signed.exe`);
const FILE_PATH_NEW_SIGNED_FINAL = path.join(PARENT_PATH, FILE_NAME_NEW);
let latestYaml = yaml.parse(jetpack.read(LATEST_YAML));
let release;
const distCopyPath = path.join(PARENT_PATH_TOP, '/dist-copy');


const owner = package.download.owner || 'somiibo';
const repo = package.download.repo || 'download-server';
const tag = package.download.tag || 'installer';
const pathPrefix = './dist';

// Files to be uploaded
const files = [
  // Mac
  // {
  //   name: `${productName}.dmg`,
  //   location: `./${productName}-${version}.dmg`
  // },

  // Windows
  {
    name: `${productName}-Setup.exe`,
    location: `./${productName} Setup ${version}.exe`
  },

  // Linux
  // {
  //   name: `${productName}.deb`,
  //   location: `./${productName}_${version}_amd64.deb`
  // },
  // {
  //   name: `${productName}.AppImage`,
  //   location: `./${productName}-${version}.AppImage`
  // },
]

/*
  PROCESS
*/
async function main() {
  // --sign-appx
  if (!KEY || !PASSWORD) {
    return console.log(chalk.red('Missing: <key> or <password>'));
  }

  // Fix options
  argv.copy = typeof argv.copy === 'undefined' ? true : argv.copy;
  argv.copy = argv.copy !== 'false';

  argv.sign = typeof argv.sign === 'undefined' ? true : argv.sign;
  argv.sign = argv.sign !== 'false';

  argv['delete-hashes'] = typeof argv['delete-hashes'] === 'undefined' ? true : argv['delete-hashes'];
  argv['delete-hashes'] = argv['delete-hashes'] !== 'false';

  argv.hash = typeof argv.hash === 'undefined' ? true : argv.hash;
  argv.hash = argv.hash !== 'false';

  argv.mas = typeof argv.mas === 'undefined' ? true : argv.mas;
  argv.mas = argv.mas !== 'false';


  // return await updateInstaller();
  // Copy dist folder in case something happens
  if (argv.copy) {
    await copyDist();
  }

  // BUILD HASHES
  if (argv.hash) {
    await buildHashes();
  }

  // Prepare
  if (argv.sign) {
    jetpack.remove(FILE_PATH_NEW);
    jetpack.remove(FILE_PATH_NEW_SIGNED);
    jetpack.copy(FILE_PATH, FILE_PATH_NEW);
  }

  // Sign Windows
  if (argv.sign) {
    await codeSign();
  }

  // Update YAML with new sha and stuff
  if (argv.sign) {
    await updateYaml(
      await fileHash(FILE_PATH_NEW_SIGNED)
    );
  }

  // Clean up and prepare
  if (argv.sign) {
    jetpack.remove(FILE_PATH);
    jetpack.remove(FILE_PATH_NEW);
    jetpack.rename(FILE_PATH_NEW_SIGNED, FILE_NAME_NEW);
  }

  if (argv.sign) {
    await updateRelease();
  }

  await updateInstaller();

  // await validateMAS();
  if (argv.mas) {
    await uploadMAS();
  }

  console.log(chalk.blue(`https://github.com/${builder.publish[0].owner}/${builder.publish[0].repo}`));
  console.log(chalk.green('~Done!'));
  console.log(chalk.yellow(`\nYOU CAN DELETE ${distCopyPath}`));

}

function validateMAS() {
  console.log(chalk.blue('Validating MAS...'));
  return new Promise(function(resolve, reject) {
    execute(
      `xcrun altool --validate-app -f dist/mas/${productName}-mac_store.pkg -t osx -u ${APPLEID} -p ${APPLEPASSWORD}`,
      {
        stdio: 'inherit'
      },
      function (error, stdout, stderr) {
        if (error || stderr) {
          return reject(error || stderr);
        } else {
          if (stdout.includes('No errors validating')) {
            console.log(chalk.green(stdout));
            return resolve(stdout);
          } else {
            return reject(stdout);
          }
        }
      }
    );
  });
}

function uploadMAS() {
  console.log(chalk.blue('Uploading MAS...'));
  return new Promise(function(resolve, reject) {
    execute(
      `xcrun altool --upload-app -f dist/mas/${productName}-mac_store.pkg -t osx -u ${APPLEID} -p ${APPLEPASSWORD}`,
      {
        stdio: 'inherit'
      },
      function (error, stdout, stderr) {
        if (error || stderr) {
          console.log(chalk.red(error || stderr));
          return reject(error || stderr);
        } else {
          console.log(chalk.green(stdout));
          return resolve(stdout);
        }
      }
    );
  });
}

function copyDist() {
  return new Promise(function(resolve, reject) {
    console.log(chalk.blue(`Making backup of dist to ${distCopyPath}`));
    jetpack.remove(distCopyPath)
    jetpack.copy(PARENT_PATH, distCopyPath, { overwrite: true });
    console.log(chalk.green(`Done making backup of dist`));
    return resolve();
  });
}

function buildHashes() {
  return new Promise(function(resolve, reject) {
    execute(
      `npm run build:hash`,
      {
        stdio: 'inherit'
      },
      function (error, stdout, stderr) {
        if (error || stderr) {
          return reject(error || stderr)
        } else {
          return resolve(stdout)
        }
      }
    );
  });
}

function updateInstaller() {
  return new Promise(async function(resolve, reject) {

    console.log(chalk.blue('Updating installer assets...', `https://github.com/${owner}/${repo}/releases/tag/${tag}`));

    // octokit.repos.listReleaseAssets({
    octokit.repos.listReleases({
      owner: owner,
      repo: repo,
      // release_id: tag,
      // release_id: '2bff576',
    })
    .then(async (releases) => {
      if (!releases || !releases.data || releases.data.length < 1) {
        return reject(new Error('Could not list releases'))
      }

      const installer = releases.data.find(rel => rel.name === tag);
      // if (!installer || !installer.assets || installer.assets.length < 1) {
      //   return reject(new Error('Could not find installer release'))
      // }

      // console.log('installer', installer);

      // console.log('releases.data', releases.data);

      const assets = [
        {
          remote: `${productName}-Setup.exe`,
          local: FILE_NAME_NEW,
        },
        {
          remote: `${productName}-amd64.deb`,
          local: FILE_NAME_DEB64,
        },
        {
          remote: `${productName}.dmg`,
          local: FILE_NAME_MAC,
        }
      ]

      const deletePromises = [];
      assets.forEach((item, i) => {
        const asset = installer.assets.find(asset => asset.name.includes(item.remote));
        if (!asset) { return }
        const promise = octokit.repos.deleteReleaseAsset({
          owner: owner,
          repo: repo,
          asset_id: asset.id,
        })

        console.log(chalk.blue('Deleting', asset.name));

        promise
        .then(r => {
          console.log(chalk.green('Finished deleting', asset.name));
        })
        .catch(e => {
          console.log(chalk.red('Failed to delete', asset.name, e));
        })

        deletePromises.push(
          promise
        )
      });

      await Promise.all(deletePromises);

      console.log(chalk.green('Deleted installers, uploading new ones...'));

      const uploadPromises = [];
      assets.forEach((item, i) => {
        // const asset = installer.assets.find(asset => asset.name.includes(item));
        const fullPath = path.join(PARENT_PATH, item.local);
        const contentType = mime.lookup(fullPath);
        const contentInspect = jetpack.inspect(fullPath);
        const contentLength = contentInspect ? contentInspect.size : 0;

        if (contentLength === 0) {
          console.log(chalk.yellow('Skipping because does not exist: ', fullPath));
          return
        }

        // console.log('fullPath', fullPath);
        const promise = octokit.repos.uploadReleaseAsset({
          owner: owner,
          repo: repo,
          release_id: installer.id,
          data: jetpack.createReadStream(fullPath),
          headers: {
            'content-type': contentType,
            'content-length': contentLength,
          },
          name: item.remote,
        })

        console.log(chalk.blue('Uploading', fullPath));

        promise
        .then(r => {
          console.log(chalk.green('Finished uploading', fullPath));
        })
        .catch(e => {
          console.log(chalk.red('Failed to upload', fullPath, e));
        })

        uploadPromises.push(
          promise
        )
      });

      await Promise.all(uploadPromises);

      console.log(chalk.green('Uploaded new installers...'));

      return resolve()
    })
  });
}

function updateRelease() {
  return new Promise(async function(resolve, reject) {

    console.log(chalk.blue('Updating release assets...'));

    octokit.repos.listReleases({
      owner: package.update.owner,
      repo: package.update.repo,
    })
    .then(async (releases) => {
      if (!releases || !releases.data || releases.data.length < 1) {
        return reject(new Error('Could not list releases'))
      }
      const currentRelease = releases.data.find(rel => rel.name === version);
      if (!currentRelease || !currentRelease.assets || currentRelease.assets.length < 1) {
        return reject(new Error('Could not find current release'))
      }

      const assetExe = currentRelease.assets.find(asset => asset.name === `${productName}-Setup-${version}.exe`);
      const assetYml = currentRelease.assets.find(asset => asset.name === 'latest.yml');

      if (assetExe) {
        await octokit.repos.deleteReleaseAsset({
          owner: package.update.owner,
          repo: package.update.repo,
          asset_id: assetExe.id,
        })
        .catch(e => reject(e));
        console.log(chalk.green('Deleted exe release asset'));
      }

      if (assetYml) {
        await octokit.repos.deleteReleaseAsset({
          owner: package.update.owner,
          repo: package.update.repo,
          asset_id: assetYml.id,
        })
        .catch(e => reject(e));
        console.log(chalk.green('Deleted yaml release asset'));
      }

      console.log(chalk.blue('Uploading release assets...', FILE_PATH_NEW_SIGNED_FINAL, LATEST_YAML));

      await Promise.all([
        octokit.repos.uploadReleaseAsset({
          owner: package.update.owner,
          repo: package.update.repo,
          release_id: currentRelease.id,
          data: jetpack.createReadStream(FILE_PATH_NEW_SIGNED_FINAL),
          headers: {
            'content-type': mime.lookup(FILE_PATH_NEW_SIGNED_FINAL),
            'content-length': jetpack.inspect(FILE_PATH_NEW_SIGNED_FINAL).size,
          },
          name: FILE_NAME_NEW,
        }),
        octokit.repos.uploadReleaseAsset({
          owner: package.update.owner,
          repo: package.update.repo,
          release_id: currentRelease.id,
          data: jetpack.createReadStream(LATEST_YAML),
          headers: {
            'content-type': mime.lookup(LATEST_YAML),
            'content-length': jetpack.inspect(LATEST_YAML).size,
          },
          name: 'latest.yml',
        }),
      ]);

      console.log(chalk.green('Finished updating release assets...'));

      return resolve();
    })
  });
}

function upload() {
  return new Promise(async function(resolve, reject) {
    let uploads = [];
    try {
      release = await getReleaseInfo();
      console.log('Found release ID:', release.id);
      for (var i = 0, l = files.length; i < l; i++) {
        uploads.push(uploadReleaseAsset(files[i]))
      }
      await Promise.all(uploads)
      .then(function (res) {
        return resolve()
      })
      .catch(function (e) {
        return reject(new Error(`Error uploading files: ${e}`))
      })

    } catch (e) {
      console.log();
      return reject(new Error(`Error uploading release: ${e}`))
    }
  });
}

function getReleaseInfo() {
  return new Promise(async function(resolve, reject) {
    octokit.repos.getReleaseByTag({
      owner: owner,
      repo: repo,
      tag: tag
    })
    .then(function (res) {
      return resolve({
        id: res.data.id,
        assets: res.data.assets
      })
    })
    .catch(function (e) {
      return reject('Failed to get ID: ' + e)
    });
  });
}

function uploadReleaseAsset(file) {
  let filepath = path.join(pathPrefix, file.location);
  let url = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets{?name,label}`;
  console.log('Uploading file...', file, url);

  return new Promise(async function(resolve, reject) {

    let asset = (release.assets.find(function (asset) {
      return asset.name === file.name;
    }) || {})

    console.log('release.assets', release.assets);

    if (asset.id) {
      console.log('Deleting existing asset...', asset.name);
      await octokit.repos.deleteReleaseAsset({
        owner: owner,
        repo: repo,
        asset_id: asset.id,
      })
    }

    octokit.repos.uploadReleaseAsset({
      url: url,
      data: jetpack.createReadStream(filepath),
      headers: {
        'content-type': mime.lookup(filepath),
        'content-length': jetpack.inspect(filepath).size,
      },
      name: file.name,
      owner: owner,
      repo: repo,
    })
    .then(function (res) {
      return resolve('Successfully uploaded: ' + res.url)
    })
    .catch(function (e) {
      return reject('Error uploading this file: ' + e)
    })

  });
}

function updateYaml(hash) {
  return new Promise(function(resolve, reject) {
    const statsPre = jetpack.inspect(FILE_PATH_NEW);
    const stats = jetpack.inspect(FILE_PATH_NEW_SIGNED);
    latestYaml.files[0].sha512 = hash;
    latestYaml.files[0].size = stats.size;
    latestYaml.sha512 = hash;
    latestYaml.releaseDate = `@@@${latestYaml.releaseDate}@@@`;

    latestYaml = yaml.stringify(latestYaml)
      .replace(/"@@@/g, "'")
      .replace(/@@@"/g, "'")
    jetpack.write(LATEST_YAML, latestYaml);
    return resolve();
  });

}

function codeSign() {
  return new Promise(function(resolve, reject) {
    console.log(chalk.blue('Signing', FILE_PATH, KEY, PASSWORD));

    let doneSigning = false;
    for (var i = 0; i < 10; i++) {
      if (doneSigning) {
        break;
      }
      try {
        executeSync(
          `
          osslsigncode sign -verbose -pkcs11engine /usr/local/mac-dev/lib/engines-1.1/libpkcs11.dylib -pkcs11module /usr/local/lib/libeTPkcs11.dylib -h sha256 \
          -n ${productName} \
          -t http://timestamp.sectigo.com \
          -certs /Users/ianwiedenman/Documents/GitHub/_global/code-signing/ITW-Creative-Works.pem \
          -key '${KEY}' -pass '${PASSWORD}' -in ${FILE_PATH_NEW} -out ${FILE_PATH_NEW_SIGNED}
          `,
          {
            stdio: 'inherit'
          }
        );
        doneSigning = true;
      } catch (e) {
        console.log('Error signing... trying again', i);
      }
    }


    if (!doneSigning) {
      return reject(new Error('Failed codesign...'))
    }

    console.log(chalk.green('Signed code'));
    return resolve();
  });
}

function fileHash(filename, algorithm = 'sha512', encoding = 'base64') {
  return new Promise((resolve, reject) => {
    // Algorithm depends on availability of OpenSSL on platform
    // Another algorithms: 'sha1', 'md5', 'sha256', 'sha512' ...
    let shasum = crypto.createHash(algorithm);
    console.log(chalk.blue('Hashing...', algorithm, encoding));

    try {
      let s = fs.ReadStream(filename)
      s.on('data', function (data) {
        shasum.update(data)
      })
      // making digest
      s.on('end', function () {
        const hash = shasum.digest(encoding);
        console.log(chalk.green('Hashed', hash));
        return resolve(hash);
      })
      // .pipe(
      //   shasum,
      //   {
      //     end: false,
      //   }
      // );
    } catch (error) {
      return reject(error);
    }
  });
}


// function hashFile(file, algorithm = 'sha512', encoding = 'base64', options) {
//   return new Promise((resolve, reject) => {
//     const hash = crypto.createHash(algorithm);
//     hash.on('error', reject).setEncoding(encoding);
//     // hash.on('error', reject).digest(encoding);
//     console.log(chalk.blue('Hashing...', algorithm, encoding));
//
//     fs.createReadStream(
//       file,
//       Object.assign({}, options, {
//         highWaterMark: 1024 * 1024,
//         /* better to use more memory but hash faster */
//       })
//     )
//     .on('error', reject)
//     .on('end', () => {
//       hash.end();
//       const newHash = hash.read();
//       console.log(chalk.green('Hashed', newHash));
//       if (!newHash) {
//         return reject(new Error('Hash was null'))
//       }
//       return resolve(`${newHash}`);
//     })
//     .pipe(
//       hash,
//       {
//         end: false,
//       }
//     );
//   });
// }

main();
