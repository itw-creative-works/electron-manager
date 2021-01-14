/*
  Libraries
*/
const { exec, execFile } = require('child_process');
let jetpack;

/*
  ElectronManager Class
*/
function ElectronManager(options) {
  const self = this;

  self.options = options || {};
  self.options.appName = self.options.appName || '';
  self.options.appId = self.options.appId || self.options.appName.toLowerCase() || '';

  // Export libraries for use here
  self._libraries = {};
  self._libraries.electron = self.options.electron || require('electron');
  // if (self._libraries.electron.remote) {
  //   self.process = 'renderer';
  //   self._libraries.electron = self._libraries.electron.remote;
  // } else {
  //   self.process = 'main';
  // }

  // Properties
  self.environment = require('electron-is-dev') ? 'development' : 'production';
  self.isLinux = process.platform !== 'darwin' && process.platform !== 'win32';
  self.isSnap = self.isLinux ? require('electron-is-snap').isSnap : false;
  // self.isRenderer = require('is-electron-renderer')();
  if (process.mas) {
    self.storeName = 'mac';
  } else if (process.windowsStore) {
    self.storeName = 'windows';
  } else if (self.isSnap) {
    self.storeName = 'snap';
  } else {
    self.storeName = 'none';
  }
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
      self._libraries.electron.app.setAsDefaultProtocolClient(protocol);
      if (self.isLinux) {
        await asyncCmd(`xdg-mime default ${options.appId}.desktop "x-scheme-handler/${protocol}"`).catch(e => console.error);
        await asyncCmd(`xdg-settings set default-url-scheme-handler ${protocol}`).catch(e => console.error);
      }
      return;
    },
    getApplicationNameForProtocol: async (protocol) => {
      const nativeCheck = self._libraries.electron.app.getApplicationNameForProtocol(protocol);
      let linuxCheck;
      if (self.isLinux) {
        linuxCheck = await asyncCmd(`xdg-settings get default-url-scheme-handler ${protocol.replace('://', '')}`)
          .catch(e => {
            console.error(e);
            return '';
          })
      }
      return linuxCheck || nativeCheck || '';
    },
    isDefaultProtocolClient: async (protocol, options) => {
      options = options || {};
      options.appId = options.appId || self.options.appId;
      // options.appName = options.appName || self.options.appName;
      const comparator = (self.environment === 'development') ? 'electron' : options.appId.toLowerCase();
      const nativeCheck = self._libraries.electron.app.isDefaultProtocolClient(protocol);
      let linuxCheck;
      if (self.isLinux) {
        linuxCheck = await asyncCmd(`xdg-settings get default-url-scheme-handler ${protocol}`)
          .catch(e => {
            console.error(e);
            return '';
          })
          .then(r => r.toLowerCase().includes(comparator))
        return nativeCheck || linuxCheck || false;
      }
      return nativeCheck || false;
    },
    setLoginItemSettings: async (options) => {
      options = options || {};
      options.openAtLogin = typeof options.openAtLogin === 'undefined' ? true : options.openAtLogin;
      options.args = (typeof options.args === 'undefined' ? [] : options.args).concat('--was-opened-at-login', `"true"`);
      const appName = options.appName || self.options.appName;
      delete options.appName;

      self._libraries.electron.app.setLoginItemSettings(options);

      if (self.isLinux) {
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
    },

    // Custom methods
    // getAlternateAppId: async (protocol) => {
    //   const alternateId = await self.app().getApplicationNameForProtocol(protocol)
    //   if (self.isLinux) {
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
      } if (self.isLinux) {
        await asyncCmd(`xdg-settings set default-web-browser ${options.appId}.desktop`).catch(e => console.error)
      }
    },
    isDefaultBrowser: async (options) => {
      options = options || {};
      options.appId = options.appId || self.options.appId;
      const comparator = (self.environment === 'development') ? 'electron' : options.appId.toLowerCase();
      const matchesApplication =
        `${await self.app().getApplicationNameForProtocol('http://')}`.toLowerCase().includes(comparator)
        || `${await self.app().getApplicationNameForProtocol('https://')}`.toLowerCase().includes(comparator)
      const matchesProtocol =
        `${await self.app().isDefaultProtocolClient('http')}`.toLowerCase().includes(comparator)
        || `${await self.app().isDefaultProtocolClient('https')}`.toLowerCase().includes(comparator)
      let linuxCheck;

      if (self.isLinux) {
        linuxCheck = await asyncCmd(`xdg-settings get default-web-browser`)
          .catch(e => {
            console.error(e);
            return '';
          });
        linuxCheck = linuxCheck.toLowerCase().includes(comparator);

        return nativeCheck || linuxCheck || false;
      }
      return nativeCheck || false;
    },
    wasOpenedAtLogin: async (options) => {
      options = options || {};
      options.threshold = typeof options.threshold === 'undefined' ? 120 : options.threshold;

      const nativeCheck = self._libraries.electron.app.getLoginItemSettings().wasOpenedAtLogin;
      const argCheck = process.argv.filter(a => a.includes('--was-opened-at-login')).length > 0;
      let specialCheck;

      // Special use cases for these... 'special' platforms
      if (process.windowsStore || self.isLinux) {
        const username = require('os').userInfo().username;
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

      return nativeCheck || argCheck || specialCheck || false;
    }
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
