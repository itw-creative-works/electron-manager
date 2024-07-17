const path = require('path')
const Manager = new (require(path.resolve(process.cwd(), 'node_modules', 'electron-manager')))();
const chalk = Manager.require('chalk');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

const packageJSON = require(path.join(process.cwd(), 'package.json'));
const electronManagerConfig = loadJSON5(path.join(process.cwd(), 'electron-manager', 'config.json'));
const scriptName = '[githubActionBuildGen.js]';

exports.default = async function () {
  let caughtError;

  console.log(chalk.green(`\n*-*-*- Build generation: Starting for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));

  // Generate build.json
  caughtError = await require('../build-libraries/generateBuildFiles.js')().catch(e => e)
  if (caughtError) { return error(caughtError) }

  console.log(chalk.green(`*-*-*- Build generation: Success for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));

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
