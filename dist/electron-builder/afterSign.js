// const Manager = require('electron-manager');
const path = require('path')
// const { notarize } = require('electron-notarize');
const { notarize } = require(path.resolve(process.cwd(), 'node_modules', 'electron-notarize'));
const argv = require('yargs').argv;
const chalk = require('chalk');
// const tokens = require('./._tokens.json');
// const log = require("builder-util/out/log").log;

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir, outDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const appBundleId = packager.config.appId;

  if (!argv.p && !argv.publish) {
    return console.log(chalk.green('Skipping notarization/signing because this is not a publish.'));
  }

  if (!process.env.GH_TOKEN) {
    console.log(chalk.red('You need to set the GH_TOKEN environment variable.'))
    return process.exit(1);
  }

  if (electronPlatformName === 'darwin') {
    if (!process.env.APPLEID) {
      console.log(chalk.red('You need to set the APPLEID environment variable.'));
      return process.exit(1);
    }

    console.info('Notarizing', {appBundleId: appBundleId, appPath: appPath});

    return await notarize({
      appBundleId: appBundleId,
      appPath: appPath,
      appleId: process.env.APPLEID,
      appleIdPassword: `@keychain:code-signing`,
    });
  } else {
    console.log(chalk.green(`No notarization/signing is necessary for ${electronPlatformName}.`));
  }
};
