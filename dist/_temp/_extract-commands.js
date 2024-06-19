const jetpack = require('fs-jetpack');
const path = require('path');

const resignScriptPath = path.join(process.cwd(), 'dist/github-workflow/resignAndPackage.sh');

const resignScript = (jetpack.read(resignScriptPath) || '').split('\n')

// Run re-signing commands
for (var i = 0; i < resignScript.length; i++) {
  const command = resignScript[i]
    // Set up certs
    .replace(/{certificatePath}/ig, `$RUNNER_TEMP/build_certificate.p12`)
    .replace(/{keychainPath}/ig, `$RUNNER_TEMP/app-signing.keychain-db`)

    // Sign and package
    // .replace(/{appName}/ig, packageJSON.productName)
    // .replace(/{appPath}/ig, masAppPath)
    // .replace(/{resultPath}/ig, masPkgPath)
    // .replace(/{appKey}/ig, `3rd Party Mac Developer Application: ${process.env.APPLE_CERTIFICATE_NAME}`)
    // .replace(/{installerKey}/ig, `3rd Party Mac Developer Installer: ${process.env.APPLE_CERTIFICATE_NAME}`)
    // .replace(/{parentPlist}/ig, 'build/entitlements.mas.plist')
    // .replace(/{childPlist}/ig, 'build/entitlements.mas.inherit.plist')
    // .replace(/{loginHelperPlist}/ig, 'build/entitlements.mas.loginhelper.plist')
    // .replace(/{frameworksPath}/ig, `${masAppPath}/Contents/Frameworks`)
    
  if (!command) { continue }
  
  console.log(command);

}
