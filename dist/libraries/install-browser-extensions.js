const jetpack = require('fs-jetpack');
const path = require('path');
const os = require('os');
const username = os.userInfo().username;
const arch = os.arch();
const Registry = require('winreg');

const CHROME_FILE = {
  external_update_url: 'https://clients2.google.com/service/update2/crx'
}
const DEFAULTS = {
  // https://developer.chrome.com/docs/extensions/mv3/external_extensions/#registry
  chrome: {
    mac: {
      path: '/Users/{username}/Library/Application Support/Google/Chrome/External Extensions/{id}.json',
      contents: CHROME_FILE,  
    },
    windows: {
      registry: {
        hive: Registry.HKLM, // HKEY_LOCAL_MACHINE
        x32: '\\Software\\Google\\Chrome\\Extensions\\{id}',
        x64: '\\Software\\Wow6432Node\\Google\\Chrome\\Extensions\\{id}',
      },
      contents: '',
    },
    linux: {
      SVGTextPathElement: '/opt/google/chrome/extensions/{id}.json',
      contents: CHROME_FILE,
    },
  },
  // https://extensionworkshop.com/documentation/publish/distribute-for-desktop-apps/
  firefox: {},

  // https://forums.opera.com/topic/29959/automatic-installation-of-opera-extension
  opera: {},
}

function InstallBrowserExtensions(Manager) {
  const self = this;

  self.Manager = Manager;
}

InstallBrowserExtensions.prototype.init = function () {
  const self = this;

  return new Promise(async function(resolve, reject) {
    try {
      const Manager = self.Manager;
      const data = Manager.storage.electronManager.get('data.current');
      const platformName = data.meta.os.name;

      // Loop through all browsers
      Object.keys(DEFAULTS)
      .forEach((key) => {
        const browser = DEFAULTS[key];
        const platform = browser[platformName];

        if (!platform) {
          return;
        }

        if (platform.path) {
          const finalPath = platform.path
            .replace(/{username}/igm, username)
            .replace(/{id}/igm, Manager.options.config.extension[key].id);
          
          Manager.log('[BrowserExtension] Writing to', finalPath);

          jetpack.write(path.join(finalPath), JSON.stringify(platform.contents));
        } else if (platform.registry) {
          const keyPath = platform.registry[arch]
            .replace(/{id}/igm, Manager.options.config.extension[key].id);

          const registry = new Registry({
            hive: platform.registry.hive,
            key: keyPath,
          });

          Manager.log('[BrowserExtension] Writing to', platform.registry.hive, keyPath, platform.contents);

          // Create the key
          registry.create((e) => {
            if (e) {
              return reject(`Failed to create key: ${e.message}`)
            } else {
              Manager.log('Key created');
              
              // Create 'update_url' value
              registry.set('update_url', Registry.REG_SZ, 'https://clients2.google.com/service/update2/crx', (e) => {
                if (e) {
                  return reject(`Failed to create update_url: ${e.message}`)
                } else {
                  Manager.log('update_url created');
                }
              });
            }
          });
        }
      })      
    } catch (e) {
      return reject(e);
    }
  });
};

// @@@ NOTE, this function does not currently resolve

module.exports = InstallBrowserExtensions;
