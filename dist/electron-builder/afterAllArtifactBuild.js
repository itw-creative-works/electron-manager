const path = require('path');
// TEST: Disabled this (Jun 27, 2024)
// const { notarize } = require(path.resolve(process.cwd(), 'node_modules', 'electron-notarize-dmg'));
const Manager = new (require(path.resolve(process.cwd(), 'node_modules', 'electron-manager')))();
const chalk = Manager.require('chalk');
const scriptName = '[afterAllArtifactBuild.js]';

exports.default = async function (context) {
  const appBundleId = context.configuration.appId;
  const dmgPath = context.artifactPaths.find(p => p.endsWith('.dmg'));

  if (!dmgPath) {
    return console.log(chalk.blue(scriptName, `No notarization/signing is necessary for non .dmg files.`));
  }

  if (process.argv.findIndex(i => i === '--publish') === -1 || (process.argv.findIndex(i => i === '--publish') > -1 && process.argv.findIndex(i => i === 'always') === -1)) {
    return console.log(chalk.blue(scriptName, `Skipping notarization/signing because this is not a publish.`));
  }

  // TEST: Disabled this (Jun 27, 2024)
  if (true)  {
    return console.log(chalk.blue(scriptName, `Skipping notarization/signing because not sure if this is necessary.`));
  }

  console.log(chalk.blue(scriptName, `Notarizing:`), {appBundleId: appBundleId, dmgPath: dmgPath});

  await notarize({
    // tool: notarizationMethod,
    appBundleId: appBundleId,
    dmgPath: dmgPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_PASSWORD || `@keychain:apple-password`,
    staple: false,
  })
  .catch(e => {
    return error(e)
  })
  return console.log(chalk.green(scriptName, `Done notarizing: ${dmgPath}`));
};

function error(e) {
  console.log(chalk.red(scriptName, `${e.message}`));

  setTimeout(() => { process.exit(1); }, 1);

  throw new Error(e)
}
