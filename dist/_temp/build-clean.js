// https://stackoverflow.com/questions/46407362/checksum-mismatch-after-code-sign-electron-builder-updater
const path = require('path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk');

function BuildScriptClean() {

}

BuildScriptClean.prototype.process = async function (options) {

  const pathDist = path.join(process.cwd(), `dist`);
  const pathDistCopy = path.join(process.cwd(), `dist-copy`);

  console.log(chalk.blue(`Cleaning dist...`));
  if (jetpack.exists(pathDist)) {
    jetpack.remove(pathDist)
    console.log(chalk.green(`Done cleaning dist`));
  }

  console.log(chalk.blue(`Cleaning dist-copy...`));
  if (jetpack.exists(pathDistCopy)) {
    jetpack.remove(pathDistCopy)
    console.log(chalk.green(`Done cleaning dist-copy`));
  }

  console.log(chalk.green(`~Done`));

};

module.exports = BuildScriptClean;
