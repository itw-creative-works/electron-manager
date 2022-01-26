// CLI GUIDE:
// https://www.twilio.com/blog/how-to-build-a-cli-with-node-js
// https://www.npmjs.com/package/@dkundel/create-project

// https://www.sitepoint.com/javascript-command-line-interface-cli-node-js/
// https://github.com/sitepoint-editors/ginit

const jetpack = require('fs-jetpack');
const chalk = require('chalk');
const _ = require('lodash');
const path = require('path');
const argv = require('yargs').argv;
const powertools = require('node-powertools');
const buildScript = new (require('./electron-builder/build-script.js'))();

function Main() {}

Main.prototype.process = async function (args) {
  let self = this;
  self.options = {};
  self.argv = argv;
  self.npu_packageJSON = require('../package.json');

  self.proj_path = process.cwd();
  try {
    self.proj_packageJSONPath = path.resolve(self.proj_path, './package.json');
    self.proj_packageJSON = require(self.proj_packageJSONPath);
  } catch (e) {
    return console.error(chalk.red(`Could not read package.json: ${e}`));
  }

  try {
    self.proj_electronBuilderPackageJSONPath = path.resolve(self.proj_path, './electron-builder.json');
    self.proj_electronBuilderPackageJSON = require(self.proj_electronBuilderPackageJSONPath);
  } catch (e) {
    return console.error(chalk.red(`Could not read electron-builder.json: ${e}`));
  }

  try {
    if (self.options.build) {
      self.proj_buildFilePath = path.resolve(self.proj_path, './src/development/build.js');
      self.proj_buildFile = require(self.proj_buildFilePath);
    }
  } catch (e) {
    console.error(chalk.yellow(`Could not find build.js at ${self.proj_buildFilePath}: ${e}`));
  }

  Object.keys(argv)
  .forEach((key, i) => {
    self.options[key] = argv[key];
  });

  argv._
  .forEach((key, i) => {
    self.options[key] = true;
  });

  console.log('Processing', self.options);

  if (self.options.v || self.options.version || self.options['-v'] || self.options['-version']) {
    return console.log(chalk.blue(`Electron Manager is v${chalk.bold(self.npu_packageJSON.version)}`));
  }

  if (self.options.build) {
    self.options.publish = powertools(typeof self.options.publish === 'undefined' ? true : self.options.publish, 'boolean');
    if (!self.options.platform) {
      return console.error(chalk.yellow(`You need to provide a valid platform option`));
    }
    buildScript.build({
      platform: self.options.platform,
      publish: self.options.publish,
      package: self.proj_packageJSON,
      electronBuilder: self.proj_electronBuilderPackageJSON,
      buildFile: self.proj_buildFile,
    })
  }

};

module.exports = Main;

async function asyncCommand(command) {
  return new Promise(function(resolve, reject) {
    let cmd = exec(command, function (error, stdout, stderr) {
      if (error) {
        console.error(error);
        return reject(error);
      } else {
        return resolve(stdout);
      }
    });
  });
}
