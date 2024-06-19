const chalk = require('chalk');
const path = require('path');
const jetpack = require('fs-jetpack');
const cp = require('child_process');
const _ = require('lodash');
const { Octokit } = require('@octokit/rest');
const powertools = require('node-powertools');

// const XMLParser = new (require('fast-xml-parser').XMLParser)
const octokit = new Octokit({
  auth: process.env.GH_TOKEN
});

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

const generatedPath = path.join(process.cwd(), 'electron-manager', '_generated');
const electronBuilderPath = path.join(generatedPath, 'electron-builder');
const githubWorkflowPath = path.join(generatedPath, 'github-workflow');
const githubWorkflowRealPath = path.join(process.cwd(), '.github', 'workflows');
const iconsPath = path.join(generatedPath, 'icons');

function BuildScriptPrepare() {

}

BuildScriptPrepare.prototype.process = async function (options) {
  let caughtError = false;
  let caughtWarnings = [];
  // console.log(chalk.blue(`
  // \n\n\n\n\n
  // --------------------------
  // Project v${options.package.version} is being built ${options.publish ? 'and published ' : ''}on ${options.platform}!
  // --------------------------
  // `));
  const buildPath = path.join(process.cwd(), 'build');
  const fileMac = jetpack.list(buildPath).find(file => file.includes('Template.png'));
  const fileMac2 = jetpack.list(buildPath).find(file => file.includes('Template@2x.png'));
  const fileMac3 = jetpack.list(buildPath).find(file => file.includes('.icns'));
  const filePngSize = jetpack.list(buildPath).find(file => file.includes('.png') && file.match(/\dx\d/g));
  const fileWin = jetpack.list(buildPath).find(file => file.includes('.ico'));
  const fileLinux = jetpack.list(buildPath).find(file => file.includes('.png'));

  if (!process.env.GH_TOKEN) {
    return console.error(chalk.red(`You need to set the GH_TOKEN environment variable`));
  } else if (!process.env.APPLE_CERTIFICATE_NAME) {
    return console.error(chalk.red(`You need to set the APPLE_CERTIFICATE_NAME environment variable`));
  } else if (!options.package.productName) {
    return console.error(chalk.red(`You need to set the <productName> in package.json`));
  } else if (!options.electronManagerConfig.app.name) {
    return console.error(chalk.red(`You need to set the <app.name> in electron-manager/config.json`));
  } else if (!options.electronManagerConfig.app.id) {
    return console.error(chalk.red(`You need to set the <app.id> in electron-manager/config.json`));
  } else if (!fileMac || !fileMac2 || !fileMac3 || !fileWin || !fileLinux) {
    return console.error(chalk.red(`You are missing an icon file (.png, .icns, .ico)`));
  } else if (!filePngSize) {
    return console.error(chalk.red(`You are missing a size on an icon .png`));
  }

  const embeddedProvisionProfilePath = path.join(process.cwd(), 'build', 'embedded.provisionprofile')
  const entitlementsMasPlistPath = path.join(process.cwd(), 'build', 'entitlements.mas.plist')

  if (jetpack.exists(embeddedProvisionProfilePath)) {
    const embeddedProvisionProfileData = jetpack.read(embeddedProvisionProfilePath).replace(/\n|\t/igm, '')
    if (!embeddedProvisionProfileData.includes(options.electronBuilder.appId)) {
      return console.error(chalk.red(`Missing appId ${options.electronBuilder.appId} in ${embeddedProvisionProfilePath}`));
    }
    const expires = embeddedProvisionProfileData.match(/(ExpirationDate([\S\s]*?)<\/date>)/igm)[0]
      .replace('ExpirationDate</key><date>', '')
      .replace('</date>', '')
    if (new Date(expires) < new Date()) {
      return console.error(chalk.red(`Profile is expired (${expires}) at ${embeddedProvisionProfilePath}`));
    }
  } else {
    return console.error(chalk.red(`Missing file ${embeddedProvisionProfilePath}`));
  }

  if (jetpack.exists(entitlementsMasPlistPath)) {
    const entitlementsMasPlistData = jetpack.read(entitlementsMasPlistPath).replace(/\n|\t/igm, '')
    if (!entitlementsMasPlistData.includes(options.electronBuilder.appId)) {
      return console.error(chalk.red(`Missing appId ${options.electronBuilder.appId} in ${entitlementsMasPlistPath}`));
    }
  } else {
    return console.error(chalk.red(`Missing file ${entitlementsMasPlistPath}`));
  }

  // Add rebuild script
  if (!options.package.scripts.rebuild) {
    options.package.scripts.rebuild = "node -e 'require(`electron-manager/dist/libraries/electron-rebuilder.js`)()'"
    jetpack.write(path.resolve(process.cwd(), 'package.json'), options.package);
    console.log(chalk.green(`Added rebuild script to package.json`));
  }

  // Delete existing release
  await octokit.repos.listReleases({
    owner: options.package.update.owner || '',
    repo: options.package.update.repo || 'update-server',
  })
  .then(async (releases) => {
    const current = releases.data.find(rel => rel.name === options.package.version);
    if (current) {
      await octokit.repos.deleteRelease({
        owner: options.package.update.owner || '',
        repo: options.package.update.repo || 'update-server',
        release_id: current.id,
      })
      .catch(async (e) => {
        caughtError = e;
      })
    }
  })
  .catch(async (e) => {
    caughtError = e;
  })

  if (caughtError) {
    console.error(chalk.red(`Failed to delete current release: ${caughtError}`));
    return
  }

  await asyncCmd('icon-gen', ['-i', './build/icon-1024x1024.png', '-o', './build', '--ico', '--ico-name', '"icon"', '--ico-sizes', '"16,24,32,48,64,128,256"', '--icns', '--icns-name', '"icon"', '--icns-sizes', '"16,32,64,128,256,512,1024"'])
    .catch(e => {
      // caughtError = e;
      caughtWarnings.push(new Error(`Failed to generate icons ${e}`));
    })  

  // Copy
  jetpack.remove(generatedPath);
  jetpack.copy(path.join(__dirname, '../electron-builder'), electronBuilderPath, { overwrite: true });

  jetpack.list(path.join(__dirname, '../github-workflow'))
  .forEach(file => {
    console.log('---', file);
  })

  // jetpack.copy(path.join(__dirname, '../github-workflow', 'githubActionBuildPre.js'), githubWorkflowPath, { overwrite: true });
  jetpack.copy(path.join(process.cwd(), 'build'), iconsPath, { overwrite: true, matching: 'icon*.*' });

  // Create resignAndPackage.sh
  const resignAndPackage = jetpack.read(path.resolve(__dirname, './resignAndPackage.sh'))
    .replace(/{appName}/igm, options.electronManagerConfig.app.name)
    .replace(/{appleCertName}/igm, process.env.APPLE_CERTIFICATE_NAME)
    .replace(/{appPath}/igm, path.resolve(process.cwd(), 'dist', 'mas', '$APP.app'))
    // .replace(/{resultPath}/igm, path.resolve(process.cwd(), 'dist', 'mas', '$APP-mac_store.pkg'))
    .replace(/{resultPath}/igm, path.resolve(process.cwd(), 'dist', 'mas', `$APP-${options.package.version}.pkg`))

  // @@@ not needed anymore because it's in build-post
  if (false) {
    jetpack.write(path.resolve(process.cwd(), 'build', 'resignAndPackage.sh'), resignAndPackage);
  }

  if (options.buildFile) {
    await buildFile();
  }

  function _logError(e) {
    console.error(chalk.red('Error executing command:', typeof e === 'string' ? e : e.toString()));
  }

  await asyncCmd('xattr', ['-cr', '*'])
    .catch(e => {
      // caughtError = e;
    })
  await asyncCmd('rm', ['-r', '~/Library/Caches/com.apple.amp.itmstransporter/UploadTokens'])
    .catch(e => {
      // caughtError = e;
    })
  if (caughtError) { return; }

  // await asyncCmd('npm', ['install'])
  //   .catch(e => {
  //     // caughtError = e;
  //   })
  // if (caughtError) { return; }

  await asyncCmd('rm', ['-r', path.join(process.cwd(), 'dist')])
    .catch(e => {
      // caughtError = e;
    })
  await asyncCmd('rm', ['-r', path.join(process.cwd(), 'dist-copy')])
    .catch(e => {
      // caughtError = e;
    })
  if (caughtError) { return; }

  await asyncCmd('npm', ['run', 'rebuild'])
    .catch(e => {
      // caughtError = e;
      _logError(e);
    })

  await octokit.repos.listReleases({
    owner: options.package.update.owner,
    repo: options.package.update.repo,
  })
  .then(async (releases) => {
    if (!releases || !releases.data || releases.data.length < 1) {
      caughtError = (new Error('Could not list releases'))
      return;
    }

    const currentRelease = releases.data.find(rel => rel.name === options.package.version);
    if (currentRelease) {
      if (!currentRelease.draft) {
          caughtError = (new Error('This version is already published!'))
          return;
      } else {
        return await octokit.rest.repos.deleteRelease({
          owner: options.package.update.owner,
          repo: options.package.update.repo,
          release_id: currentRelease.id,
        });
      }
    }
  })

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

  demandedPackages
  .forEach((pkg, i) => {
    const currentPkgVersion = options.electronManagerPackage.peerDependencies[pkg.name];

    if (options.package[pkg.type][pkg.name] !== currentPkgVersion) {
      caughtError = new Error(`You need to install EXACTLY ${chalk.bold(`v${currentPkgVersion}`)} of ${chalk.bold(pkg.name)}`)
      console.error(chalk.red(caughtError));
    }
  });

  if (caughtError) { return; }

  caughtWarnings
  .forEach(warning => {
    console.warn(chalk.yellow(warning));
  })

  console.log(chalk.blue(`
  \n\n\n\n\n
  --------------------------
  ${options.package.name} v${options.package.version} has been prepared and is ready to be built!
  --------------------------
  `));


};

module.exports = BuildScriptPrepare;


// (async function() {
//
// }());

function asyncCmd(command, args) {
  return new Promise(function(resolve, reject) {
    const full = `${command} ${(args || []).join(' ')}`;

    console.log('Executing:', full, command, args);
    // const ls = cp.spawn(command, args);
    const ls = cp.exec(full);

    ls.stdout.on('data', (data) => {
      console.log(`${data}`.replace('\n', ''));
    });

    ls.stderr.on('data', (data) => {
      console.error(chalk.red(`stderr: ${data}`));
      return reject(data);
    });

    ls.on('close', (code) => {
      console.log(chalk.green(`child process for command="${full}" exited with code ${code}`));
      return resolve(code);
    });
  });
}

function depChecker(package, item) {
  const obj = _.get(package, item, {});
  let isUsingLocal = false;
  
  Object.keys(obj)
  .forEach((item, i) => {
    const version = obj[item]
    if (version.startsWith('file:')) {
      console.error(chalk.red(`\nError: ${chalk.bold(item)} is a LOCAL MODULE which ${chalk.bold('WILL NOT BUILD properly in production')}`));
      isUsingLocal = true;
    }
  });

  return isUsingLocal;
}
