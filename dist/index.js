/*
  Libraries
*/
const { exec, execFile } = require('child_process');
let jetpack;
let electronIsDev;
let Store;
let Updater;
const _ = require('lodash');

/*
  ElectronManager Class
*/
function ElectronManager(options) {
  const self = this;

  self.require = require;

  self.options = options || {};
  self.options.libraries = options.libraries || {};
  self.options.appName = self.options.appName || '';
  self.options.appId = self.options.appId || self.options.appName.toLowerCase().replace(/\s/g, '') || '';

  // Export libraries for use here
  self.libraries = {
    electron: self.options.libraries.electron || require('electron'),
    remote: self.options.libraries.remote,
    electronUpdater: self.options.libraries.electronUpdater,
    webManager: null,
  };
  // self.electron = self.options.libraries.electron || require('electron');
  // self.remote = self.options.libraries.remote;
  // self.electronUpdater = self.options.libraries.electronUpdater;

  self._global = {};
  self._handlers = {
    onDeepLink: function () {},
    onSecondInstance: function () {},
  };
  self._location = undefined;

  // console.log("require('lodash')", require('lodash'));
  // try {
  //   self.remote = self.options.libraries.remote || require('@electron/remote');
  // } catch (e) {
  //   // self.remote = self.options.libraries.remote || require('@electron/remote/main');
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
      const { ipcMain, app } = self.libraries.electron;
      const os = require('os');
      const {get, set} = require('lodash');
      const AccountResolver = new (require('web-manager/lib/account.js'))({
        utilities: {
          get: get,
          set: set,
        },
        dom: function () {},
      });
      // AccountResolver.Manager = new (require('web-manager'))()

      Store = require('electron-store')

      // self.libraries.remote = self.libraries.remote || require('@electron/remote/main');
      self.libraries.remote.initialize();
      self.windows = [];
      self.allowQuit = false;
      self.isQuitting = false;
      self.deeplinkingUrl = null;
      self.secondInstanceParameters = null;

      options.openAtLogin = typeof options.openAtLogin === 'undefined' ? true : options.openAtLogin;
      options.setProtocolHandler = typeof options.setProtocolHandler === 'undefined' ? true : options.setProtocolHandler;
      options.hideIfOpenedAtLogin = typeof options.hideIfOpenedAtLogin === 'undefined' ? true : options.hideIfOpenedAtLogin;
      options.autoUpdateInterval = typeof options.autoUpdateInterval === 'undefined' ? 60000 * 60 * 12 : options.autoUpdateInterval;
      options.singleInstance = typeof options.singleInstance === 'undefined' ? true : options.singleInstance;
      options.log = typeof options.log === 'undefined' ? false : options.log;

      self._globalListenersWCs = self._globalListenersWCs || [];
      self._registeredRenderers = self._registeredRenderers || [];
      self._updateTimeout;

      if (options.log) {
        self._loggerQueue = [];
        self._log = function () {
          if (self.logger) {
            if (self._loggerQueue.length > 0) {
              for (var i = 0; i < self._loggerQueue.length; i++) {
                self.logger(...self._loggerQueue[i])
              }
              self._loggerQueue = [];
            }
            self.logger(...arguments)
          } else {
            self._loggerQueue.push(arguments)
          }
        }
      } else {
        self._log = function () {}
      }

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
        user: AccountResolver._resolveAccount(),
      }

      // console.log('---self._global.user', self._global.user);

      Store.initRenderer();

      const gotTheLock = app.requestSingleInstanceLock()

      if (!gotTheLock && !process.mas) {
        if (options.singleInstance) {
          self.allowQuit = true;
          self.isQuitting = true;
          app.exit();
        } else {
            // handle second instance deep link here
        }
      } else {
        app.on('second-instance', (event, commandLine, workingDirectory) => {
          if (process.platform !== 'darwin') {
            self.deeplinkingUrl = commandLine;
          }
          // self.app().onDeepLink();
          self._handlers.onDeepLink(self.deeplinkingUrl)

          self.secondInstanceParameters = {event: event, commandLine: commandLine, workingDirectory: workingDirectory}
          // self.app().onSecondInstance()
          self._handlers.onSecondInstance(self.secondInstanceParameters)
        })

        // app.on('ready', function () {
        //   createMainWindow();
        // })
      }

      app.on('will-finish-launching', function () {
        // Protocol handler for osx
        app.on('open-url', function(event, url) {
          event.preventDefault()
          self.deeplinkingUrl = url;
          // self.app().onDeepLink();
          self._handlers.onDeepLink(self.deeplinkingUrl)
        })
        app.on('open-file', function(event, path) {
          event.preventDefault()
          self.deeplinkingUrl = path;
          // self.app().onDeepLink();
          self._handlers.onDeepLink(self.deeplinkingUrl)
        })
      })

      if (process.platform !== 'darwin') {
        self.deeplinkingUrl = process.argv;
        // self.app().onDeepLink();
        self._handlers.onDeepLink(self.deeplinkingUrl)
      }

      if (options.hideIfOpenedAtLogin) {
        await self.app().wasOpenedAtLogin()
        .then(wasOpenedAtLogin => {
          if (wasOpenedAtLogin) {
            app.dock.hide();
            app.hide();
          }
        })
        .catch(e => console.error);
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
          const senderWc = self.libraries.electron.webContents.fromId(_.get(event, 'sender.id', -1))
          if (senderWc) {
            self._globalListenersWCs = self._globalListenersWCs.concat(senderWc)
          }
        } else if (message.command === 'renderer:register') {
          const senderWc = self.libraries.electron.webContents.fromId(_.get(event, 'sender.id', -1))
          if (senderWc) {
            self._registeredRenderers = self._registeredRenderers.concat(senderWc)
          }
        } else if (message.command === 'activity:last-action') {
          clearTimeout(self._updateTimeout);
          self._updateTimeout = setTimeout(function () {
            Updater = Updater || require('./libraries/updater.js')
            Updater.update({Manager: self});
          }, options.autoUpdateInterval);
        }
      })

      if (options.openAtLogin) {
        await self.app().setLoginItemSettings().catch(e => console.error);
      }

      if (options.setProtocolHandler) {
        await self.app().setAsDefaultProtocolClient(self.options.appId).catch(e => console.error);
      }

      self.sendToRegisteredRenderers = function (command, payload) {
        self._registeredRenderers
        .forEach((wc, i) => {
          wc.send('_electron-manager-message', {
            command: command,
            payload: payload,
          })
        });
      }

      setTimeout(function () {
        self._log('Initialized Electron Manager');
      }, 1);

      return resolve(self);
    } else {
      options.registerGlobalListener = typeof options.registerGlobalListener === 'undefined' ? true : options.registerGlobalListener;
      options.mainRenderer = typeof options.mainRenderer === 'undefined' ? true : options.mainRenderer;
      options.setupPromoHandler = typeof options.setupPromoHandler === 'undefined' ? true : options.setupPromoHandler;

      self.libraries.electron.ipcRenderer.on('_electron-manager-message', function (event, message) {
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
        await self.libraries.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'global:register'})
      }

      if (options.mainRenderer === true) {
        await self.libraries.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'renderer:register'})

        const _sendActivity = _.throttle(function () {
          self.libraries.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'activity:last-action'})
        }, 5000, {leading: true, trailing: true})
        try {
          _sendActivity()
          document.addEventListener('blur', () => _sendActivity)
          document.addEventListener('click', () => _sendActivity)
        } catch (e) {

        }

        if (options.webManagerConfig) {
          self.libraries.webManager = new (require('./libraries/web-manager.js'))(self);
          self.libraries.webManager = await self.libraries.webManager.init(options.webManagerConfig);
          console.log('--self.libraries.webManager', self.libraries.webManager);
          console.log('--self.libraries.promoServer', self.libraries.promoServer);
        }

        // if (options.setupPromoHandler) {
        //   setInterval(function () {
        //     console.log('---window.firebase', window.firebase);
        //   }, 10);
        //   // self.libraries.promoServer = new (require('promo-server'))({
        //   //   app: self.options.appId, // <any string>
        //   //   environment: 'electron', // web | electron | extension
        //   //   log: true, // true | false
        //   //   // firebase: firebase // reference to firebase (one will be implied if not provided)
        //   // });
        //   // self.libraries.promoServer.handle(function (payload) {
        //   //   // console.log('promoServer payload', payload);
        //   //   if (payload.content.type === 'url') {
        //   //     self.libraries.electron.shell.openExternal(payload.content.options.url);
        //   //   }
        //   // })
        // }

      }

      // await self.global().get();
      await self.libraries.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'global:get'})
      .then(r => {
        console.log('=====r', r);
        self._global = r;
        // _.set(self._global, '', r)
      })
      return resolve(self);
    }
  });
}

ElectronManager.prototype.getRegisteredRenderers = function () {
  const self = this;
  if (self._location === 'main') {
    return self._globalListenersWCs || [];
  }
  throw new Error('Cannot get registered renderers from a non-main process')
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
          await self.libraries.electron.ipcRenderer.invoke('_electron-manager-message', {command: 'global:set', payload: {path: path, value: value}})
          // await self.libraries.electron.ipcRenderer.invoke('_electron-manager-message', {penis: 'PENIS', command: 'global:set'})
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
      self.libraries.electron.app.setAsDefaultProtocolClient(protocol);
      if (self.properties().isLinux()) {
        await asyncCmd(`xdg-mime default ${options.appId}.desktop "x-scheme-handler/${protocol}"`).catch(e => console.error);
        await asyncCmd(`xdg-settings set default-url-scheme-handler ${protocol} ${options.appId}`).catch(e => console.error);
      }
      // console.log('setAsDefaultProtocolClient', protocol, options);
      return;
    },
    getApplicationNameForProtocol: async (protocol) => {
      protocol = protocol.split('://')[0];
      const nativeCheck = self.libraries.electron.app.getApplicationNameForProtocol(`${protocol}://`);
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
      const nativeCheck = self.libraries.electron.app.isDefaultProtocolClient(protocol);
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

      self.libraries.electron.app.setLoginItemSettings(options);

      if (self.properties().isLinux()) {
        if (!self.libraries.linuxAutoLauncher) {
          const AutoLaunch = require('auto-launch');
          self.libraries.linuxAutoLauncher = new AutoLaunch({
            name: appName,
          });
        }
        try {
          if (options.openAtLogin) {
            self.libraries.linuxAutoLauncher.enable();
          } else {
            self.libraries.linuxAutoLauncher.disable();
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

      const nativeCheck = self.libraries.electron.app.getLoginItemSettings().wasOpenedAtLogin;
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
    },
    onDeepLink: function (fn) {
      self._handlers.onDeepLink = fn;
      if (self.deeplinkingUrl) {
        self._handlers.onDeepLink(self.deeplinkingUrl)
      }
      // return new Promise(function(resolve, reject) {
      //   // self._log('onDeepLink() self.deeplinkingUrl=', self.deeplinkingUrl);
      //   if (self.deeplinkingUrl) {
      //     let url = self.deeplinkingUrl;
      //     // await Tools.poll(function() {
      //     //   return rendererInitialized;
      //     // }, {
      //     //   timeout: 0
      //     // });
      //
      //     // if (Array.isArray(url)) {
      //     //   for (var i = 0, l = url.length; i < l; i++) {
      //     //     let item = url[i];
      //     //     if (typeof item === 'string'
      //     //       && (
      //     //         item.startsWith('http://')
      //     //         || item.startsWith('https://')
      //     //         || item.startsWith('somiibo://')
      //     //         || item.startsWith(`discord-${Global.apiKeys.discordClientId}://`)
      //     //         || item.endsWith(`.html`)
      //     //         || item.endsWith(`.htm`)
      //     //         || item.endsWith(`.pdf`)
      //     //       )) {
      //     //       url = item.replace(/\/+$/, "");
      //     //       break;
      //     //     }
      //     //   }
      //     // }
      //
      //     // if (url && typeof url === 'string') {
      //     //   // On this, don't test for the :// at end because it may have been removed from above regex
      //     //   url = url.startsWith(`discord-${Global.apiKeys.discordClientId}`) ? 'somiibo://dashboard' : url;
      //     // }
      //
      //     return resolve(url)
      //   }
      // });
    },
    onSecondInstance: function (fn) {
      self._handlers.onSecondInstance = fn;
      if (self.secondInstanceParameters) {
        self._handlers.onSecondInstance(self.secondInstanceParameters)
      }
      // return new Promise(function(resolve, reject) {
      //   if (self.secondInstanceParameters) {
      //     return resolve(self.secondInstanceParameters);
      //   }
      // });
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
