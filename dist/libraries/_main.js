const jetpack = require('fs-jetpack')
const moment = require('moment');
const powertools = require('node-powertools');
const path = require('path')
const os = require('os');
const { get, set, lowerFirst } = require('lodash');
const uuid = require('uuid');
const Manager = require('web-manager');
const AccountResolver = new (require('web-manager/lib/account.js'))({
  utilities: {
    get: get,
    set: set,
  },
  dom: function () {},
});

const platformName = process.platform === 'darwin'
  ? 'mac'
  : (process.platform === 'win32' ? 'windows' : 'linux')
const MAIN_WINDOW_CHANGE_EVENTS = [
  'show', 'hide',
  // 'minimize', 'maximize', 'unmaximize', 'restore',
]

let shutdownHandled = false;
let devlopmentRMDownload = false;
let copyFromVolumeTimeout;
let restartManagerAttempts = 0;
let preloaderWindow;

function Main() {
}

Main.prototype.init = async function (params) {
  const self = this;
  const parent = params.parent;
  const options = params.options;
  self.parent = parent;

  parent.performance.mark('manager_initialize_main_start');

  const { ipcMain, app } = parent.libraries.electron;
  const environment = parent.isDevelopment ? 'development' : 'production'

  // Load package.json
  const electronManagerPackage = require('../../package.json');

  // Log
  console.log(`\n\n\n\n\nLaunching ${app.getName()}: environment=${environment}, app=${app.getVersion()}, electron=${process.versions.electron}, node=${process.versions.node}, manager=${electronManagerPackage.version}`);

  // Set options
  options.hideInitially = typeof options.hideInitially === 'undefined' ? false : options.hideInitially;
  options.openAtLogin = typeof options.openAtLogin === 'undefined' ? true : options.openAtLogin;
  options.setProtocolHandler = typeof options.setProtocolHandler === 'undefined' ? true : options.setProtocolHandler;
  options.hideIfOpenedAtLogin = typeof options.hideIfOpenedAtLogin === 'undefined' ? true : options.hideIfOpenedAtLogin;
  options.autoUpdateInterval = typeof options.autoUpdateInterval === 'undefined' ? 60000 * 60 * 12 : options.autoUpdateInterval;
  options.autoRestartDays = typeof options.autoRestartDays === 'undefined' ? 30 : options.autoRestartDays;
  options.clearOldLogDays = typeof options.clearOldLogDays === 'undefined' ? 7 : options.clearOldLogDays;
  options.singleInstance = typeof options.singleInstance === 'undefined' ? true : options.singleInstance;
  options.registerRestartManager = typeof options.registerRestartManager === 'undefined' ? true : options.registerRestartManager;

  options.setupAppMenu = typeof options.setupAppMenu === 'undefined' ? true : options.setupAppMenu;
  options.setupTrayMenu = typeof options.setupTrayMenu === 'undefined' ? true : options.setupTrayMenu;
  options.setupDockMenu = typeof options.setupDockMenu === 'undefined' ? true : options.setupDockMenu;

  options.setupDiscordRPC = typeof options.setupDiscordRPC === 'undefined' ? true : options.setupDiscordRPC;
  options.installBrowserExtensions = typeof options.installBrowserExtensions === 'undefined' ? true : options.installBrowserExtensions;

  // Set dev options
  options._downloadRestartManager = typeof options._downloadRestartManager === 'undefined' ? false : options._downloadRestartManager;
  options._openDevelopmentRestartManager = typeof options._openDevelopmentRestartManager === 'undefined' ? false : options._openDevelopmentRestartManager;

  parent.initOptions = options;

  // properties
  parent.needsToBeShown = true;

  parent.performance.mark('manager_initialize_main_initializeRemote');

  parent.libraries.remote = parent.libraries.remote || require(path.join(app.getAppPath(), 'node_modules', '@electron/remote/main'));
  parent.libraries.remote.initialize();

  parent._handlers = {
    onDeepLink: function () {},
    onDeepLinkFilter: function () {return false},
    _onDeepLink: function () {
      function _internallyHandled(parsed) {
        const url = parsed.url;
        const command = parsed.command;
        const payload = parsed.payload;

        // If the URL is not valid, return
        if (!url) {
          return false;
        }

        // If the protocol OR host is not valid, return
        if (url.protocol !== `${parent.options.app.id}:` || url.host !== 'electron-manager') {
          return false;
        }

        // Process the command
        if (command === 'user:authenticate') {
          parent.sendToRegisteredRenderers(command, payload);
          parent.window().show('main');
        } else if (command === 'X') {
          // Add more commands here
        }

        // If it's not internally handled, return since it's an electron-manager command
        return true;
      }

      // @@@: REMOVE
      parent.storage.electronManager.set('data.current._test1', {
        deeplinkingUrl: parent.deeplinkingUrl,
      });

      // Convert to array if not already
      parent.deeplinkingUrl = Array.isArray(parent.deeplinkingUrl) ? parent.deeplinkingUrl : [parent.deeplinkingUrl];

      // Loop through all deeplinks
      parent.deeplinkingUrl
      .forEach((url) => {
        // If the URL is not valid, return
        if (!url) {
          return;
        }

        // Check if its the app protocol OR if the filter allows it (allow -dev for development)
        if (
          !(url.startsWith(`${parent.options.app.id}://`) || url.startsWith(`${parent.options.app.id}-dev://`))
          && !parent._handlers.onDeepLinkFilter(url)
        ) {
          return;
        }

        // Parse the URL
        const parsed = {
          url: null,
          command: '',
          payload: {},
        }

        // Parse the URL
        try {
          parsed.url = new URL(url);
          parsed.command = parsed.url.searchParams.get('command') || '';
          parsed.payload = JSON.parse(parsed.url.searchParams.get('payload') || '{}');
        } catch (e) {
          console.error('Failed to parse URL', url);
        }

        // If its internally handled, return
        parent.log('onDeepLink()', url);

        // Save the deeplink to disk
        parent.storage.electronManager.set('data.current.deeplink', {
          url: url,
          command: parsed.command,
          payload: parsed.payload
        });

        // Check if its internally handled
        if (_internallyHandled(url, parsed)) {
          return
        }

        // If not, send to handler
        parent._handlers.onDeepLink(url, parsed.command, parsed.payload)

      });
    },
    onSecondInstance: function () {},
    _onSecondInstance: function () {
      if (parent.secondInstanceParameters) {
        parent.log('onSecondInstance()', parent.secondInstanceParameters)

        parent._handlers.onSecondInstance(parent.secondInstanceParameters)
      }
    },
    onLog: function () {},
    _onLogIsSet: false,
    _loggerQueue: [],
  };

  parent.performance.mark('manager_initialize_main_openStorage');

  parent._openStorage();
  const unverifiedConfig = parent.storage.electronManager.get('data.config.data', {})
  let newData = parent.storage.electronManager.get('data.current', {})
  parent.storage.electronManager.set('data.previous', newData);

  // console.log('----unverifiedConfig', unverifiedConfig);
  // Init new sentry if desired
  parent.performance.mark('manager_initialize_main_setupSentry');
  if (unverifiedConfig.sentry && unverifiedConfig.sentry.dsn) {
    parent._sentryConfig.dsn = unverifiedConfig.sentry.dsn;
    parent.libraries.sentry.init(parent._sentryConfig);
  }

  parent.performance.mark('manager_initialize_main_setVisibility');

  await _setVisibility(parent)

  parent.performance.mark('manager_initialize_main_setupUA');
  app.userAgentFallback = app.userAgentFallback
    .replace(`Electron/${process.versions.electron}`, '')
    .replace(`${app.name}/${app.getVersion()}`, '')
    .replace(/\s\s+/g, ' ');

  function _shutdownHandler(code) {
    if (shutdownHandled) { return }
    if (code === 0) {
      parent.storage.electronManager.set('data.current.usage.shutDownSafely', true);
      setupRestartManager(parent, 'unregister');
    }
    const usage = parent.usage().calculate({round: false, number: true})
    parent.storage.electronManager.set('data.current.usage.opens', usage.total.opens + 1);
    parent.storage.electronManager.set('data.current.usage.hours', usage.total.hours + usage.session.hours);

    if (parent.isDevelopment) {
      console.log('Saving usage...', usage);
      app.removeAsDefaultProtocolClient(parent.options.app.id);
    }
    shutdownHandled = true;
  }

  parent.performance.mark('manager_initialize_main_setListeners1');
  app.on('quit', (event, code) => {
    _shutdownHandler(code)
  })

  if (process.platform === 'darwin') {
    process.on('exit', () => {
      _shutdownHandler(0)
    });
  }

  function getDeviceId() {
    return new Promise(function(resolve, reject) {
      const macaddress = require('macaddress');
      macaddress.one(async function (err, mac) {
        if (err) {
          console.error('Failed to get mac address', err);
          return resolve(uuid.v4());
        }
        return resolve(mac);
      })
    });
  }

  function getDeviceIp() {
    return new Promise(function(resolve, reject) {
      return resolve(parent.storage.electronManager.get('data.previous.meta.ip', '127.0.0.1'))
    });
  }

  // Initialize Global
  parent.performance.mark('manager_initialize_main_initializeGlobal');
  newData = {
    meta: {
      startTime: new Date().toISOString(),
      // systemColorPreference: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      // theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      environment: environment,
      // edition: packageJSON.edition || 'standard',
      version: app.getVersion(),
      ip: await getDeviceIp(),
      country: 'ZZ',
      deviceId: await getDeviceId(),
      userAgent: app.userAgentFallback,
      os: {
        username: os.userInfo().username,
        platform: os.platform(),
        name: platformName,
        version: process.getSystemVersion(),
        locale: app.getLocale(),
        arch: process.arch,
      },
      indicator: {
        soft: '',
        strict: '',
      },
    },
    usage: {
      // opens: get(newData, 'usage.opens', 0) + 1,
      opens: get(newData, 'usage.opens', 1),
      hours: get(newData, 'usage.hours', 0),
      shutDownSafely: false,
      wasRelaunched: false,
    },
    paths: {
      mainDir: __dirname,
      userData: app.getPath('userData'),
      appData: app.getPath('appData'),
      downloads: app.getPath('downloads'),
      exe: app.getPath('exe'),
      temp: app.getPath('temp'),
      // module: app.getPath('module'),
      // extensions: 'SET BELOW',
      // dependencies: 'SET BELOW',
      // resources: 'SET BELOW'
    },
    uuid: get(newData, 'uuid', null) || uuid.v4(),
    sessionId: uuid.v4(),
    user: AccountResolver._resolveAccount(),
    argv: require('yargs').argv,
    deeplink: {},
  };

  // Set dev config
  if (parent.isDevelopment) {
    newData.user.roles.developer = true;
  }

  // Reapply config
  parent.storage.electronManager.set('data.current', newData);

  // setInterval(function () {
  //   console.log(parent.storage.electronManager.get('data.current.meta'));
  // }, 1000);

  // main
  // setInterval(function () {
  //   parent.storage.electronManager.set('data.current.uuid', Math.random())
  //   console.log('====uuid', parent.storage.electronManager.get('data.current.uuid', null));
  // }, 1000);
  // setInterval(function () {
  //   console.log('====uuid', parent.storage.electronManager.get('data.current.uuid', null));
  // }, 1000);

  parent.performance.mark('manager_initialize_main_setProperties');
  parent.windows = [];
  parent.allowQuit = false;
  parent.isQuitting = false;
  parent.deeplinkingUrl = null;
  parent.secondInstanceParameters = null;

  parent._globalListenersWCs = parent._globalListenersWCs || [];
  parent._registeredRenderers = parent._registeredRenderers || [];
  parent._registeredRenderersIds = parent._registeredRenderersIds || {}; // To make sure duplicate IDs are not registered
  parent._updateTimeout;

  parent._alertedConfig = false;

  parent.onLog = (fn) => {
    parent._handlers.onLog = fn;
    parent._handlers._onLogIsSet = true;
  }

  if (parent.options.log) {
    parent._handlers._loggerQueue = [];
    parent.log = function () {
      console.log(...parent._addLogData(arguments));
      if (parent._handlers._onLogIsSet) {
        if (parent._handlers._loggerQueue.length > 0) {
          for (var i = 0; i < parent._handlers._loggerQueue.length; i++) {
            parent._handlers.onLog(...parent._handlers._loggerQueue[i])
          }
          parent._handlers._loggerQueue = [];
        }
        parent._handlers.onLog(...arguments)
      } else {
        parent._handlers._loggerQueue.push(parent._addLogData(arguments))
      }
    }
  } else {
    if (parent.isDevelopment) {
      parent.log = function () {
        console.log('Called Manager.log() but options.log=false...', ...arguments);
      }
    } else {
      parent.log = function () {}
    }
  }

  parent.log('Command line arguments', newData.argv);

  parent.performance.mark('manager_initialize_main_initializeRendererStorage');

  parent.libraries.electronStore.initRenderer();

  ipcMain.handle('electron-manager-message', async (event, message) => {
    message = message || {};
    message.payload = message.payload || {};

    // console.log('=====HERE', message);
    parent.log('electron-manager-message', message)

    // if (message.command === 'global:get') {
    //   // console.log('=====GET 2', message.payload.path, message.payload.value);
    //   return parent.global().get(message.payload.path, message.payload.value)
    // } else if (message.command === 'global:set') {
    //   return parent.global().set(message.payload.path, message.payload.value)
    // } else if (message.command === 'global:register') {
    //   const senderWc = parent.libraries.electron.webContents.fromId(get(event, 'sender.id', -1))
    //   if (senderWc) {
    //     parent._globalListenersWCs = parent._globalListenersWCs.concat(senderWc)
    //   }
    //   return parent._global;
    // } else
    if (message.command === 'renderer:register') {
      const senderId = get(event, 'sender.id', -1);
      const senderWc = parent.libraries.electron.webContents.fromId(senderId)
      if (senderWc && !parent._registeredRenderersIds[senderId]) {
        parent._registeredRenderers = parent._registeredRenderers.concat(senderWc)
        parent._registeredRenderersIds[senderId] = true;
      }
    } else if (message.command === 'renderer:show') {
      const win = parent.window().get(event.sender.id);
      if (!win) {return}
      if (win.main) {
        // parent.log(`[Performance] showMainWindow ${new Date().toISOString()}`);
        parent.performance.mark('manager_initialize_main_showMainWindow');

        parent.app().wasOpenedAtLogin()
        .then(wasOpenedAtLogin => {
          // If its an auto-show from preloader, only do it if we want to
          if (message.payload.source === 'preloader' && win.showDuringPreload && !wasOpenedAtLogin) {
            if (preloaderWindow) {
              preloaderWindow.show();
            } else {
              // win.browserWindow.show();
            }
          }
        })
      } else if (win.showDuringPreload) {
        win.browserWindow.show();
      }
    } else if (message.command === 'renderer:is-ready') {
      const win = parent.window().get(event.sender.id);
      if (!win) {return}
      // win.browserWindow.setMinimumSize(win.preferences.minWidth, win.preferences.minHeight);
      // win.browserWindow.setSize(win.preferences.width, win.preferences.height);
      // win.browserWindow.show();

      if (preloaderWindow) {
        preloaderWindow.destroy();
        preloaderWindow = null;

        if (win.main) {
          win.browserWindow.show();
        }
      }

      win.ready = true;
      win._internal.handlers.onReady();

      if (win.main) {
        _setupNonCriticalServices(parent);
      }
    } else if (message.command === 'renderer:get-initial-data') {
      return {
        appPath: app.getAppPath(),
        isDevelopment: parent.isDevelopment,
      }
    } else if (message.command === 'activity:last-action') {
      clearTimeout(parent._updateTimeout);
      parent._updateTimeout = setTimeout(function () {
        parent.log('In-activity triggered auto-update')
        parent.storage.electronManager.set('data.current.usage.visibilityState', 'hidden');
        parent.libraries.updater.update();
      }, options.autoUpdateInterval);
    } else if (message.command === 'main:process-deep-link') {
      parent.deeplinkingUrl = message.payload.url;
      parent._handlers._onDeepLink();
    } else if (message.command === 'main:rebuild-menus') {
      if (parent.libraries.appMenu.initialized) {
        parent.libraries.appMenu.init();
      }
      if (parent.libraries.trayMenu.initialized) {
        parent.libraries.trayMenu.init();
      }
      if (parent.libraries.dockMenu.initialized) {
        parent.libraries.dockMenu.init();
      }
    } else if (message.command === 'app:get-app-path') {
      return app.getAppPath();
    } else if (message.command === 'app:relaunch') {
      parent.relaunch(message.payload);
    } else if (message.command === 'app:quit') {
      parent.quit(message.payload)
    } else if (message.command === 'updater:update') {
      parent.libraries.updater.update(message.payload)
    } else if (message.command === 'discord-rpc:set-activity') {
      parent.libraries.discordRPC.setActivity(message.payload);
    } else if (message.command === 'browser-extensions:install') {
      parent.libraries.installBrowserExtensions.init(message.payload);
    } else if (message.command === 'special:alert-config') {
      if (!parent._alertedConfig) {
        parent.libraries.electron.dialog.showMessageBox(undefined, {
          message: `${parent.options.app.name} is using config: \n\n ${JSON.stringify(message.payload, null, 4)}`,
          type: 'info'
        })
        parent._alertedConfig = true;
      }
    }
  })

  parent.performance.mark('manager_initialize_main_setupHelpers');
  parent.sendToRegisteredRenderers = function (command, payload) {
    parent._registeredRenderers
    .forEach((wc, i) => {
      wc.send('electron-manager-message', {
        command: command,
        payload: payload,
      })
    });
  }

  parent.relaunch = function (options) {
    options = options || {}
    if (options.force) {
      parent.allowQuit = true;
    }

    parent.storage.electronManager.set('data.current.usage.wasRelaunched', true);

    try {
      if (!parent.isDevelopment && parent.libraries.updater.status.code === 'downloaded') {
        return parent.libraries.updater.library.quitAndInstall();
      } else {
        return app.quit(app.relaunch());
      }
    } catch (e) {
      return app.quit(app.relaunch());
    }
  }

  parent.quit = function (options) {
    options = options || {};

    if (options.force) {
      parent.allowQuit = true;
    }

    return app.quit();
  }

  parent.window = function () {
    return {
      create: function (options) {
        const win = {};
        options = options || {};
        options.preferences = options.preferences || {};
        options.preferences.show = typeof options.preferences.show === 'undefined' ? false : options.preferences.show;
        options.preferences.width = typeof options.preferences.width === 'undefined' ? 1440 : options.preferences.width;
        options.preferences.height = typeof options.preferences.height === 'undefined' ? 810 : options.preferences.height;
        options.preferences.minWidth = typeof options.preferences.minWidth === 'undefined' ? 608 : options.preferences.minWidth;
        options.preferences.minHeight = typeof options.preferences.minHeight === 'undefined' ? 342 : options.preferences.minHeight;
        // options.preferences.backgroundThrottling = typeof options.preferences.backgroundThrottling === 'undefined' ? false : options.preferences.backgroundThrottling;

        win.main = typeof options.main === 'undefined' ? false : options.main;
        win.ready = typeof options.ready === 'undefined' ? false : options.ready;
        win.allowWindowOpens = typeof options.allowWindowOpens === 'undefined' ? !!win.main : options.allowWindowOpens;
        win.handleCloseEvents = typeof options.handleCloseEvents === 'undefined' ? !!win.main : options.handleCloseEvents;
        win.handleNeedsToBeShown = typeof options.handleNeedsToBeShown === 'undefined' ? !!win.main : options.handleNeedsToBeShown;
        win.enableRemoteModule = typeof options.enableRemoteModule === 'undefined' ? !!win.main : options.enableRemoteModule;
        win.preventDevTools = typeof options.preventDevTools === 'undefined' ? !!win.main : options.preventDevTools;
        win.showMiniPreloader = typeof options.showMiniPreloader === 'undefined' ? !!win.main : options.showMiniPreloader;
        win.preferences = options.preferences;

        let failedWindowTimeout;

        // Check to see if window failed to open and then show it and update it
        if (win.main) {
          parent.performance.mark('manager_initialize_main_createBrowserWindow');
          failedWindowTimeout = setTimeout(function () {
            parent.log('Failed to open window in time', win.id);

            if (parent.isDevelopment) {
              // Show window
              win.browserWindow.show();
              // Open devtools
              win.browserWindow.webContents.openDevTools({ mode: 'undocked', activate: true });
            } else {
              // Trigger an update
              parent.libraries.updater.update();

              // Show the window if it wasn't opened at login
              parent.app().wasOpenedAtLogin()
              .then(wasOpenedAtLogin => {
                if (!wasOpenedAtLogin) {
                  parent.window().show('main');
                }
              })
            }
          }, parent.isDevelopment ? 1000 * 5 : 1000 * 30);
        }

        // if (parent.isDevelopment) {
        //   setTimeout(function () {
        //     if (!win.browserWindow.isVisible()) {
        //       parent.log('EMERGENCY DEVMODE MAIN WINDOW SHOW', win.id);
        //       win.browserWindow.show();
        //     }
        //   }, 10000);
        // }

        if (typeof options.showDuringPreload === 'undefined') {
          win.showDuringPreload = win.main ? !parent.initOptions.hideInitially : true;
        } else {
          win.showDuringPreload = options.showDuringPreload;
        }

        win.createLoggerFunction = typeof options.createLoggerFunction === 'undefined' ? !!win.main : options.createLoggerFunction;

        win._internal = {
          lockedUrl: '',
          handlers: {
            onReady: () => {},
          }
        }

        // Handlers
        win.onReady = function (fn) {
          win._internal.handlers.onReady = function () {
            parent.performance.mark('manager_initialize_main_browserWindowReady');
            clearTimeout(failedWindowTimeout);
            fn()
          };
        }

        win.browserWindow = new parent.libraries.electron.BrowserWindow(options.preferences)
        win.id = win.browserWindow.webContents.id || -1;

        // Set size
        // if (win.showDuringPreload) {
        //   win.browserWindow.setMinimumSize(300, 300);
        //   win.browserWindow.setSize(300, 300);
        // }

        if (win.main && !preloaderWindow && win.showDuringPreload && win.showMiniPreloader) {
          preloaderWindow = new parent.libraries.electron.BrowserWindow({
            width: 300,
            height: 300,
            show: false,
            frame: false,
            webPreferences: {
              nodeIntegration: true,
              contextIsolation: false,
              enableRemoteModule: true,
              preload: path.join(__dirname, '../pages/preloader/index.js'),
            }
          })

          preloaderWindow.loadURL('file://' + path.join(__dirname, '../pages/preloader/index.html'));

          if (parent.isDevelopment) {
            // preloaderWindow.openDevTools({ mode: 'undocked', activate: true });
          }

          parent.app().wasOpenedAtLogin()
          .then(wasOpenedAtLogin => {
            // If its an auto-show from preloader, only do it if we want to
            if (!wasOpenedAtLogin) {
              preloaderWindow.once('ready-to-show', () => {
                preloaderWindow.show();
              })
            }
          })
        }

        if (!win.allowWindowOpens) {
          win.browserWindow.webContents.setWindowOpenHandler(() => {
            return {action: 'deny'}
          })
        }
        if (win.handleCloseEvents) {
          win.browserWindow.on('close', async (event) => {
            parent.log('win.close event', win.id);
            // console.log('----event', event);
            if (!parent.allowQuit && !parent.isQuitting) {
              win.browserWindow.hide();
              return event.preventDefault();
            }
          });

          win.browserWindow.on('closed', async (event) => {
            parent.log('win.closed event', win.id);
            // console.log('----event', event);
            win.browserWindow = null;
            parent.quit();
          })
        }
        if (win.handleNeedsToBeShown && parent.needsToBeShown) {
          win.browserWindow.once('show', async (event) => {
            parent.log('win.show event', win.id);
            if (process.platform === 'darwin') {
              app.show();
              app.dock.show();
            }
          });
        }

        if (win.main) {
          _windowChangeEventHandler(parent, null, win);
          MAIN_WINDOW_CHANGE_EVENTS
          .forEach(name => {
            win.browserWindow.on(name, (event) => {
              _windowChangeEventHandler(parent, event, win);
            })
          });
        }

        if (win.preventDevTools) {
          win.browserWindow.webContents.on('devtools-opened', (event) => {
            if (!parent.storage.electronManager.get('data.current.user.roles.developer', false)) {
              win.browserWindow.webContents.closeDevTools()
              setTimeout(() => {
                if (!_isValidWindow(win)) { return }

                win.browserWindow.webContents.closeDevTools()
              }, 10);
              return event.preventDefault();
            }
          });
        }

        if (win.main) {
          parent.libraries.electron.app.on('activate', function () {
            parent.log('win.activate event', win.id);
            // On macOS it's common to re-create a window in the app when the
            // dock icon is clicked and there are no other windows open.
            if (!_isValidWindow(win)) { return }

            win.browserWindow.show();
          })
        }

        if (win.enableRemoteModule) {
          parent.libraries.remote.enable(win.browserWindow.webContents);
        }

        if (parent.isDevelopment) {
          win.browserWindow.webContents.openDevTools({ mode: 'undocked', activate: false });
        }

        if (win.createLoggerFunction) {
          win.browserWindow.webContents.once('dom-ready', async function (event) {
            await powertools.poll(function () {
              return win && !!win.ready;
            }, {interval: 1000, timeout: parent.isDevelopment ? 10000 : 200000})
            .catch(e => {
              console.error('Failed to create logger functions because win.ready never happened');
            })
            parent.onLog(function () {
              // console.log('Logger', ...arguments);
              if (!_isValidWindow(win)) { return }

              win.browserWindow.webContents.send('electron-manager-message', {command: 'console:log', payload: [...arguments]})
            })
            parent.log('Setup automatic logger')
          });
        }

        parent.windows.push(win);
        return win;
      },
      get: function (id) {
        if (id) {
          if (typeof id === 'number') {
            return parent.windows.filter(w => w.id === id)[0];
          } else {
            return parent.windows.filter(w => w[id])[0];
          }
        } else {
          return parent.windows;
        }
      },
      send: function (id, name, message, options) {
        return new Promise(async function(resolve, reject) {
          options = options || {};
          options.wait = typeof options.wait === 'undefined' ? true : options.wait;

          let win = parent.window().get(id);

          if (options.wait) {
            try {
              await powertools.poll(function () {
                win = parent.window().get(id);
                return win && !!win.ready;
              }, {interval: 1000, timeout: 30000})
              .catch(e => reject(e))
            } catch (e) {
              return reject(e);
            }
          }

          if (!_isValidWindow(win)) {
            return reject(new Error(`Window with id ${id} does not exist`));
          }

          win.browserWindow.webContents.send(name, message)
          return resolve();
        });
      },
      navigate: function (id, url, options) {
        const win = parent.window().get(id);

        if (!_isValidWindow(win)) {
          return new Promise(function(resolve, reject) {
            reject(new Error(`Window ${id} does not exist`))
          });
        }

        options.lock = typeof options.lock === 'undefined' ? !!win.main : options.lock;

        if (win.main) {
          parent.performance.mark('manager_initialize_main_browserWindowNavigate');
        }

        if (options.lock && !win._internal.lockedUrl) {
          win._internal.lockedUrl = url;
          win.browserWindow.webContents.on('will-navigate', function (event, url) {
            // console.log('NAV', url, win._internal.lockedUrl);
            if (url !== win._internal.lockedUrl) {
              console.error('Prevented navigation because this window is locked:', url, win._internal.lockedUrl);
              event.preventDefault();
            }
          });
        }

        let isFile = false;
        try {
          isFile = new URL(url).protocol === 'file:';
        } catch (e) {
          isFile = true;
        }

        if (isFile) {
          return win.browserWindow.loadFile(url, options)
        } else {
          return win.browserWindow.loadURL(url, options)
        }

      },
      show: function (id) {
        const win = parent.window().get(id);

        if (!_isValidWindow(win)) { return }

        if (win.browserWindow.isMinimized()) {
          win.browserWindow.restore();
        }
        if (!win.browserWindow.isVisible() || !win.browserWindow.isFocused()) {
          win.browserWindow.show();
        }
      },
      hide: function (id) {
        const win = parent.window().get(id);

        if (!_isValidWindow(win)) { return }

        if (!win.browserWindow.isMinimized()) {
          win.browserWindow.minimize();
        }
      },
      toggle: function (id) {
        const win = parent.window().get(id);

        if (!_isValidWindow(win)) { return }

        if (win.browserWindow.isMinimized() || !win.browserWindow.isVisible() || !win.browserWindow.isFocused()) {
          parent.window().show(id);
        } else {
          parent.window().hide(id);
        }
      },
    }
  };

  _instanceLock(parent);

  // parent.analytics(app.getAppPath());
  parent.performance.mark('manager_initialize_main_setupAnalytics');
  parent.analytics();

  parent.performance.mark('manager_initialize_main_setupMenus');

  parent.libraries.updater = new (require('./updater.js'))(parent);
  parent.libraries.updater.init();

  parent.libraries.appMenu = new (require('./app-menu.js'))(parent);
  if (options.setupAppMenu) {
    parent.libraries.appMenu.init();
  }

  parent.libraries.trayMenu = new (require('./tray-menu.js'))(parent);
  if (options.setupTrayMenu) {
    parent.libraries.trayMenu.init();
  }

  parent.libraries.dockMenu = new (require('./dock-menu.js'))(parent);
  if (options.setupDockMenu) {
    parent.libraries.dockMenu.init();
  }

  parent.performance.mark('manager_initialize_main_setupDebugger');

  if (unverifiedConfig.debug && unverifiedConfig.debug.throwMainError) {
    const debug = new (require('./debug.js'))
    setTimeout(function () {
      debug.throw(unverifiedConfig.debug.throwMainError, `Config error #${unverifiedConfig.debug.errorMessage || '0'} - ${new Date().toLocaleString()}`)
    }, 10);
  }

  // DONE WITH Main
  // parent.log(`[Performance] init (main): ${parent.started.toISOString()}`);
  parent.performance.mark('manager_initialize_main_end');

  return
}

// Main.prototype.registerLibraries = function () {
//   const self = this;

//   self.parent.libraries.puppeteer = self.parent.libraries.puppeteer || new (require('./libraries/puppeteer.js'))(self);
//   return self.parent.libraries.puppeteer;
// };

async function setupRestartManager(parent, command) {
  const app = parent.libraries.electron.app;
  const options = parent.initOptions;
  const data = parent.storage.electronManager.get('data.current')

  parent.log('setupRestartManager()', command);

  if (parent.options.app.id === 'restart-manager') {
    return
  }

  if (restartManagerAttempts++ >= 3) {
    return
  }

  const restartURL = new URL('restart-manager://message')
  const restartPayload = {
    name: app.getName(),
    id: parent.options.app.id,
    path: app.getPath('exe'),
    environment: data.meta.environment,
    // appPath: app.getAppPath(),
    // argv: process.argv,
    // execPath: process.execPath,
    // portableExeDirectory: process.env.PORTABLE_EXECUTABLE_DIR,
  }
  restartURL.searchParams.set('command', command);
  restartURL.searchParams.set('payload', JSON.stringify(restartPayload));
  // console.log('Opening restart-manager', restartURL.toString());
  // console.log('----restartPayload', restartPayload);

  function handleRMError() {
    parent.log('handleRMError()');
    const downloadURL = {
      // mac: 'https://github.com/somiibo/download-server/releases/download/installer/Somiibo.dmg',
      // mac: 'https://github.com/itw-creative-works/restart-manager-download-server/releases/download/installer/Restart-Manager.zip',
      mac: 'https://github.com/itw-creative-works/restart-manager-download-server/releases/download/installer/Restart-Manager.dmg',

      // windows: 'https://github.com/somiibo/download-server/releases/download/installer/Somiibo-Setup.exe',
      windows: 'https://github.com/itw-creative-works/restart-manager-download-server/releases/download/installer/Restart-Manager-Setup.exe',

      // linux: 'https://github.com/somiibo/download-server/releases/download/installer/Somiibo-amd64.deb',
      linux: 'https://github.com/itw-creative-works/restart-manager-download-server/releases/download/installer/restart-manager_amd64.deb',
    }[platformName];
    const localPathFilename = path.resolve(app.getPath('appData'), 'Restart Manager', 'resources', downloadURL.split('/').pop())
    const localPathArray = localPathFilename.split('/');
    localPathArray.pop()
    const localPath = path.join('/', ...localPathArray);
    const localPathAppname = path.join(localPath, 'Restart Manager.app');

    function executeInstalled() {
      return new Promise(async function(resolve, reject) {
        const extractZip = require('./zip.js');
        const util = require('util')
        const execute = util.promisify(require('child_process').exec);

        parent.log('executeInstalled()');

        if (process.platform === 'darwin') {
          // jetpack.remove(path.resolve(localPath, 'Restart Manager.app'));
          // await extractZip(localPathFilename, localPath)
          // extractZip('/Users/ianwiedenman/Library/Application Support/Restart Manager/resources/download.zip', '/Users/ianwiedenman/Library/Application Support/Restart Manager/resources')
          await execute(`open "${localPathFilename}"`);

          async function copyFromVolume() {
            try {
              const volumes = jetpack.list('/Volumes').sort().reverse();
              const found = volumes.find(v => v.includes('Restart Manager'));

              clearTimeout(copyFromVolumeTimeout)

              if (found) {
                // console.log('----1');
                process.noAsar = true;
                if (jetpack.exists(localPathAppname)) {
                  // console.log('----2');
                  jetpack.remove(localPathAppname);
                }
                // console.log('----3');
                // jetpack.remove(localPathAppname);
                // console.log('----4');
                jetpack.copy(path.join('/Volumes', found, 'Restart Manager.app'), localPathAppname)
                // console.log('----5');
                await execute(`open "${localPathAppname}"`);
                ejectDisks()
                return resolve();
              } else {
                copyFromVolumeTimeout = setTimeout(function () {
                  copyFromVolume();
                }, 3000);
              }
            } catch (e) {
              console.error(e);
              return resolve();
            }
            process.noAsar = undefined
          }

          async function ejectDisks() {
            await execute(`diskutil list`)
            .then(async result => {
              const split = result.stdout.split('\n');
              for (var i = 0; i < split.length; i++) {
                const line = split[i];
                if (line.includes('Restart Manager')) {
                  const split2 = line.split(' ');
                  for (var i2 = 0; i2 < split2.length; i2++) {
                    const item2 = split2[i2];
                    if (item2.includes('disk')) {
                      console.log(`Ejecting disk ${item2}`);
                      await execute(`diskutil eject ${item2}`)
                      .catch(e => console.error('Failed to eject disks', e))
                    }
                  }
                }
              }
            })
            .catch(e => console.error('Failed to list disks', e))
          }

          await ejectDisks()

          copyFromVolume()
        } else if (process.platform === 'win32') {
          await execute(`"${localPathFilename}"`);
          return resolve();
        } else {
          // TODO: INSTALL WITH SNAP?
          // if (true) {
          //   sudo snap install restart-manager
          // }
          await execute(`sudo apt install "${localPathFilename}"`).catch(e => {console.error(e)})
          await execute(`restart-manager`).catch(e => {console.error(e)})
          return resolve();
        }
      });
    }

    // executeInstalled();
    // return

    downloadItem(parent, downloadURL, localPathFilename)
    .catch(e => {
      parent.log(`Download restart-manager failed: ${e}`);
    })
    .finally(async () => {

      executeInstalled()
      .then(() => {
        setTimeout(function () {
          setupRestartManager(parent, command)
        }, 5000);
      })

    })
  }

  // handleRMError();
  // return

  function openRM() {
    return new Promise(async function(resolve, reject) {
      const restartManagerHandler = await parent.app().getApplicationNameForProtocol('restart-manager')

      parent.log(`openRM(), handler=${restartManagerHandler}`);

      if (restartManagerHandler === 'Electron' && !options._openDevelopmentRestartManager) {
        console.log('Skipping restart manager because in development')
        return resolve();
      } else if (restartManagerHandler) {
        const focusedWindow = parent.libraries.electron.BrowserWindow.getFocusedWindow();
        const appIsVisible = focusedWindow ? focusedWindow.isVisible() : false;

        parent.libraries.electron.shell.openExternal(restartURL.toString())
        .then(() => {
          return resolve();
        })
        .catch((e) => {
          return reject(e);
        })
        .finally(() => {
          // Focus because app loses focus when registering restart-manager
          if (appIsVisible) {
            focusedWindow.focus();
            focusedWindow.show();
          }
        })
      } else {
        return reject(new Error('restart-manager handler does not exist'))
      }
    });
  }

  openRM()
    .then(() => {
      if (parent.isDevelopment && !devlopmentRMDownload && options._downloadRestartManager) {
        devlopmentRMDownload = true;
        handleRMError();
      }
    })
    .catch(e => {
      parent.log(`Error managing restart-manager 1: ${e}`);

      setTimeout(function () {
        openRM()
          .catch(e => {
            parent.log(`Error managing restart-manager 2: ${e}`);
            handleRMError();
          })
      }, parent.isDevelopment ? 1000 : 60000);
    })
}

function _instanceLock(parent) {
  const app = parent.libraries.electron.app;
  const options = parent.initOptions;

  // Mark performance
  parent.performance.mark('manager_initialize_main_instanceLock');

  // Request single instance lock
  const isSingleInstance = app.requestSingleInstanceLock();

  // Log
  parent.log('isSingleInstance()', isSingleInstance);

  if (!isSingleInstance && !process.mas) {
    if (options.singleInstance) {
      parent.allowQuit = true;
      parent.isQuitting = true;
      app.exit();
    } else {
      // TODO: handle second instance deep link here
    }
  } else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      // Log
      parent.log('event:second-instance', commandLine, workingDirectory);

      // Handle deep link
      if (process.platform !== 'darwin') {
        parent.deeplinkingUrl = commandLine;
      }
      parent._handlers._onDeepLink()

      // Show main window if it is hidden
      if (parent.options.app.id !== 'restart-manager') {
        parent.window().show('main');
      }

      // Handle second instance
      parent.secondInstanceParameters = {event: event, commandLine: commandLine, workingDirectory: workingDirectory}
      parent._handlers._onSecondInstance()
    })
  }
}

async function _setupNonCriticalServices(parent) {
  const app = parent.libraries.electron.app;
  const options = parent.initOptions;

  if (parent._setupNonCriticalServicesRan) {
    return;
  }

  parent._setupNonCriticalServicesRan = true;

  // Mark performance
  parent.performance.mark('manager_initialize_main_setListeners2');

  // Event: open-url
  app.on('open-url', (event, url) => {
    // Log event
    parent.log('event:open-url', url);

    // Prevent default
    event.preventDefault();
    parent.deeplinkingUrl = url;

    // Handle deep link
    parent._handlers._onDeepLink();
  });

  // Event: open-file
  app.on('open-file', (event, path) => {
    // Log event
    parent.log('event:open-file', path);

    // Prevent default
    event.preventDefault();
    parent.deeplinkingUrl = path;

    // Handle deep link
    parent._handlers._onDeepLink();
  });

  // Handle deep link
  if (process.platform !== 'darwin') {
    parent.deeplinkingUrl = process.argv;
    parent._handlers._onDeepLink()
  }

  // In case the visibility state is stuck on hidden, we set it here so the next time it launches it is visible
  parent.app().wasOpenedAtLogin()
  .then(wasOpenedAtLogin => {
    if (!wasOpenedAtLogin) {
      parent.storage.electronManager.set('data.current.usage.visibilityState', 'visible');
    }
  })

  // Mark performance
  parent.performance.mark('manager_initialize_main_setOpenAtLogin');

  // Set open at login
  parent.app().setLoginItemSettings({openAtLogin: options.openAtLogin && !parent.isDevelopment})
    .catch(e => console.error);

  // Mark performance
  parent.performance.mark('manager_initialize_main_setProtocolHandler');

  // Set protocol handler
  if (options.setProtocolHandler) {
    await parent.app().setAsDefaultProtocolClient(parent.options.app.id)
    .catch(e => console.error);

    if (parent.isDevelopment) {
      app.removeAsDefaultProtocolClient(parent.options.app.id);
    }
  }

  // Mark performance
  parent.performance.mark('manager_initialize_main_registerRestartManager');

  // Register restart manager
  if (options.registerRestartManager) {
    app.whenReady().then(() => {
      parent.performance.mark('manager_initialize_main_appIsReady');

      setTimeout(() => {
        setupRestartManager(parent, 'register');
      }, parent.isDevelopment ? 3000 : 15000);
    })
  }

  // Mark performance
  parent.performance.mark('manager_initialize_main_setupAutoRestart');

  // Daily cron job
  setInterval(() => {
    // Check if app has been open for more than X days and restart if so
    if (options.autoRestartDays > 0) {
      const days = moment().diff(moment(newData.meta.startTime), 'days', true)

      // Log
      parent.log(`cron(24hr): Open ${days} days`);

      // Restart if needed
      if (days >= options.autoRestartDays) {
        parent.storage.electronManager.set('data.current.usage.visibilityState', 'hidden');
        parent.relaunch({force: true})
      }
    }

    // Clear old logs
    if (options.clearOldLogDays) {

    }
  }, 1000 * 60 * 60 * 24);

  // Setup Discord RPC
  parent.libraries.discordRPC = new (require('./discord-rpc.js'))(parent);
  if (options.setupDiscordRPC) {
    parent.libraries.discordRPC.init().catch(e => console.error(e));
  }

  // Mark performance
  parent.performance.mark('manager_initialize_main_setupDiscordRPC');

  // Install browser extensions
  parent.libraries.installBrowserExtensions = new (require('./install-browser-extensions.js'))(parent);
  if (options.installBrowserExtensions) {
    parent.libraries.installBrowserExtensions.init().catch(e => console.error(e));
  }

  // Mark performance
  parent.performance.mark('manager_initialize_main_setupBrowserExtensions');

  // const mainLibrary = new (require('./libraries/analytics.js'))(parent, appPath);
  // parent.libraries.analytics = await parent.libraries.analytics.init(get(parent.options, 'config.analytics', {}));
}

function downloadItem(parent, downloadURL, localPathFilename) {
  return new Promise(function(resolve, reject) {
    const { BrowserWindow } = parent.libraries.electron;
    const win = new BrowserWindow({ show: false });
    parent.log('downloadItem()', downloadURL, localPathFilename);

    try {
      jetpack.remove(localPathFilename);
    } catch (e) {

    }

    win.webContents.session.on('will-download', (event, item, webContents) => {
      // Set the save path, making Electron not to prompt a save dialog.
      // item.setSavePath('/tmp/save.pdf')
      item.setSavePath(localPathFilename)

      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          console.log('Download is interrupted but can be resumed')
        } else if (state === 'progressing') {
          if (item.isPaused()) {
            console.log('Download is paused')
          } else {
            console.log(`Received bytes: ${(item.getReceivedBytes() / item.getTotalBytes()) * 100}`)
          }
        }
      })
      item.once('done', (event, state) => {
        if (state === 'completed') {
          console.log('Download successfully', localPathFilename);
          return resolve()
        } else {
          console.log(`Download failed: ${state}`)
          return reject()
        }
        win.close();
      })
    })

    win.loadURL(downloadURL)
    .catch(e => {})
  });
}

function whoIsMyDaddy() {
  try {
    throw new Error('a');
  } catch (e) {
    // matches this function, the caller and the parent
    const allMatches = e.stack.match(/(\w+)@|at (\w+) \(/g);
    // match parent function name
    const parentMatches = allMatches[2].match(/(\w+)@|at (\w+) \(/);
    // return only name
    return parentMatches[1] || parentMatches[2];
  }
}

function _setVisibility(parent) {
  return new Promise(async function(resolve, reject) {
    const { app } = parent.libraries.electron;

    if (parent.initOptions.hideIfOpenedAtLogin) {
      const wasOpenedAtLogin = await parent.app().wasOpenedAtLogin();
      if (wasOpenedAtLogin) {
        console.log('[Visibility] Hiding because wasOpenedAtLogin=true')
        return resolve()
      }
    }

    if (parent.initOptions.hideInitially) {
      console.log('[Visibility] Hiding because hideInitially=true')
      return resolve();
    }

    if (parent.storage.electronManager.get('data.previous.usage.visibilityState') === 'hidden') {
      console.log('[Visibility] Hiding because visibilityState=hidden')
      return resolve();
    }

    if (platformName === 'mac') {
      app.show();
      app.dock.show();
      parent.needsToBeShown = false;
    }

    return resolve();
  });
}

function _windowChangeEventHandler(parent, event, win) {
  setTimeout(function () {
    if (!_isValidWindow(win)) { return }

    if (win.browserWindow.isMinimized()) {
      parent.storage.electronManager.set('data.current.usage.visibilityState', 'minimized');
    } else if (win.browserWindow.isVisible()) {
      parent.storage.electronManager.set('data.current.usage.visibilityState', 'normal');
    } else {
      parent.storage.electronManager.set('data.current.usage.visibilityState', 'hidden');
    }
  }, 1000);
}

function _isValidWindow(win) {
  return win && win.browserWindow && !win.browserWindow.isDestroyed();
}

module.exports = Main;
