const chalk = require('chalk');
const powertools = require('node-powertools');
const jetpack = require('fs-jetpack');
const plist = require('simple-plist');
const {get, set} = require('lodash');
const _ = require('lodash');
const fetch = require('wonderful-fetch');
const {coerce, major} = require('semver');
const { Octokit } = require('@octokit/rest');

const path = require('path');

const octokit = new Octokit({
  auth: process.env.GH_TOKEN,
});

const scriptName = '[build-prepare.js]';

const codeSignDir = path.join(process.env.HOME, 'Developer/Code-Signing');

// const XMLParser = new (require('fast-xml-parser').XMLParser)
const demandedPackages = [
  {
    name: 'electron-builder',
    type: 'devDependencies',
  },
  // {
  //   name: 'electron-notarize',
  //   type: 'devDependencies',
  // },
  // {
  //   name: 'electron-notarize-dmg',
  //   type: 'devDependencies',
  // },
  // {
  //   name: 'electron-updater',
  //   type: 'dependencies',
  // },
]

const requiredAppleFiles = [
  { name: 'embedded.provisionprofile', checkId: true },
  { name: 'entitlements.mac.plist', checkId: false },
  { name: 'entitlements.mas.inherit.plist', checkId: false },
  { name: 'entitlements.mas.loginhelper.plist', checkId: false },
  { name: 'entitlements.mas.plist', checkId: true },
  // { name: 'entitlements.mas.plist_', checkId: true },
]

const requiredSecrets = require('../build-libraries/requiredSecrets.js');

const input_githubWorkflowPath = path.join(__dirname, '../github-workflow');

const output_generatedPath = path.join(process.cwd(), 'electron-manager', '_generated');
const output_iconsPath = path.join(output_generatedPath, 'icons');
const output_electronBuilderPath = path.join(output_generatedPath, 'electron-builder');
const output_githubWorkflowPath = path.join(output_generatedPath, 'github-workflow');
const output_githubWorkflowRealPath = path.join(process.cwd(), '.github', 'workflows');

let caughtError = false;
let caughtWarnings = [];

let owner;
let repo;

function BuildScriptPrepare() {

}

BuildScriptPrepare.prototype.process = async function (options) {
  console.log(chalk.green(`*-*-*- Pre-build Starting for ${options.package.productName} v${options.package.version} -*-*-*`));

  // Check options and configs
  if (!options.package.productName) {
    return error(new Error(`You need to set the <productName> in package.json`));
  } else if (!options.package.repository) {
    return error(new Error(`You need to set the <repository> in package.json`));
  } else if (!options.electronManagerConfig.app.name) {
    return error(new Error(`You need to set the <app.name> in electron-manager/config.json`));
  } else if (!options.electronManagerConfig.app.id) {
    return error(new Error(`You need to set the <app.id> in electron-manager/config.json`));
  }

  if (!process.env.GH_TOKEN) {
    return error(new Error(`You need to set the GH_TOKEN environment variable`));
  } else if (!process.env.BACKEND_MANAGER_KEY) {
    return error(new Error(`You need to set the BACKEND_MANAGER_KEY environment variable`));
  }

  const repoSplit = options.package.repository.split('/');
  owner = repoSplit[repoSplit.length - 2];
  repo = repoSplit[repoSplit.length - 1];

  // Test
  // process_testFunction(options);

  // Generate icons
  await process_checkNodeVersion(options).catch(e => caughtError = e)
  if (caughtError) { return error(caughtError)}

  // Clean
  process_cleanDistFolder(options);

  // Create dirs
  process_createDirectories(options);

  // Generate icons
  await process_generateIcons(options).catch(e => caughtError = e)
  if (caughtError) { return error(caughtError)}

  // Check required apple files
  process_checkAppleFiles(options)

  // Add rebuild script
  process_addRebuildScript(options);

  // Copy
  process_copyFiles(options);

  // Update repo secrets
  await process_updateRepoSecrets().catch(e => caughtError = e)
  if (caughtError) { return error(caughtError)}

  // Generate build data
  await process_generateBuildData(options).catch(e => caughtError = e);
  if (caughtError) { return error(caughtError)}

  // Run build file
  if (options.buildFile) {
    await buildFile();
  }

  // Run npm rebuild
  console.log(chalk.blue(scriptName, `Rebuilding npm...`));
  await powertools.execute('npm run rebuild', {log: true})
  .catch(e => warn(e))

  // Check dependencies
  process_checkDependencies(options);

  // Sync with GH
  if (options.arguments.sync) {
    console.log(chalk.blue(scriptName, `Syncing GitHub...`));

    await powertools.execute('git add . && git commit -m "Pre-build" && git push', {log: true})
    .catch(e => warn(e))
  }

  // Check warnings
  caughtWarnings
  .forEach(warning => {
    warn(warning);
  })

  console.log(chalk.green(`*-*-*- Pre-build Completed ${options.package.name} v${options.package.version} has been prepared and is ready to be built! -*-*-*`));
  console.log(chalk.blue(`Run the command to build: ${chalk.bold('npx eman build')}`));
};

module.exports = BuildScriptPrepare;

// Functions
async function process_testFunction() {
  return error(new Error('asd'))
}

function process_checkNodeVersion(options) {
  return new Promise(function(resolve, reject) {
    const packageNodeVersion = `${get(options.package, 'engines.node', null)}`
    const packageElectronVersion = `${major(coerce(get(options.package, 'devDependencies.electron', null)))}`

    console.log(chalk.blue(scriptName, `Checking Node.js version...`));

    if (!packageElectronVersion) {
      return reject(new Error('No Electron installed'))
    }

    fetch(`https://cdn.jsdelivr.net/npm/electron-releases@latest/lite.json`, {
      response: 'json',
      tries: 3,
    })
    .then(result => {
      const matchedPack = result.find(p => p.version === `${packageElectronVersion}.0.0`);

      if (!matchedPack) {
        return reject(new Error('Could not find match version'))
      }

      const requiredNodeVersion = `${major(matchedPack.deps.node)}`;
      const usingNodeVersion = `${major(process.versions.node)}`;

      if (packageNodeVersion === requiredNodeVersion && usingNodeVersion === requiredNodeVersion) {
        console.log(chalk.green(scriptName, `You are using Electron v${packageElectronVersion} which requires Node.js v${requiredNodeVersion} and you're using Node.js v${usingNodeVersion}`));
        return resolve();
      }

      console.log(chalk.red(scriptName, `You are using Electron v${packageElectronVersion} which requires Node.js v${requiredNodeVersion} and you're using Node.js v${usingNodeVersion}`));

      console.log(chalk.blue(scriptName, `Fixing Node.js version...`));

      set(options.package, 'engines.node', `${requiredNodeVersion}`)
      jetpack.write(path.join(process.cwd(), 'package.json'), options.package)
      jetpack.write(path.join(process.cwd(), '.nvmrc'), `v${requiredNodeVersion}/*`)

      return reject(new Error('Please re-start Terminal and run this command again.'))

    })
    .catch(e => reject(e))

  });
}

function process_cleanDistFolder(options) {
  console.log(chalk.blue(scriptName, `Cleaning dist folder...`));
  jetpack.remove(path.join(process.cwd(), 'dist'))
  console.log(chalk.green(scriptName, `Cleaned dist folder`));
}

function process_createDirectories(options) {
  console.log(chalk.blue(scriptName, `Creating necessary directories...`));
  jetpack.dir(output_iconsPath)
  jetpack.dir(output_electronBuilderPath)
  jetpack.dir(output_githubWorkflowPath)
  jetpack.dir(output_githubWorkflowRealPath)
  console.log(chalk.green(scriptName, `Created necessary directories`));
}

function listBuildPathFiles() {
  const buildPath = path.join(process.cwd(), 'build');

  return jetpack.list(buildPath);
}

async function process_generateIcons(options) {
  const files = listBuildPathFiles()
  const macTray1x = files.find(file => file.includes('Template.png'));
  const macTray2x = files.find(file => file.includes('Template@2x.png'));
  const macInstallerBG1x = files.find(file => file.includes('background.png'));
  const macInstallerBG2x = files.find(file => file.includes('background@2x.png'));
  const uniIcon = files.find(file => file.includes('.png') && file.match(/-\d*x\d*/g));
  // const fileLinux = files.find(file => file.includes('.png'));

  console.log(chalk.blue(scriptName, `Generating .ico and .icns files...`));

  // if (!macTray1x || !macTray2x || !fileMac3 || !fileWin || !fileLinux) {
  if (!macTray1x || !macTray2x) {
    throw new Error(`You are missing the mac tray icon @1x or @2x`);
  } else if (!macInstallerBG1x || !macInstallerBG2x) {
    throw new Error(`You are missing the mac installer background @1x or @2x`);
  } else if (!uniIcon) {
    throw new Error(`You are missing the universal icon`);
  }

  try {
    requireGlobal('icon-gen');
  } catch (e) {
    throw new Error('icon-gen is not installed locally or globally');
  }

  await powertools.execute('icon-gen -i ./build/icon-1024x1024.png -o ./build --ico --ico-name "icon" --ico-sizes "16,24,32,48,64,128,256" --icns --icns-name "icon" --icns-sizes "16,32,64,128,256,512,1024"', {log: true})
    .catch(e => {
      // caughtError = e;
      caughtWarnings.push(new Error(`Failed to generate icons ${e}`));
    })
  console.log(chalk.green(scriptName, `Generated .ico and .icns files`));
}

async function process_checkAppleFiles(options) {
  console.log(chalk.blue(scriptName, `Checking required Apple files...`));

  // Copy Profile to the build folder if it exists
  const profilePath = path.join(codeSignDir, `Profiles/${options.package.productName.replace(/ /g, '_')}.provisionprofile`);
  const profileExists = jetpack.exists(profilePath);
  const profilePathNew = path.join(process.cwd(), 'build/embedded.provisionprofile')
  if (profileExists) {
    console.log(chalk.blue(scriptName, `Copying Provision Profile from ${profilePath} to ${profilePathNew}`));
    jetpack.copy(profilePath, profilePathNew, { overwrite: true });
  }

  // Loop through each required file
  requiredAppleFiles
  .forEach(file => {
    const fullPath = path.join(process.cwd(), 'build', file.name);
    if (!jetpack.exists(fullPath)) {
      return error(new Error(`Missing ${file.name}`))
    }
    const provision = parseProvision(fullPath);

    // console.log(chalk.blue(scriptName, ` Checking ${fullPath}\n`), provision.parsed);
    console.log(chalk.blue(scriptName, `Checking ${fullPath}`));

    if (!provision.parsed || !provision.raw) {
      return error(new Error(`Missing ${file.name}`))
    }
    if (provision.parsed.ExpirationDate && new Date(provision.parsed.ExpirationDate) < new Date()) {
      return error(new Error(`Asset expired: ${provision.parsed.ExpirationDate}`))
    }
    if (file.checkId && !provision.raw.includes(options.electronBuilder.appId)) {
      return error(new Error(`Asset does not contain proper appId: ${options.electronBuilder.appId}`))
    }
  })
  console.log(chalk.green(scriptName, `All Apple files are present`));
}

async function process_addRebuildScript(options) {
  console.log(chalk.blue(scriptName, `Checking rebuild script...`));
  if (!options.package.scripts.rebuild) {
    options.package.scripts.rebuild = "node -e 'require(`electron-manager/dist/libraries/electron-rebuilder.js`)()'"
    jetpack.write(path.join(process.cwd(), 'package.json'), options.package);
    console.log(chalk.green(scriptName, `Added rebuild script to package.json`));
  } else {
   console.log(chalk.green(scriptName, `Has rebuild script in package.json`));
  }
}

async function process_copyFiles(options) {
  const files = listBuildPathFiles()
  const logo = files.find(file => file.includes('logo.svg'));

  if (!logo) {
    throw new Error(`You are missing the build/logo.svg file`);
  }

  console.log(chalk.blue(scriptName, `Copying files...`));

  jetpack.remove(output_generatedPath);
  // jetpack.copy(path.join(__dirname, '../electron-builder'), output_electronBuilderPath, { overwrite: true });

  jetpack.list(input_githubWorkflowPath)
  .forEach(file => {
    const inputPath = path.join(input_githubWorkflowPath, file);
    // if (file.match(/\.js$|\.sh$/ig)) {
    if (file.match(/\.js$/ig)) {
      // const outputPath = path.join(output_githubWorkflowPath, file);
      // jetpack.copy(inputPath, outputPath, { overwrite: true });
    } else if (file.match(/\.yml$/ig)) {
      const outputPath = path.join(output_githubWorkflowRealPath, file);
      jetpack.copy(inputPath, outputPath, { overwrite: true });
    }
  })

  // Copy logo.svg
  jetpack.copy(path.join(process.cwd(), 'build'), output_iconsPath, { overwrite: true, matching: ['icon*.*', 'logo*.*'] });
  // jetpack.copy(path.join(buildPath, logo), path.join(process.cwd(), 'electron-manager/_generated/icons/logo.svg'), { overwrite: true });

  console.log(chalk.green(scriptName, `Copied files`));
}

function process_updateRepoSecrets() {
  console.log(chalk.blue(scriptName, `Updating repo secrets...`));

  return new Promise(async function(resolve, reject) {
    // var pg = require("/usr/local/lib/node_modules/pg");
    let sodium;
    try {
      sodium = requireGlobal('libsodium-wrappers');
    } catch (e) {
      return reject(new Error('libsodium-wrappers is not installed locally or globally'))
    }

    await sodium.ready;

    let processPromises = [];

    function _encrypt(publicKey, secret) {
      console.log(chalk.blue(scriptName, `Encrypting ${secret}...`));

      // Read
      const value = jetpack.read(path.join(codeSignDir, `Secrets/${secret}.txt`)).trim();

      if (!value) {
        return reject(new Error(`Missing secret ${secret}`))
      }

      // Convert the message and key to Uint8Array's (Buffer implements that interface)
      const messageBytes = Buffer.from(value);
      const keyBytes = Buffer.from(publicKey, 'base64');

      // Encrypt using LibSodium.
      const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);

      // Base64 the encrypted secret
      const encrypted = Buffer.from(encryptedBytes).toString('base64');

      return encrypted;
    }

    const publicKey = await octokit.rest.actions.getRepoPublicKey({
      owner: owner,
      repo: repo,
    })
    .then(response => response.data)
    .catch(e => e)

    // console.log('---publicKey', publicKey);

    if (publicKey instanceof Error) {return reject(publicKey)}

    console.log(chalk.blue(scriptName, `Public key: ${publicKey.key}`));

    for (var i = 0; i < requiredSecrets.length; i++) {
      const name = requiredSecrets[i];
      // _encrypt(publicKey, name);
      processPromises.push(
        octokit.actions.createOrUpdateRepoSecret({
          owner: owner,
          repo: repo,
          secret_name: name,
          encrypted_value: _encrypt(publicKey.key, name),
          key_id: publicKey.key_id,
        })
      )
    }

    Promise.all(processPromises)
    .then(response => {
      console.log(chalk.green(scriptName, `Successfully updated secrets`));
      return resolve(response);
    })
    .catch(e => reject(e))

  });
}

function process_generateBuildData(options) {
  console.log(chalk.blue(scriptName, `Generating build files...`));

  return new Promise(function(resolve, reject) {
    require('../build-libraries/generateBuildFiles.js')()
    .then(r => {
      console.log(chalk.green(scriptName, `Generated build files`));
      resolve();
    })
    .catch(e => reject(e))

  });
}

function process_checkDependencies(options) {
  console.log(chalk.blue(scriptName, `Checking dependencies...`));

  let isUsingLocal = false;
  ['dependencies', 'devDependencies']
  .forEach((item, i) => {
    if (depChecker(options.package, item)) {
      isUsingLocal = true;
    }
  });

  if (isUsingLocal) {
    // await powertools.wait(1000);
  }

  Object.keys(options.electronManagerPackage.peerDependencies)
  .forEach((item, i) => {
    const requestedVersion = options.electronManagerPackage.peerDependencies[item];
    const currentVersion = options.package.dependencies[item] || options.package.devDependencies[item];
    const isDemanded = !!demandedPackages.find(p => p.name === item);

    const isMatched = requestedVersion === currentVersion;

    if (!isMatched) {
      if (isDemanded) {
        return error(new Error(`${item}: You need to install EXACTLY ${chalk.bold(`v${requestedVersion}`)} of ${chalk.bold(item)}`))
      } else {
        if (currentVersion) {
          return warn(`Checking peer dependency: ${item} ${chalk.bold(`v${currentVersion}`)} !== ${chalk.bold(`v${requestedVersion}`)}`)
        } else {
          return warn(`Checking peer dependency: ${item} ${chalk.bold('is not installed')}`)
        }
      }
    }
  })

  console.log(chalk.green(scriptName, `Checked dependencies`));
}

// function asyncCommand(command, args) {
//   return new Promise(function(resolve, reject) {
//     const full = `${command} ${(args || []).join(' ')}`;

//     console.log('Executing:', full, command, args);
//     // const ls = cp.spawn(command, args);
//     const ls = cp.exec(full);

//     ls.stdout.on('data', (data) => {
//       console.log(`${data}`.replace('\n', ''));
//     });

//     ls.stderr.on('data', (data) => {
//       console.error(chalk.red(`stderr: ${data}`));
//       return reject(data);
//     });

//     ls.on('close', (code) => {
//       // console.log(chalk.green(`child process for command="${full}" exited with code ${code}`));
//       return resolve(code);
//     });
//   });
// }

function depChecker(package, item) {
  const obj = _.get(package, item, {});
  let isUsingLocal = false;

  Object.keys(obj)
  .forEach((item, i) => {
    const version = obj[item]
    if (version.startsWith('file:')) {
      isUsingLocal = true;
      warn(`${chalk.bold(item)} is a LOCAL MODULE which ${chalk.bold('WILL NOT BUILD properly in production')}`)
    }
  });

  return isUsingLocal;
}

function parseProvision(path) {
  const data = jetpack.read(path)
    .match(/<\?xml(.|\n)*?<\/plist>/)[0];

  return {parsed: plist.parse(data), raw: data}
}

// Log error
function error(e) {
  console.log(chalk.red(scriptName, `${e.message}`));

  setTimeout(function () {
    console.log(chalk.red(scriptName, `Exiting process because of fatal error`));

    return process.exit(1);
  }, 1);
}
function warn(e) {
  console.log(chalk.yellow(scriptName, `${e.message || e}`));
}

function requireGlobal(lib) {
  try {
    return require(lib)
  } catch (e) {
    try {
      return require(
        path.join(process.env.NVM_BIN.replace('/bin', '/lib').replace('\\bin', '\\lib'), 'node_modules', lib)
      )
    } catch (e) {
      throw e;
    }
  }
}
