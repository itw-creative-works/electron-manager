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

function Main() {}

Main.prototype.process = async function (args) {
  let self = this;
  self.options = {};
  self.argv = argv;
  self.npu_packageJSON = require('../package.json');

  try {
    self.proj_path = process.cwd();
    self.proj_packageJSONPath = path.resolve(self.proj_path, './package.json');
    self.proj_packageJSON = require(self.proj_packageJSONPath);
  } catch (e) {
    console.error(chalk.red(`Could not read package.json: ${e}`));
    return
  }

  for (var i = 0; i < args.length; i++) {
    self.options[args[i]] = true;
  }

  if (self.options.v || self.options.version || self.options['-v'] || self.options['-version']) {
    return console.log(chalk.blue(`Node Power User is v${chalk.bold(self.npu_packageJSON.version)}`));
  }

  if (self.options.pv || self.options['project-version'] || self.options.project) {
    return console.log(chalk.blue(`The current project (${chalk.bold(self.proj_packageJSON.name)}) is v${chalk.bold(self.proj_packageJSON.version)}`));
  }

  if (self.options.clean) {
    const NPM_INSTALL_FLAG = self.options['--no-optional'] || self.options['-no-optional'] || self.options['no-optional'] ? '--no-optional' : ''
    const NPM_CLEAN = `rm -fr node_modules && rm -fr package-lock.json && npm cache clean --force && npm install ${NPM_INSTALL_FLAG} && npm rb`;
    console.log(chalk.blue(`Running: ${NPM_CLEAN}...`));
    return await asyncCommand(NPM_CLEAN)
    .then(r => {
      console.log(chalk.green(`Finished cleaning`));
    })
    .catch(e => {
      console.log(chalk.green(`Error cleaning: ${e}`));
    })
  }

  if (self.options.bump) {
    return bump(self);
  }


};

module.exports = Main;

function bump(self) {
  const semver = require('semver');
  let level = '';
  const version = self.proj_packageJSON.version;
  // let version = '3.1.0-beta.0';
  let newVersion = [semver.major(version), semver.minor(version), semver.patch(version)];
  let newVersionPost = version.split('-')[1];
  let newVersionString = '';

  if (self.options.break || self.options.breaking || self.options.major || self.options['3']) {
    level = 'breaking';
    newVersion[0]++;
    newVersion[1] = 0;
    newVersion[2] = 0;
  } else if (self.options.feature || self.options.features || self.options.med || self.options.medium || self.options['2']) {
    level = 'feature';
    newVersion[1]++;
    newVersion[2] = 0;
  } else {
    level = 'patch';
    newVersion[2]++;
  }
  newVersionString = newVersion.join('.') + (newVersionPost ? `-${newVersionPost}` : '');

  self.proj_packageJSON.version = newVersionString;

  jetpack.write(self.proj_packageJSONPath, self.proj_packageJSON);

  console.log(chalk.blue(`Bumped package.json from ${chalk.bold(version)} to ${chalk.bold(newVersionString)}`));
}


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
