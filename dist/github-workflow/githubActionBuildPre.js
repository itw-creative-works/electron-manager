const path = require('path')
const Manager = new (require(path.resolve(process.cwd(), 'node_modules', 'electron-manager')))();
const chalk = Manager.require('chalk');
const fetch = Manager.require('wonderful-fetch')
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const { Octokit } = Manager.require('@octokit/rest');
const octokit = new Octokit({
  auth: process.env.GH_TOKEN
});

const packageJSON = require(path.join(process.cwd(), 'package.json'));
const electronManagerConfig = loadJSON5(path.join(process.cwd(), 'electron-manager', 'config.json'));
const scriptName = '[githubActionBuildPre.js]';

const requiredSecrets = require('../build-libraries/requiredSecrets.js');

exports.default = async function () {
  let caughtError;

  console.log(chalk.green(`\n*-*-*- Pre-build Starting: for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));

  // Check required ENV variables
  for (var i = 0; i < requiredSecrets.length; i++) {
    const name = requiredSecrets[i];
    if (typeof process.env[name] === 'undefined') {
      return error(new Error(`Missing ENV variable ${name} (${i + 1}/${requiredSecrets.length})`))
    }
  }

  // Ensure it's not already published
  console.log(chalk.blue(scriptName, `Checking publishing status for ${packageJSON.version}...`));
  await octokit.repos.listReleases({
    owner: packageJSON.update.owner,
    repo: packageJSON.update.repo,
  })
  .then(async (releases) => {
    if (!releases || !releases.data || releases.data.length < 1) {
      return console.log(chalk.green(scriptName, `No prior published assets under version ${packageJSON.version}`));
    }

    const currentRelease = releases.data.find(rel => rel.name === packageJSON.version);
    if (currentRelease) {
      if (!currentRelease.draft) {
        return error(new Error('This version is already published!'))
      } else {
        // Delete existing release
        console.log(chalk.blue(scriptName, `Deleting existing assets for ${packageJSON.version}...`));
        await octokit.rest.repos.deleteRelease({
          owner: packageJSON.update.owner,
          repo: packageJSON.update.repo,
          release_id: currentRelease.id,
        })
        .then(r => {
          console.log(chalk.green(scriptName, `Successfully deleted assets`));
        })
        .catch(e => caughtError = e)
      }
    }
  })

  if (caughtError) {
    return error(caughtError)
  }

  console.log(chalk.green(`*-*-*- Pre-build Success: for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));

};

// Run if called from command line
if (require.main == module) {
  exports.default()
}

// Load JSON5 file
function loadJSON5(path) {
  return JSON5.parse(jetpack.read(path));
}

// Log error
function error(e) {
  console.log(chalk.red(scriptName, `${e.message}`));
  throw new Error(e)
}
