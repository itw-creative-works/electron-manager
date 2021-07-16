/*
  Libraries
*/
const { exec, execFile } = require('child_process');
let jetpack;
let electronIsDev;

/*
  ElectronManager Class
*/
function ElectronManager(options) {
  const self = this;

  self.require = require;

  self.options = options || {};
  self.options.appName = self.options.appName || '';
  self.options.appId = self.options.appId || self.options.appName.toLowerCase() || '';

  // Export libraries for use here
  self._libraries = {};
  self.electron = self.options.electron || require('electron');

  // console.log("require('lodash')", require('lodash'));
  // try {
  //   self.remote = self.options.remote || require('@electron/remote');
  // } catch (e) {
  //   // self.remote = self.options.remote || require('@electron/remote/main');
  //   console.warn("Couldn't load remote, we are in main process.");
  // }
  // if (self.electron.remote) {
  //   self.process = 'renderer';
  //   self.electron = self.electron.remote;
  // } else {
  //   self.process = 'main';
  // }

  // Properties
  // self.properties().isDevelopment() = require('electron-is-dev') ? 'development' : 'production';

}

/*
  ElectronManager Sub-Classes
*/
ElectronManager.prototype.app = function() {
  const self = this;
  return {
    setAsDefaultProtocolClient: async (protocol, options) => {
      options = options || {};
      options.appId = options.appId || self.options.appId;
      // options.appName = options.appName || self.options.appName;
      self.electron.app.setAsDefaultProtocolClient(protocol);
      if (self.properties().isLinux()) {
        await asyncCmd(`xdg-mime default ${options.appId}.desktop "x-scheme-handler/${protocol}"`).catch(e => console.error);
        await asyncCmd(`xdg-settings set default-url-scheme-handler ${protocol} ${options.appId}`).catch(e => console.error);
      }
      // console.log('setAsDefaultProtocolClient', protocol, options);
      return;
    },
    getApplicationNameForProtocol: async (protocol) => {
      protocol = protocol.split('://')[0];
      const nativeCheck = self.electron.app.getApplicationNameForProtocol(`${protocol}://`);
      let linuxCheck;
      if (self.properties().isLinux()) {
        linuxCheck = await asyncCmd(`xdg-settings get default-url-scheme-handler ${protocol}`)
          .catch(e => {
            console.error(e);
            return '';
          })
      }
      // console.log('getApplicationNameForProtocol', protocol, nativeCheck, linuxCheck);
      return linuxCheck || nativeCheck || '';
    },
    isDefaultProtocolClient: async (protocol, options) => {
      options = options || {};
      options.appId = options.appId || self.options.appId;
      // options.appName = options.appName || self.options.appName;
      const comparator = (self.properties().isDevelopment()) ? 'electron' : options.appId.toLowerCase();
      const nativeCheck = self.electron.app.isDefaultProtocolClient(protocol);
      let linuxCheck;
      if (self.properties().isLinux()) {
        linuxCheck = await asyncCmd(`xdg-settings get default-url-scheme-handler ${protocol}`)
          .catch(e => {
            console.error(e);
            return '';
          })
          .then(r => r.toLowerCase().includes(comparator))
        return nativeCheck || linuxCheck || false;
      }
      // console.log('isDefaultProtocolClient', nativeCheck, linuxCheck);
      return nativeCheck || false;
    },
    setLoginItemSettings: async (options) => {
      options = options || {};
      options.openAtLogin = typeof options.openAtLogin === 'undefined' ? true : options.openAtLogin;
      options.args = (typeof options.args === 'undefined' ? [] : options.args).concat('--was-opened-at-login', `"true"`);
      const appName = options.appName || self.options.appName;
      delete options.appName;

      self.electron.app.setLoginItemSettings(options);

      if (self.properties().isLinux()) {
        if (!self._libraries.linuxAutoLauncher) {
          const AutoLaunch = require('auto-launch');
          self._libraries.linuxAutoLauncher = new AutoLaunch({
            name: appName,
          });
        }
        try {
          if (options.openAtLogin) {
            self._libraries.linuxAutoLauncher.enable();
          } else {
            self._libraries.linuxAutoLauncher.disable();
          }
        } catch (e) {
          console.error(e);
        }
      }
      // console.log('setLoginItemSettings', options);
    },

    // Custom methods
    // getAlternateAppId: async (protocol) => {
    //   const alternateId = await self.app().getApplicationNameForProtocol(protocol)
    //   if (self.properties().isLinux()) {
    //
    //   } else {
    //     return self.options.appId;
    //   }
    // },
    setAsDefaultBrowser: async (options) => {
      options = options || {};
      options.appId = options.appId || self.options.appId;
      options.appName = options.appName || self.options.appName;
      await self.app().setAsDefaultProtocolClient('http').catch(e => console.error);
      await self.app().setAsDefaultProtocolClient('https').catch(e => console.error);
      if (process.platform === 'win32' && options.setUserFTAPath) {
        jetpack = jetpack || require('fs-jetpack');
        if (jetpack.exists(options.setUserFTAPath)) {
          await executeFile(options.setUserFTAPath, ['http', `Applications\\${options.appName}.exe`]).catch(e => console.error);
          await executeFile(options.setUserFTAPath, ['https', `Applications\\${options.appName}.exe`]).catch(e => console.error);
        }
      } if (self.properties().isLinux()) {
        await asyncCmd(`xdg-settings set default-web-browser ${options.appId}.desktop`).catch(e => console.error)
      }
      // console.log('setAsDefaultBrowser', options);
    },
    isDefaultBrowser: async (options) => {
      options = options || {};
      options.appId = options.appId || self.options.appId;
      const comparator = (self.properties().isDevelopment()) ? 'electron' : options.appId.toLowerCase();
      const matchesApplication =
        `${await self.app().getApplicationNameForProtocol('http://')}`.toLowerCase().includes(comparator)
        || `${await self.app().getApplicationNameForProtocol('https://')}`.toLowerCase().includes(comparator)
      const matchesProtocol =
        `${await self.app().isDefaultProtocolClient('http')}`.toLowerCase().includes(comparator)
        || `${await self.app().isDefaultProtocolClient('https')}`.toLowerCase().includes(comparator)
      let linuxCheck;

      if (self.properties().isLinux()) {
        linuxCheck = await asyncCmd(`xdg-settings get default-web-browser`)
          .catch(e => {
            console.error(e);
            return '';
          });
        linuxCheck = linuxCheck.toLowerCase().includes(comparator);

        // console.log('isDefaultBrowser', options, matchesApplication, matchesProtocol, linuxCheck);
        return matchesApplication || matchesProtocol || linuxCheck || false;
      }
      // console.log('isDefaultBrowser', options, matchesApplication, matchesProtocol);
      return matchesApplication || matchesProtocol || false;
    },
    wasOpenedAtLogin: async (options) => {
      options = options || {};
      options.threshold = typeof options.threshold === 'undefined' ? 120 : options.threshold;

      const nativeCheck = self.electron.app.getLoginItemSettings().wasOpenedAtLogin;
      const argCheck = process.argv.filter(a => a.includes('--was-opened-at-login')).length > 0;
      let specialCheck;

      // Special use cases for these... 'special' platforms
      if (process.windowsStore || self.properties().isLinux()) {
        const os = require('os');
        const username = os.userInfo().username;
        const moment = require('moment');
        let secSinceLogin;
        if (process.windowsStore) {
          secSinceLogin = await asyncCmd(`net user ${username} | findstr /B /C:"Last logon"`)
            .then(r => moment(r.replace('Last logon', '').trim()))
            .catch(e => moment())
            .then(r => moment().diff(r, 'seconds', false))
        } else {
          secSinceLogin = await asyncCmd(`last -n 1 ${username} | awk '/still logged in/ {print $5,$6,$7}'`)
            .then(r => moment(`${r.trim()} ${moment().format('yyyy')}`))
            .catch(e => moment())
            .then(r => moment().diff(r, 'seconds', false))
        }
        specialCheck = os.uptime() < options.threshold || secSinceLogin < options.threshold;
      }

      // console.log('wasOpenedAtLogin', options, nativeCheck, argCheck, specialCheck);
      return nativeCheck || argCheck || specialCheck || false;
    }
  }
};


ElectronManager.prototype.properties = function() {
  const self = this;
  return {
    isDevelopment: function () {
      // let electronIsDev;
      // console.log('---self.remote', self.remote);
      // if (self.remote) {
      //   electronIsDev = self.remote.require('electron-is-dev')
      // } else {
      //   electronIsDev = require('electron-is-dev')
      // }
      // return electronIsDev;
      return self.require('electron-is-dev')
    },
    isLinux: function () {
      return process.platform !== 'darwin' && process.platform !== 'win32';
    },
    isSnap: function () {
      return self.properties().isLinux() ? require('electron-is-snap').isSnap : false;
    },
    isStore: function () {
      if (process.mas) {
        return 'mac';
      } else if (process.windowsStore) {
        return 'windows';
      } else if (self.properties().isSnap()) {
        return 'snap';
      } else {
        return false;
      }
    },

  }
};


/*
  Helpers
*/
function asyncCmd(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error || stderr) {
        return reject(new Error(`${error}: ${stderr}`));
      } else {
        return resolve(stdout);
      }
    });
  });
}

function executeFile(path, parameters) {
  return new Promise((resolve, reject) => {
    execFile(path, parameters, (err, data) => {
      if (err) {
        return reject(err);
      } else {
        return resolve(data.toString());
      }
    });
  });
}

/*
  Module
*/
module.exports = ElectronManager;


/*
  TODO:
    * Add an event emitter for 'deep-link'
*/
