// https://stackoverflow.com/questions/46407362/checksum-mismatch-after-code-sign-electron-builder-updater
const path = require('path');
const fs = require('fs');
const jetpack = require('fs-jetpack');
const _ = require('lodash');
const crypto = require('crypto');
const chalk = require('chalk');
const yaml = require('yaml');
const mime = require('mime-types');
const { Octokit } = require('@octokit/rest');
const executeSync = require('child_process').execSync;
const execute = require('child_process').exec;
const powertools = require('node-powertools');
const keychain = require('keychain');

let octokit;
let package;
let builder;
let productName;
let productNameHyphenated;

let KEY;
let PASSWORD;
let APPLE_ID;
let APPLE_PASSWORD;
let GH_TOKEN;
let CODESIGN_TIMESTAMP_SERVER;
let CODESIGN_CERTIFICATE_PATH;
let version;

let PARENT_PATH_TOP;
let PARENT_PATH;
let LATEST_YAML;
let FILE_NAME;
let FILE_NAME_MAC;
let FILE_NAME_DEB64;
let FILE_NAME_NEW;
let FILE_PATH;
let FILE_PATH_NEW;
let FILE_PATH_NEW_SIGNED;
let FILE_PATH_NEW_SIGNED_FINAL;
let latestYaml;
let release;
let distCopyPath;

let owner;
let repo;
let tag;
let pathPrefix;

let files;

// BuildScriptPrepare.prototype.process = async function (options) {
//   let caughtError = false;
//
//   // Hash files
//   // let remotePath = _.get(options.electronManagerConfig, 'build.hash.output', '');
//   // if (remotePath) {
//   //   remotePath = path.join(process.cwd(), remotePath, `${options.package.version}.json`)
//   //   const Hash = require('./hash.js')
//   //   console.log('----HASH', remotePath);
//   // }
//
//   if (caughtError) { return; }
//
//   console.log(chalk.blue(`
//   \n\n\n\n\n
//   --------------------------
//   ${options.package.name} v${options.package.version} has been built!
//   --------------------------
//   `));
//
//
// };


function BuildScriptPost() {

}

BuildScriptPost.prototype.process = async function (options) {
  // console.log("await getKeychainPassword('ev-certificate-key')", await getKeychainPassword('ev-certificate-key'));
  // console.log("await getKeychainPassword('apple-password')", await getKeychainPassword('apple-password'));
  // return

  KEY = process.env.EV_CERTIFICATE_KEY || await getKeychainPassword('ev-certificate-key');
  PASSWORD = process.env.EV_CERTIFICATE_PASSWORD || await getKeychainPassword('ev-certificate-password');
  APPLE_ID = process.env.APPLE_ID;
  APPLE_PASSWORD = process.env.APPLE_PASSWORD || await getKeychainPassword('apple-password');
  GH_TOKEN = process.env.GH_TOKEN;
  CODESIGN_TIMESTAMP_SERVER = process.env.CODESIGN_TIMESTAMP_SERVER || 'http://timestamp.sectigo.com';
  CODESIGN_CERTIFICATE_PATH = process.env.CODESIGN_CERTIFICATE_PATH;

  if (!GH_TOKEN) {
    return console.error(chalk.bgBlack.red(`You need to set the GH_TOKEN environment variable`));
  } else if (!APPLE_ID) {
    return console.error(chalk.bgBlack.red(`You need to set the APPLE_ID environment variable`));
  }

  octokit = new Octokit({
    auth: GH_TOKEN
  });
  package = options.package;
  builder = options.electronBuilder;
  productName = builder.productName;
  productNameHyphenated = productName.replace(/ /g, '-');
  version = package.version;

  PARENT_PATH_TOP = process.cwd();
  PARENT_PATH = path.join(process.cwd(), `/dist`);
  LATEST_YAML = path.join(PARENT_PATH, `latest.yml`);
  FILE_NAME = `${productName}\ Setup\ ${version}.exe`;
  FILE_NAME_MAC = `${productName}-${version}.dmg`
  FILE_NAME_DEB64 = `${productNameHyphenated}_${version}_amd64.deb`
  FILE_NAME_NEW = FILE_NAME.replace(/ /g, '-');
  FILE_PATH = path.join(PARENT_PATH, FILE_NAME);
  FILE_PATH_NEW = path.join(PARENT_PATH, `_unsigned.exe`);
  FILE_PATH_NEW_SIGNED = path.join(PARENT_PATH, `_signed.exe`);
  FILE_PATH_NEW_SIGNED_FINAL = path.join(PARENT_PATH, FILE_NAME_NEW);
  latestYaml = yaml.parse(jetpack.read(LATEST_YAML) || '');
  distCopyPath = path.join(PARENT_PATH_TOP, '/dist-copy');

  owner = package.download.owner || '';
  repo = package.download.repo || 'download-server';
  tag = package.download.tag || 'installer';
  pathPrefix = './dist';

  // Files to be uploaded
  files = [
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

    // return await updateInstaller();

    // Check if YAML is valid
    if (!latestYaml) {
      return console.error(chalk.red(`${LATEST_YAML} does not exist`));
    }

    // Count release
    if (options.arguments.count) {
      await countReleaseAssets();
    }

    // BUILD HASHES
    if (options.arguments.hash) {
      await buildHashes();
    }

    // Copy dist folder in case something happens
    if (options.arguments.copy) {
      await copyDist();
    }

    if (options.arguments.resignAndPackage) {
      await resignAndPackage();
    }

    // Prepare
    if (options.arguments.sign) {
      jetpack.remove(FILE_PATH_NEW);
      jetpack.remove(FILE_PATH_NEW_SIGNED);
      jetpack.copy(FILE_PATH, FILE_PATH_NEW);
    }

    // Sign Windows
    if (options.arguments.sign) {
      await codeSign();
    }

    // Update YAML with new sha and stuff
    if (options.arguments.sign) {
      await updateYaml(
        await fileHash(FILE_PATH_NEW_SIGNED)
      );
    }

    // Clean up and prepare
    if (options.arguments.sign) {
      jetpack.remove(FILE_PATH);
      jetpack.remove(FILE_PATH_NEW);
      jetpack.rename(FILE_PATH_NEW_SIGNED, FILE_NAME_NEW);
    }

    if (options.arguments.sign) {
      await updateRelease();
    }

    if (options.arguments.upload) {
      await updateInstaller();
    }

    // await validateMAS();
    if (options.arguments.mas) {
      await uploadMAS();
    }

    if (options.arguments.release) {
      await releaseNewVersion();
    }

    console.log(chalk.blue(`https://github.com/${builder.publish[0].owner}/${builder.publish[0].repo}`));
    console.log(chalk.green('~Done!'));
    console.log(chalk.yellow(`\nBe sure to ${chalk.bold('publish the new hashes')} and any other app assets`));
    console.log(chalk.yellow(`YOU CAN DELETE ${distCopyPath} or run: ${chalk.bold(`npx eman build --type="clean"`)}`));

  }

  function validateMAS() {
    const masPath = path.resolve(process.cwd(), `dist/mas/${productName}-${version}.pkg`);
    console.log(chalk.blue('Validating MAS...', masPath, jetpack.exists(masPath)));

    return new Promise(function(resolve, reject) {
      execute(
        // `xcrun altool --validate-app -f "dist/mas/${productName}-mac_store.pkg" -t osx -u ${APPLE_ID} -p ${APPLE_PASSWORD}`,
        `xcrun altool --validate-app -f "${masPath}" -t osx -u ${APPLE_ID} -p ${APPLE_PASSWORD}`,
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
    const masPath = path.resolve(process.cwd(), `dist/mas/${productName}-${version}.pkg`);
    console.log(chalk.blue('\nUploading MAS...', masPath, jetpack.exists(masPath)));

    return new Promise(function(resolve, reject) {
      execute(
        // `xcrun altool --upload-app -f "dist/mas/${productName}-mac_store.pkg" -t osx -u ${APPLE_ID} -p ${APPLE_PASSWORD}`,
        `xcrun altool --upload-app -f "${masPath}" -t osx -u ${APPLE_ID} -p ${APPLE_PASSWORD}`,
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

  function releaseNewVersion() {
    console.log(chalk.blue('\nReleasing new version...'));

    return new Promise(function(resolve, reject) {
      octokit.repos.listReleases({
        owner: package.update.owner,
        repo: package.update.repo,
      })
      .then(releases => {
        if (!releases || !releases.data || releases.data.length < 1) {
          return reject(new Error(`There is no release for this version`))
        }

        const currentRelease = releases.data.find(rel => rel.name === version);
        if (!currentRelease) {
          return reject(new Error(`There is no release for this version`))
        }

        octokit.repos.updateRelease({
          owner: package.update.owner,
          repo: package.update.repo,
          release_id: currentRelease.id,
          draft: false,
          tag_name: `v${version}`
        })
        .then(response => {
          console.log(chalk.green(`v${version} has been published!`));
          return resolve()
        })
        .catch(e => {
          return reject(e)
        })

      })
      .catch(e => {
        return reject(e)
      })
    });
  }

  function copyDist() {
    return new Promise(function(resolve, reject) {
      console.log(chalk.blue(`\nMaking backup of dist to ${distCopyPath}`));
      if (jetpack.exists(distCopyPath)) {
        jetpack.remove(PARENT_PATH)
        jetpack.copy(distCopyPath, PARENT_PATH, { overwrite: true });
      } else {
        jetpack.remove(distCopyPath)
        jetpack.copy(PARENT_PATH, distCopyPath, { overwrite: true });
      }
      console.log(chalk.green(`Done making backup of dist`));
      return resolve();
    });
  }

  function resignAndPackage() {
    return new Promise(function(resolve, reject) {
      console.log(chalk.blue(`\nRunning resignAndPackage script...`));
      const masPath = path.resolve(process.cwd(), 'dist', 'mas', `${options.electronManagerConfig.app.name}.app`)
      const command = jetpack.read(path.resolve(__dirname, 'resignAndPackage.sh'))
        .replace(/#!\/bin\/bash/g, '')
        .replace(/{appName}/g, options.electronManagerConfig.app.name)
        .replace(/{appPath}/g, path.resolve(process.cwd(), 'dist', 'mas', '$APP.app'))
        .replace(/{resultPath}/g, path.resolve(process.cwd(), 'dist', 'mas', `$APP-${options.package.version}.pkg`))

      if (!jetpack.exists(masPath)) {
        console.log(chalk.orange(`Skipping because ${command} doesn't exist`));
        return resolve();
      }

      executeSync(command,
        {
          stdio: 'inherit'
        }
      );
      // if (jetpack.exists(distCopyPath)) {
      //   jetpack.remove(PARENT_PATH)
      //   jetpack.copy(distCopyPath, PARENT_PATH, { overwrite: true });
      // } else {
      //   jetpack.remove(distCopyPath)
      //   jetpack.copy(PARENT_PATH, distCopyPath, { overwrite: true });
      // }
      console.log(chalk.green(`Finished running resignAndPackage script`));
      return resolve();
    });
  }

  function buildHashes() {
    return new Promise(async function(resolve, reject) {
      const jetpack = require('fs-jetpack');
      const Hash = require('../libraries/hash.js');
      const emHashConfig = _.get(options.electronManagerConfig, 'build.hash', {});
      if (emHashConfig.output) {
        emHashConfig.output = path.join(process.cwd(), emHashConfig.output, `${options.package.version}.json`)
        const hashed = await Hash.build(emHashConfig);

        if (options.arguments['delete-hashes']) {
          jetpack.remove(emHashConfig.output)
          console.log(chalk.green(`Deleted existing hashes at: ${emHashConfig.output}`));
        }

        if (jetpack.exists(emHashConfig.output)) {
          return reject(new Error(`Cannot generate hashes as they have already been generated for version ${version}.`));
        }

        jetpack.write(emHashConfig.output, hashed);
        console.log(chalk.green(`Saved hashes to: ${emHashConfig.output}`));
      }
      return resolve();


    });
  }

  function countReleaseAssets() {
    return new Promise(async function(resolve, reject) {
      console.log(chalk.blue('\nCounting release assets...'));

      // octokit.repos.listReleaseAssets({
      octokit.repos.listReleases({
        owner: package.update.owner,
        repo: package.update.repo,
      })
      .then(releases => {
        if (!releases || !releases.data || releases.data.length < 1) {
          return reject(new Error(`There is no release for this version`))
        }

        const currentRelease = releases.data.find(rel => rel.name === version);
        if (!currentRelease) {
          return reject(new Error(`There is no release for this version`))
        }

        console.log(chalk.green(`v${version} release assets: ${chalk.bold(currentRelease.assets.length)}`));
        return resolve()
      })

    })
  }

  function updateInstaller() {
    return new Promise(async function(resolve, reject) {
      const releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${tag}`;

      console.log(chalk.blue('\nUpdating installer assets...', releaseUrl));

      // octokit.repos.listReleaseAssets({
      octokit.repos.listReleases({
        owner: owner,
        repo: repo,
        // release_id: tag,
        // release_id: '2bff576',
      })
      .then(async (releases) => {
        if (!releases || !releases.data || releases.data.length < 1) {
          return reject(new Error(`Please create a release at: ${releaseUrl}`))
        }

        const installer = releases.data.find(rel => rel.name === tag);
        // if (!installer || !installer.assets || installer.assets.length < 1) {
        //   return reject(new Error('Could not find installer release'))
        // }

        // console.log('installer', installer);

        // console.log('releases.data', releases.data);

        const assets = [
          {
            remote: `${productNameHyphenated}-Setup.exe`,
            local: FILE_NAME_NEW,
          },
          {
            remote: `${productNameHyphenated}-amd64.deb`,
            local: FILE_NAME_DEB64,
          },
          {
            remote: `${productNameHyphenated}.dmg`,
            local: FILE_NAME_MAC,
          }
        ]

        console.log('\n');

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

        console.log(chalk.green('Deleted installers'));

        console.log(chalk.blue('\nUploading new installers...'));
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

      console.log(chalk.blue('\nUpdating release assets...'));

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

        const assetExe = currentRelease.assets.find(asset => asset.name === `${productNameHyphenated}-Setup-${version}.exe`);
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

        console.log(chalk.blue('\nUploading release assets...', FILE_PATH_NEW_SIGNED_FINAL, LATEST_YAML));

        await octokit.repos.uploadReleaseAsset({
          owner: package.update.owner,
          repo: package.update.repo,
          release_id: currentRelease.id,
          data: jetpack.createReadStream(FILE_PATH_NEW_SIGNED_FINAL),
          headers: {
            'content-type': mime.lookup(FILE_PATH_NEW_SIGNED_FINAL),
            'content-length': jetpack.inspect(FILE_PATH_NEW_SIGNED_FINAL).size,
          },
          name: FILE_NAME_NEW,
        })
        .catch(e => {reject(e)});
        console.log(chalk.green('Uploaded signed .exe'));

        await octokit.repos.uploadReleaseAsset({
          owner: package.update.owner,
          repo: package.update.repo,
          release_id: currentRelease.id,
          data: jetpack.createReadStream(LATEST_YAML),
          headers: {
            'content-type': mime.lookup(LATEST_YAML),
            'content-length': jetpack.inspect(LATEST_YAML).size,
          },
          name: 'latest.yml',
        })
        .catch(e => {reject(e)});
        console.log(chalk.green('Uploaded yaml'));

        // return
        // await Promise.all([
        //   octokit.repos.uploadReleaseAsset({
        //     owner: package.update.owner,
        //     repo: package.update.repo,
        //     release_id: currentRelease.id,
        //     data: jetpack.createReadStream(FILE_PATH_NEW_SIGNED_FINAL),
        //     headers: {
        //       'content-type': mime.lookup(FILE_PATH_NEW_SIGNED_FINAL),
        //       'content-length': jetpack.inspect(FILE_PATH_NEW_SIGNED_FINAL).size,
        //     },
        //     name: FILE_NAME_NEW,
        //   }),
        //   octokit.repos.uploadReleaseAsset({
        //     owner: package.update.owner,
        //     repo: package.update.repo,
        //     release_id: currentRelease.id,
        //     data: jetpack.createReadStream(LATEST_YAML),
        //     headers: {
        //       'content-type': mime.lookup(LATEST_YAML),
        //       'content-length': jetpack.inspect(LATEST_YAML).size,
        //     },
        //     name: 'latest.yml',
        //   }),
        // ]);

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

      console.log(chalk.blue('\nSigning...', productName, FILE_PATH, FILE_PATH_NEW_SIGNED, KEY, PASSWORD));

      const command = `
        osslsigncode sign -verbose -pkcs11engine /usr/local/mac-dev/lib/engines-1.1/libpkcs11.dylib -pkcs11module /usr/local/lib/libeTPkcs11.dylib -h sha256 \
        -n "${productName}" \
        -t ${CODESIGN_TIMESTAMP_SERVER} \
        -certs ${CODESIGN_CERTIFICATE_PATH} \
        -key '${KEY}' -pass '${PASSWORD}' -in ${FILE_PATH_NEW} -out ${FILE_PATH_NEW_SIGNED}
        `

      console.log('command', command);

      let doneSigning = false;
      for (var i = 0; i < 3; i++) {
        if (doneSigning) {
          break;
        }
        try {
          executeSync(command,
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
      console.log(chalk.blue(`\nHashing... ${algorithm} ${encoding}`));

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

};

module.exports = BuildScriptPost;


function getKeychainPassword() {
  return new Promise(function(resolve, reject) {
    // _tokens.evCertificateKey
    keychain.getPassword({ account: APPLE_ID, service: 'apple-password' }, function (e, pass) {
      if (e) {
        console.error('getKeychainPassword()', e);
        return resolve(null)
      } else {
        return resolve(pass);
      }
      // Prints: Password is baz
    });
  });
}
// (async function() {
//
// }());

// function asyncCmd(command, args) {
//   return new Promise(function(resolve, reject) {
//     const full = `${command} ${(args || []).join(' ')}`;
//
//     console.log('Executing:', full, command, args);
//     // const ls = cp.spawn(command, args);
//     const ls = cp.exec(full);
//
//     ls.stdout.on('data', (data) => {
//       console.log(`${data}`.replace('\n', ''));
//     });
//
//     ls.stderr.on('data', (data) => {
//       console.error(chalk.red(`stderr: ${data}`));
//       return reject(data);
//     });
//
//     ls.on('close', (code) => {
//       console.log(chalk.green(`child process for command="${full}" exited with code ${code}`));
//       return resolve(code);
//     });
//   });
// }
