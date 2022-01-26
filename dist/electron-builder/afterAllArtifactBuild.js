// const Manager = require('electron-manager');
// const { notarize } = require('electron-notarize-dmg');
const path = require('path')
// const { notarize } = require('electron-notarize');
const { notarize } = require(path.resolve(process.cwd(), 'node_modules', 'electron-notarize'));
const argv = require('yargs').argv;
const chalk = require('chalk');
// const tokens = require('./._tokens.json');
// const builder = require(path.resolve(process.cwd(), 'electron-builder.json'));

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, outDir, packager, configuration } = context;
  const appBundleId = configuration.appId;

  if (!argv.p && !argv.publish) {
    return console.log(chalk.green('Skipping notarization/signing because this is not a publish.'));
  }

  if (!process.env.GH_TOKEN) {
    console.log(chalk.red('You need to set the GH_TOKEN environment variable.'))
    return process.exit(1);
  }

  const dmgPath = context.artifactPaths.find(p => p.endsWith('.dmg'));
  if (!dmgPath) {
    return console.log(chalk.green(`No notarization/signing is necessary for non .dmg files.`));
  }

  console.info('Notarizing', {appBundleId: appBundleId, dmgPath: dmgPath});

  return await notarize({
    appBundleId: appBundleId,
    dmgPath: dmgPath,
    appleId: process.env.APPLEID,
    appleIdPassword: `@keychain:code-signing`,
    staple: false,
  })
};
