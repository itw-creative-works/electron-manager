const chalk = require('chalk');
const powertools = require('node-powertools');
const moment = require('moment');
const jetpack = require('fs-jetpack');
const path = require('path');

const scriptName = '[production.js]';

const startTime = moment();
let activeRun;
let owner;
let repo;

function BuildScriptPost() {

}

BuildScriptPost.prototype.process = async function (options) {
  const self = this;
  let caughtError;

  // Log start
  console.log(chalk.green(`*-*-*- Production Test Starting for ${options.package.productName} v${options.package.version} -*-*-*`));

  // Get path
  let exePath;
  if (process.platform === 'darwin') {
    exePath = path.join(process.cwd(), 'dist', 'mac-arm64', `${options.package.productName}.app`, 'Contents', 'MacOS', options.package.productName);
  } else {
    return error(new Error(`Unsupported platform: ${process.platform}`));
  }

  // Check if exists
  if (!jetpack.exists(exePath)) {
    return error(new Error(`Could not find executable at ${exePath}, please build a local version first`));
  }

  // Fix spaces
  exePath = exePath.replace(/ /g, '\\ ');

  // Command
  const command = `${exePath} --remote-debugging-port=8315`;

  // Log
  console.log(chalk.green(`Running ${command}`));

  // Run
  await powertools.execute(command, {log: true}).catch(e => e)

  // Log complete
  console.log(chalk.green(`*-*-*- Production Test Complete for ${options.package.productName} v${options.package.version} -*-*-*`));
};

// Run if called from command line
function error(e) {
  console.log(chalk.red(scriptName, `${e.message}`));
  if (activeRun && activeRun.conclusion !== 'failure') {
    console.log('\n');
    console.log(chalk.yellow(scriptName, `You can retrigger this CI Server Build with: ${chalk.bold(`npx eman build --retrigger=${activeRun.id}`)}`));
  }
  throw new Error(e)
}

module.exports = BuildScriptPost;
