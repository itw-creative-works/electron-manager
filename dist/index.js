/*
  Libraries
*/
const { exec, execFile } = require('child_process');
let jetpack;
let electronIsDev;
const _ = require('lodash');

/*
  ElectronManager Class
*/
function ElectronManager(options) {
  const self = this;

  self.require = require;

  self.options = options || {};
  self.options.appName = self.options.appName || '';
  self.options.appId = self.options.appId || self.options.appName.toLowerCase().replace(/\s/g, '') || '';

  // Export libraries for use here
  self._libraries = {};
  self.electron = self.options.electron || require('electron');

  self._global = {};
  self._location = undefined;

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
  ElectronManager Central
*/
ElectronManager.prototype.initialize = function (options) {
  const self = this;
  options = options || {};
  self._location = options.location.toLowerCase();

  return new Promise(async function(resolve, reject) {
    if (self._location === 'main') {
      const { ipcMain, app } = self.electron;
      const os = require('os');

      options.openAtLogin = typeof options.openAtLogin === 'undefined' ? true : options.openAtLogin;
      options.setProtocolHandler = typeof options.setProtocolHandler === 'undefined' ? true : options.setProtocolHandler;

      self._globalListenersWCs = self._globalListenersWCs || [];

      // Initialize Global
      self._global = {
        meta: {
          startTime: new Date().toISOString(),
          // systemColorPreference: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
          // theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
          environment: self.properties().isDevelopment() ? 'development' : 'production',
          // edition: packageJSON.edition || 'standard',
          version: app.getVersion(),
          ip: '127.0.0.1',
          country: 'unknown',
          deviceId: '',
          userAgent: '',
          os: {
            username: os.userInfo().username,
            platform: os.platform(),
            name: os.platform() === 'win32' ? 'windows' : (os.platform() === 'darwin' ? 'mac' : 'linux'),
            version: process.getSystemVersion(),
            locale: app.getLocale(),
          },
          indicator: {
            soft: '',
            strict: '',
          }
        },
        paths: {
          mainDir: __dirname,
          userData: app.getPath('userData'),
          appData: app.getPath('appData'),
          downloads: app.getPath('downloads'),
          // module: app.getPath('module'),
          temp: app.getPath('temp'),
          // extensions: 'SET BELOW',
          // dependencies: 'SET BELOW',
          // resources: 'SET BELOW'
        },
      }

      ipcMain.handle('_electron-manager-message', async (event, message) => {
        message = message || {};
        message.payload = message.payload || {};

        console.log('=====HERE', message);

        if (message.command === 'global:get') {
          // console.log('=====GET 2', message.payload.path, message.payload.value);
          return self.global().get(message.payload.path, message.payload.value)
        } else if (message.command === 'global:set') {
          return self.global().set(message.payload.path, message.payload.value)
        } else if (message.command === 'global:register') {
          const senderWc = self.electron.webContents.fromId(_.get(event, 'sender.id', -1))
          if (senderWc) {
            self._globalListenersWCs = self._globalListenersWCs.concat(senderWc)
          }
        }
      })

      if (options.openAtLogin) {
        await self.app().setLoginItemSettings().catch(e => console.error);
      }

      if (options.setProtocolHandler) {
        await self.app().setAsDefaultProtocolClient(self.options.appId).catch(e => console.error);
      }

      return resolve(self);
    } else {
      self.electron.ipcRenderer.on('_electron-manager-message', function (event, message) {
        message = message || {};
        message.payload = message.payload || {};

        console.log('-----MESSAGE', message);

        if (message.command === 'global:set') {
          const resolvedPath = `_global${message.payload.path ? '.' + message.payload.path : ''}`;
          // console.log('-----GLOBAL:SET');
          return _.set(self, resolvedPath, message.payload.value)
          // return self.global().set(message.payload.path, message.payload.value)
        }
      })
      if (options.registerGlobalListener !== false) {
        await self.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'global:register'})
      }
      // await self.global().get();
      await self.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'global:get'})
      .then(r => {
        console.log('=====r', r);
        self._global = r;
        // _.set(self._global, '', r)
      })
      return resolve(self);
    }
  });
}

ElectronManager.prototype.global = function () {
  const self = this;
  return {
    get: function (path, value) {
      return new Promise(function(resolve, reject) {
        const resolvedPath = `_global${path ? '.' + path : ''}`
        console.log('=====GET 0', resolvedPath, value);

        if (self._location === 'main') {
          // console.log('=====GET 3', path, value);
          return resolve(_.get(self, resolvedPath, value))
        } else {
          // console.log('=====GET 1', path, value);
          // return resolve(self.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'global:get', payload: {path: path, value: value}}))
          return resolve(_.get(self, resolvedPath, value))
        }
      });
    },
    set: function (path, value) {
      return new Promise(async function(resolve, reject) {
        const resolvedPath = `_global${path ? '.' + path : ''}`;

        if (self._location === 'main') {
          const setResult = _.set(self, resolvedPath, value);

          self._globalListenersWCs
          .forEach((wc, i) => {
            console.log('===SENDING 1', path, value);
            wc.send('_electron-manager-message', {
              command: 'global:set',
              payload: {path: path, value: value},
              // payload: {path: path, value: value},
            })
          });

          return resolve(setResult)
        } else {
          const setResult = _.set(self, resolvedPath, value);
          console.log('===SENDING 2', path, value);
          await self.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'global:set', payload: {path: path, value: value}})
          // await self.electron.ipcRenderer.invoke('_electron-manager-message', {penis: 'PENIS', command: 'global:set'})
          return resolve(setResult)
        }
      });
    },
  }
}


/*
  ElectronManager Sub-Classes
*/
ElectronManager.prototype.app = function () {
  const self = this;
  return {
    setAsDefaultProtocolClient: async (protocol, options) => {
      options = options || {};
      options.appId = options.appId || self.options.appId;
      protocol = protocol || options.appId;
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


ElectronManager.prototype.properties = function () {
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
