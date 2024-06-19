const jetpack = require('fs-jetpack');

const path = require('path');

module.exports = function () {
  return new Promise(function(resolve, reject) {
    // Generate build.json
    const now = new Date();

    const buildJSON = {
      date: {
        timestamp: now.toISOString(),
        timestampUNIX: Math.round(now.getTime() / 1000),      
      },
      isCI: process.env.CI === 'true',
    }

    // ignore files?
    // jetpack.write(path.join(process.cwd(), 'electron-manager', '_generated', 'build', '.gitignore'), '*\n*/');    

    jetpack.write(path.join(process.cwd(), 'electron-manager', '_generated', 'build', 'build.json'), buildJSON);    

    // Run custom build.js if it exists, otherwise just exit
    const libPath = path.join(process.cwd(), 'electron-manager', 'build.js');

    if (!jetpack.exists(libPath)) {
      return resolve()
    }

    try {
      require(libPath)()
      .then(r => {
        return resolve(r)
      })
      .catch(e => {
        return reject(e)
      })             
    } catch (e) {
      return reject(e)
    }

  });
}
