const path = require('path')
const Manager = new (require(path.resolve(process.cwd(), 'node_modules', 'electron-manager')))();
const chalk = Manager.require('chalk');
const fetch = Manager.require('wonderful-fetch')
const jetpack = Manager.require('fs-jetpack');
const {get, set} = Manager.require('lodash');
const { Octokit } = Manager.require('@octokit/rest');
const octokit = new Octokit({
  auth: process.env.GH_TOKEN,
});

const packageJSON = require(path.join(process.cwd(), 'package.json'));
const electronManagerConfig = require(path.join(process.cwd(), 'electron-manager/config.json'));
const scriptName = '[githubActionCheckOperatingSystem.js]';

const choice = process.env.INPUT_PLATFORM;
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = !isMac && !isWin;

exports.default = async function () {
  let caughtError;

  console.log(chalk.green(`\n*-*-*- Check Operating System: Starting for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));
  
  console.log(chalk.blue(scriptName, `Checking if choice matches platform: choice=${choice}, isMac=${isMac}, isWin=${isWin}, isLinux=${isLinux}`));

  if (
    choice === 'macos' && !isMac
    || choice === 'windows' && !isWin
    || choice === 'linux' && !isLinux
  ) {
    return exit();
  }

  console.log(chalk.green(`*-*-*- Check Operating System: Complete for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));

};

// Run if called from command line
if (require.main == module) {
  exports.default()
}

function exit() {
  console.log(chalk.yellow(scriptName, `Exiting because ${choice} !== ${process.platform}`));
  return process.exit(0)
}
