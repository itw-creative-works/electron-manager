const path = require('path')
const { notarize } = require(path.resolve(process.cwd(), 'node_modules', '@electron/notarize'));
// const Manager = new (require('electron-manager'))();
const Manager = new (require(path.resolve(process.cwd(), 'node_modules', 'electron-manager')))();
const chalk = Manager.require('chalk');
const scriptName = '[afterSign.js]';

exports.default = async function (context) {

  if (context.electronPlatformName === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);
    const appBundleId = context.packager.config.appId;
    const notarizationMethod = process.env.APPLE_NOTARIZATION_METHOD ? process.env.APPLE_NOTARIZATION_METHOD : 'legacy';

    if (context.packager.info.options.publish !== 'always') {
      return console.log(chalk.blue(scriptName, `Skipping notarization/signing because this is not a publish.`));
    }

    console.log(chalk.blue(scriptName, `Notarizing:`), {notarizationMethod: notarizationMethod, appName: appName, appBundleId: appBundleId, appPath: appPath});

    if (notarizationMethod === 'legacy') {
      await notarize({
        tool: notarizationMethod,
        appPath: appPath,
        appBundleId: appBundleId,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD || `@keychain:apple-password`,
      })
      .catch(e => {
        return error(e)
      })
    } else {
      await notarize({
        tool: notarizationMethod,
        appPath: appPath,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD || `@keychain:apple-password`,
        teamId: process.env.APPLE_TEAM_ID,
      })
      .catch(e => {
        return error(e)
      })
    }

    console.log(chalk.green(scriptName, `Done notarizing: ${appPath}`));
  } else {
    console.log(chalk.blue(scriptName, `No notarization/signing is necessary for ${context.electronPlatformName}.`));
  }
};

function error(e) {
  console.log(chalk.red(scriptName, `${e.message}`));

  setTimeout(() => { process.exit(1); }, 1);

  throw new Error(e)
}
