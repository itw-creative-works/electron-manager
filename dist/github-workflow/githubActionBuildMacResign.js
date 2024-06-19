const path = require('path')
const Manager = new (require(path.resolve(process.cwd(), 'node_modules', 'electron-manager')))();
const chalk = Manager.require('chalk');
const fetch = Manager.require('wonderful-fetch')
const jetpack = Manager.require('fs-jetpack');
const {get, set} = Manager.require('lodash');
const { Octokit } = Manager.require('@octokit/rest');
const octokit = new Octokit({
  auth: process.env.GH_TOKEN,
});

const { exec } = require('child_process');

const packageJSON = require(path.join(process.cwd(), 'package.json'));
const electronManagerConfig = require(path.join(process.cwd(), 'electron-manager/config.json'));
const scriptName = '[githubActionBuildMacResign.js]';

// @universal
const masAppPath = path.join(process.cwd(), `dist/mas-universal/${packageJSON.productName}.app`)
const masPkgPath = path.join(process.cwd(), `dist/mas-universal/${packageJSON.productName}-${packageJSON.version}.pkg`);
// const masAppPath = path.join(process.cwd(), `dist/mas/${packageJSON.productName}.app`)
// const masPkgPath = path.join(process.cwd(), `dist/mas/${packageJSON.productName}-${packageJSON.version}.pkg`);
const resignScriptPath = path.join(process.cwd(), 'node_modules/electron-manager/dist/github-workflow/resignAndPackage.sh');

exports.default = async function () {
  let caughtError;

  console.log(chalk.green(`\n*-*-*- MAS re-sign: Starting for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));
  
  // Make sure MAS is enabled
  if (jetpack.exists(masAppPath)) {
    // Re-sign MAS
    await process_resignAndPackage()
    .catch(e => caughtError = e)
    if (caughtError) { return error(caughtError) }  

    // Upload MAS
    await process_uploadToMAS()
    .catch(e => caughtError = e)
    if (caughtError) { return error(caughtError) }      
  } else {
    console.log(chalk.yellow(`Skipping because MAS doesn't exist: ${masAppPath}`));
  }

  console.log(chalk.green(`*-*-*- MAS re-sign: Complete for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));

};

// Run if called from command line
if (require.main == module) {
  exports.default()
}

function asyncCommand(command) {
  return new Promise(function(resolve, reject) {
    exec(command, { stdio: 'inherit' },
      function (error, stdout, stderr) {
        if (error) {
          return reject(error);
        } else {
          return resolve(stdout);
        }
      }
    );       
  });
}

// Re-sign MAS
function process_resignAndPackage() {
  return new Promise(async function(resolve, reject) {
      const resignScript = (jetpack.read(resignScriptPath) || '').split('\n')
      
      console.log(chalk.blue(scriptName, `Re-signing and packaging: ${masPkgPath}...`));

      // Run re-signing commands
      for (var i = 0; i < resignScript.length; i++) {
        const command = resignScript[i]
          // Set up certs
          .replace(/{certificatePath}/ig, `${process.env.RUNNER_TEMP}/build_certificate.p12`)
          .replace(/{keychainPath}/ig, `${process.env.RUNNER_TEMP}/app-signing.keychain-db`)

          // Sign and package
          .replace(/{appName}/ig, packageJSON.productName)
          .replace(/{appPath}/ig, masAppPath)
          .replace(/{resultPath}/ig, masPkgPath)
          .replace(/{appKey}/ig, `3rd Party Mac Developer Application: ${process.env.APPLE_CERTIFICATE_NAME}`)
          .replace(/{installerKey}/ig, `3rd Party Mac Developer Installer: ${process.env.APPLE_CERTIFICATE_NAME}`)
          .replace(/{parentPlist}/ig, 'build/entitlements.mas.plist')
          .replace(/{childPlist}/ig, 'build/entitlements.mas.inherit.plist')
          .replace(/{loginHelperPlist}/ig, 'build/entitlements.mas.loginhelper.plist')
          .replace(/{frameworksPath}/ig, `${masAppPath}/Contents/Frameworks`)
          
        if (!command || command.startsWith('#')) { continue }
        
        console.log(chalk.blue(scriptName, `Running command: ${command}`));
        
        const commandResult = await asyncCommand(command).catch(e => e)
        if (commandResult instanceof Error) {
          return reject(commandResult);
        }
        if (commandResult) {
          console.log(chalk.blue(scriptName, `Command result: \n${commandResult}`));
        }
      }

      console.log(chalk.green(scriptName, `Successfully re-signed MAS`));

      return resolve();
  });
}

// Upload MAS
function process_uploadToMAS() {
  return new Promise(function(resolve, reject) {
    const command = `xcrun altool --upload-app -f "${masPkgPath}" -t osx -u ${process.env.APPLE_ID} -p ${process.env.APPLE_PASSWORD}`;

    console.log(chalk.blue(scriptName, `Uploading MAS: ${masPkgPath}...`));

    // Upload command
    asyncCommand(command)
    .then(r => {
      console.log(chalk.red(scriptName, `Successfully uploaded MAS`));
      return resolve(r)
    })
    .catch(e => reject(e))    

  });
}

// Log error
function error(e) {
  console.log(chalk.red(scriptName, `${e.message}`));
  throw new Error(e)
}
