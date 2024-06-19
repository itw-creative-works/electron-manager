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
const cp = require('child_process');

function Main() {}

Main.prototype.process = async function (args) {
  let self = this;
  self.options = {};
  self.argv = argv;
  self.this_packageJSON = require('../package.json');

  self.proj_path = process.cwd();
  try {
    self.proj_packageJSONPath = path.resolve(self.proj_path, './package.json');
    self.proj_packageJSON = require(self.proj_packageJSONPath);
  } catch (e) {
    return console.error(chalk.red(`Could not read package.json: ${e}`));
  }

  try {
    self.proj_electronBuilderPackageJSONPath = path.resolve(self.proj_path, 'electron-builder.json');
    self.proj_electronBuilderPackageJSON = require(self.proj_electronBuilderPackageJSONPath);
  } catch (e) {
    return console.error(chalk.red(`Could not read electron-builder.json: ${e}`));
  }

  try {
    self.proj_electronManagerConfigJSONPath = path.resolve(self.proj_path, 'electron-manager', 'config.json');
    self.proj_electronManagerConfigJSON = require(self.proj_electronManagerConfigJSONPath);
    self.proj_electronManagerConfigJSON.app = self.proj_electronManagerConfigJSON.app || {}
    self.proj_electronManagerConfigJSON.app.name = self.proj_electronManagerConfigJSON.app.name || self.proj_packageJSON.productName || ''
    self.proj_electronManagerConfigJSON.app.id = self.proj_electronManagerConfigJSON.app.id || self.proj_electronManagerConfigJSON.app.name.toLowerCase().replace(/\s/g, '-') || ''
    self.proj_electronManagerConfigJSON.app.homepage = self.proj_electronManagerConfigJSON.app.homepage || self.proj_packageJSON.homepage || ''
  } catch (e) {
    return console.error(chalk.red(`Could not read electron-manager/config.json: ${e}`));
  }

  try {
    if (self.options.build) {
      self.proj_buildFilePath = path.resolve(self.proj_path, 'electron-manager', 'build.js');
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

  // Force
  self.options.clear = powertools.force(typeof self.options.clear === 'undefined' ? true : self.options.clear, 'boolean');
  self.options.publish = powertools.force(typeof self.options.publish === 'undefined' ? true : self.options.publish, 'boolean');

  // self.options.type = powertools.force(typeof self.options.type === 'undefined' ? '' : self.options.type, 'string');
  self.options.retrigger = powertools.force(typeof self.options.retrigger === 'undefined' ? 0 : self.options.retrigger, 'number');
  self.options.sync = powertools.force(typeof self.options.sync === 'undefined' ? false : self.options.sync, 'boolean');

  // self.options.count = powertools.force(typeof self.options.count === 'undefined' ? true : self.options.count, 'boolean');
  // self.options.copy = powertools.force(typeof self.options.copy === 'undefined' ? true : self.options.copy, 'boolean');
  // self.options.resignAndPackage = powertools.force(typeof self.options.resignAndPackage === 'undefined' ? true : self.options.resignAndPackage, 'boolean');
  // self.options.sign = powertools.force(typeof self.options.sign === 'undefined' ? true : self.options.sign, 'boolean');
  // self.options['delete-hashes'] = powertools.force(typeof self.options['delete-hashes'] === 'undefined' ? false : self.options['delete-hashes'], 'boolean');
  // self.options.hash = powertools.force(typeof self.options.hash === 'undefined' ? true : self.options.hash, 'boolean');
  // self.options.mas = powertools.force(typeof self.options.mas === 'undefined' ? true : self.options.mas, 'boolean');
  // self.options.upload = powertools.force(typeof self.options.upload === 'undefined' ? true : self.options.upload, 'boolean');
  // self.options.release = powertools.force(typeof self.options.release === 'undefined' ? true : self.options.release, 'boolean');

  process.env.ELECTRON_MANAGER_OPTIONS = JSON.stringify(self.options);

  console.log('Processing', self.options);

  if (self.options.v || self.options.version || self.options['-v'] || self.options['-version']) {
    return console.log(chalk.blue(`Electron Manager is v${chalk.bold(self.this_packageJSON.version)}`));
  }

  let build;
  if (self.options['build']) {
    build = new (require('./building/build-main.js'))();  
  } else if (self.options['prepare'] || self.options['build:pre'] || self.options['build:prepare']) {
    build = new (require('./building/build-prepare.js'))();
  } else if (self.options['build:post']) {
    build = new (require('./building/build-post.js'))();
  }

  if (build) {
    await build.process({
      arguments: self.options,
      // platform: self.options.platform,
      // publish: self.options.publish,
      package: self.proj_packageJSON,
      electronManagerConfig: self.proj_electronManagerConfigJSON,
      electronManagerPackage: self.this_packageJSON,
      electronBuilder: self.proj_electronBuilderPackageJSON,
      buildFile: self.proj_buildFile,
    })
  }  
};

module.exports = Main;

async function asyncCommand(command) {
  return new Promise(function(resolve, reject) {
    let cmd = cp.exec(command, function (error, stdout, stderr) {
      if (error) {
        console.error(error);
        return reject(error);
      } else {
        return resolve(stdout);
      }
    });
  });
}
