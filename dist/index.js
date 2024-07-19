/*
  Libraries
*/
const { get, set, merge, throttle, isEqual } = require('lodash');
const path = require('path');
let child_process;
let jetpack;
let JSON5;
let moment;
let powertools;
let wonderfulFetch;
let tools;
let hash;
// let Sentry = {
//   processor: null,
//   filter: null,
// };
let SentryProcessor;
let SentryFilter;

/*
  ElectronManager Class
*/
function ElectronManager(options) {
  const self = this;

  self.started = new Date();
  self._performanceLog = [];

  self.require = require;

  self.options = options || {};

  self.interface = {};

  self.process = process.type === 'browser' ? 'main' : process.type;

  return self;
}

/*
  ElectronManager Central
*/
ElectronManager.prototype.init = function (options) {
  const self = this;
  options = options || {};

  return new Promise(async function(resolve, reject) {

    // Setup performance functions
    self.performance = {
      mark: function (name, timestamp) {
        self._performanceLog = self._performanceLog.concat({name: name, timestamp: (new Date() || timestamp).toISOString()})
        performance.mark(name);
      },
      retrieve: function () {
        let result = [];
        performance.getEntriesByType('mark')
        .forEach(mark => {
          mark = mark.toJSON();

          result = result.concat({
            name: mark.name,
            timestamp: (self._performanceLog.find(p => mark.name === p.name) || {}).timestamp,
            startTime: Math.round(mark.startTime),
            detail: mark.detail || '',
          });

        })
        return result;
      }
    }

    // Mark performance
    self.performance.mark('manager_initialize_start');

    // Set up error catcher
    self._errorCatcher = new (require('./libraries/error-catcher.js'))(self);
    self._errorCatcher.register();

    // Set base properties
    self.isDevelopment = false;
    self.appPath = '';
    self.resolveDeveloper = function () {
      return self.isDevelopment;
    }

    // Export libraries for use here
    self.options.libraries = self.options.libraries || {};
    self.libraries = {
      electron: self.options.libraries.electron || require('electron'),
      remote: self.options.libraries.remote,
      electronUpdater: self.options.libraries.electronUpdater,
      // webManager: self.options.libraries.webManager,
      // sentry: self.options.libraries.sentry,
    }
    self._internal = {}
    self._handlers = {}

    // Mark performance
    self.performance.mark('manager_initialize_setState');

    // Pre-handler for each process
    if (self.process === 'main') {
      // Start hidden on macOS
      if (process.platform === 'darwin') {
        self.libraries.electron.app.hide();
        self.libraries.electron.app.dock.hide();
      }

      // Set app path
      self.appPath = self.libraries.electron.app.getAppPath();

      // Set development mode
      self.isDevelopment = !self.libraries.electron.app.isPackaged;

      // Set userData path
      if (self.isDevelopment) {
        self.libraries.electron.app.setPath('userData', `${self.libraries.electron.app.getPath('userData')} (Development)`);
      }
    } else {
      // Get initial data
      await self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'renderer:get-initial-data'})
      .then(r => {
        self.appPath = r.appPath;
        self.isDevelopment = r.isDevelopment;
      })
    }

    // Mark performance
    self.performance.mark('manager_initialize_configureInstance');

    // Set package.json
    self.package = require(path.join(self.appPath, 'package.json'));

    // Set libraries
    const electronManagerOptions = loadJSON5(path.join(self.appPath, 'electron-manager', 'config.json'));
    const defaultOps = {
      app: {
        id: self.package.name,
        name: self.package.productName,
        homepage: self.package.homepage,
      }
    }

    // Set options
    self.options = merge(defaultOps, electronManagerOptions, self.options);

    // Set libraries
    self.options.config = self.options.config || {};

    // Set app options
    self.options.app = self.options.app || {};
    self.options.app.name = self.options.app.name || '';
    self.options.app.id = self.options.app.id || self.options.app.name.toLowerCase().replace(/\s/g, '-') || '';

    // Set log options
    self.options.log = typeof self.options.log === 'undefined' ? self.isDevelopment : self.options.log;
    // if (self.options.log === 'isDevelopment') {
    //   self.options.log = self.isDevelopment;
    // }

    // If log is enabled, log the options
    if (self.options.log) {
      // console.log('electron-manager options', self.options);
    }

    // Set storage
    self.storage = {};
    self._sentryConfig = {};

    // Set libraries that were not set bove
    Object.keys(self.options.libraries)
    .forEach((key, i) => {
      self.libraries[key] = self.libraries[key] || self.options.libraries[key]
    });

    self.performance.mark('manager_initialize_setupSentry');

    // Set up sentry
    if (self.libraries.sentry !== false) {

      // Require sentry
      if (!self.libraries.sentry) {
        if (self.process === 'main') {
          self.libraries.sentry = require('@sentry/electron/main');
        } else {
          self.libraries.sentry = require('@sentry/electron/renderer');
        }
      }

      // Setup sentry config
      self._sentryConfig = {
        dsn: self.options.config.sentry.dsn,
        release: `${self.options.app.id}@${self.package.version}`,
        // environment: self.isDevelopment ? 'development' : 'production',
        replaysSessionSampleRate: self.options.config.sentry.replaysSessionSampleRate || 0.01,
        replaysOnErrorSampleRate: self.options.config.sentry.replaysOnErrorSampleRate || 0.01,
        integrations: [],
        async beforeSend(event, hint) {
          let storage = {};
          let processedError = {message: '', stack: '', combo: '|||'};
          try {
            storage = self.storage.electronManager.get('data.current', {})
          } catch (e) {

          }

          // Require sentry processor
          SentryProcessor = SentryProcessor || require('./libraries/sentry-processor.js');

          // Require sentry filter
          try {
            SentryFilter = SentryFilter || require(path.resolve(self.appPath, 'electron-manager', 'sentry-filter.js'))
          } catch (e) {
          }

          // Extract error
          processedError = await SentryProcessor.extractError(event, hint);

          // Get usage
          const usage = self.usage().calculate({round: true, number: false})

          // Set tags
          event.tags = event.tags || {};
          if (!event.tags['process.type']) {
            if (self.process === 'main') {
              event.tags['process.type'] = 'main'
            } else {
              event.tags['process.type'] = self.process;
            }
          }
          event.tags['usage.total.opens'] = parseInt(usage.total.opens);
          event.tags['usage.total.hours'] = usage.total.hours;
          event.tags['usage.session.hours'] = usage.session.hours;
          event.tags['store'] = self.properties().isStore();

          // Set user
          event.user = event.user || {};
          event.user.email = storage?.user?.auth?.email || '';
          event.user.id = storage?.user?.auth?.uid || storage?.uuid || '';
          // event.user.ip = storage?.meta?.ip || '';


          try {
            // Block event if filtered
            if (!SentryProcessor.filter(processedError) || (SentryFilter && !SentryFilter(processedError, event, self))) {
              if (self.isDevelopment) {
                console.error('Sentry caught a filtered error:', processedError, event.tags);
              }
              return null;
            } else {
              SentryProcessor.log(processedError, event);
            }

            // Block event if in development and not enabled
            if (self.isDevelopment) {
              console.error('Sentry caught an error:', processedError, event.tags);

              // Block event if not enabled
              if (storage?.argv?.enableLiveSentry !== 'true') {
                return null;
              }
            }

            // Send event
            return event;
          } catch (e) {
            setTimeout(function () {
              self.libraries.sentry.captureException(new Error(`Sentry failed to process error: ${e}`));
            }, 1000);

            // Block event
            return null;
          }
        }
        // beforeBreadcrumb(breadcrumb, hint) {
        //   return null;
        // }
      }

      // Add renderer integrations
      if (self.process !== 'main') {
        // Add integration: browser tracing
        self._sentryConfig.integrations.push(self.libraries.sentry.browserTracingIntegration());

        // Add integration: replay
        self._sentryConfig.integrations.push(self.libraries.sentry.replayIntegration({
          maskAllText: false,
          blockAllMedia: false,
        }));
      }

      // Add breadcrumb filter
      // self._sentryConfig.integrations = function (integrations) {
      //   return integrations.filter(function (integration) {
      //     return integration.name !== 'Breadcrumbs';
      //   });
      // }
      // self._sentryConfig.integrations.push();

      // Setup integrations
      // if (self.process === 'main') {
      //   self._sentryConfig.release = `${self.options.app.name}@${self.libraries.electron.app.getVersion()}`;
      // } else {
      //   if (self.isDevelopment) {
      //     self._sentryConfig.integrations = function (integrations) {
      //       return integrations.filter(function (integration) {
      //         return integration.name !== 'Breadcrumbs';
      //       });
      //     }
      //   }
      // }

      // Check for DSN
      if (!self._sentryConfig.dsn) {
        console.warn('Sentry DSN not set. Sentry will not be initialized.');
      }

      // Initialize sentry
      self.libraries.sentry.init(self._sentryConfig);

      // Unregister error catcher
      self._errorCatcher.unregister();
    }

    // Mark performance
    self.performance.mark('manager_initialize_setupHelperFunctions');

    // Setup helper functions
    // Setup helper function: openStorage
    self._openStorage = function () {
      self.libraries.electronStore = self.libraries.electronStore || require('electron-store');
      self.storage.electronManager = new self.libraries.electronStore({
        cwd: 'electron-manager/main',
        clearInvalidConfig: true,
      });
      self.resolveDeveloper = function () {
        return self.isDevelopment || self.storage.electronManager.get('data.current.user.roles.developer', false)
      }
    }

    // Setup helper function: addLogData
    self._addLogData = function (args) {
      // const args = arguments;
      const now = new Date();
      args = Array.prototype.slice.call(args);
      args.unshift(`[electron-manager @ ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}]`)
      // return ...args
      return args;
    }

    // ALL: 'all'
    // require('./libraries/_all.js')({self: self})


    // MAIN: 'main'
    if (self.process === 'main') {
      const main = new (require('./libraries/_main.js'))

      await main.init({parent: self, options: options});

      return resolve(self);

    // RENDERER: 'renderer'
    } else {
      self.performance.mark('manager_initialize_renderer_start');

      // options.registerGlobalListener = typeof options.registerGlobalListener === 'undefined' ? true : options.registerGlobalListener;
      options.mainRenderer = typeof options.mainRenderer === 'undefined' ? true : options.mainRenderer;

      options.promoServer = options.promoServer || {}
      options.promoServer.log = typeof options.promoServer.log === 'undefined' ? self.isDevelopment : options.promoServer.log;

      options.fetchMainResource = typeof options.fetchMainResource === 'undefined' ? true : options.fetchMainResource;
      options.fetchMainScript = typeof options.fetchMainScript === 'undefined' ? true : options.fetchMainScript;
      options.checkHashes = typeof options.checkHashes === 'undefined' ? true : options.checkHashes;

      options.setupContextMenu = typeof options.setupContextMenu === 'undefined' ? true : options.setupContextMenu;

      // Properties
      self.isReady = false;
      self.mainRenderer = options.mainRenderer;
      self.isUsingValidVersion = null;
      self.isUsingValidHashes = null;

      self.fetchedMainResource = null;
      self.fetchedHashes = null;
      self.fetchedEmergencyScript = null;
      self.fetchedBEMClientData = null;

      if (self.libraries.remote !== false) {
        self.libraries.remote = self.libraries.remote || require(path.join(self.appPath, 'node_modules', '@electron/remote'));
      }

      self.webContents = self.libraries.remote ? self.libraries.remote.getCurrentWebContents() : null;

      if (self.options.log) {
        self.log = function () {
          // console.log(...arguments);
          console.log(...self._addLogData(arguments));
        }
      } else {
        self.log = function () {}
      }

      // Mark performance
      self.performance.mark('manager_initialize_renderer_openStorage');

      // require('./libraries/_renderer.js')({self: self})
      self._openStorage();
      // self.isDevelopment = self.storage.electronManager.get('data.current.meta.environment') === 'development';

      self.performance.mark('manager_initialize_renderer_injectPreloader');

      require('./libraries/preloader.js')(self, options)

      self.renderer = function () {
        const self = this;

        self.libraries.renderer = self.libraries.renderer || new (require('./libraries/renderer.js'))(self);
        return self.libraries.renderer;
      };

      self.libraries.electron.ipcRenderer.on('electron-manager-message', function (event, message) {
        message = message || {};
        message.command = message.command || '';
        message.payload = message.payload || {};

        // console.log('-----MESSAGE', message);
        if (message.command !== 'console:log') {
          self.log('Message', message.command, message.payload);
        }

        if (message.command === 'user:authenticate') {
          if (self.libraries.webManager) {
            self.libraries.webManager.authenticate(message.payload);
          }
        } else if (message.command === 'console:log') {
          // message.payload.unshift('[electron-manager]')
          console.log.apply(null, message.payload)
        }

        // if (message.command === 'global:set') {
        //   const resolvedPath = `_global${message.payload.path ? '.' + message.payload.path : ''}`;
        //   // console.log('-----GLOBAL:SET');
        //   return set(self, resolvedPath, message.payload.value)
        //   // return self.global().set(message.payload.path, message.payload.value)
        // }
      })

      // if (options.registerGlobalListener !== false) {
      //   await self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'global:register'})
      //   .then(r => {
      //     self._global = r;
      //   })
      // }

      // console.log('---self._global', self._global);

      if (self.mainRenderer === true) {
        self.performance.mark('manager_initialize_renderer_main_start');

        wonderfulFetch = require('wonderful-fetch');

        await self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'renderer:register'})

        const _sendActivity = throttle(function () {
          self.log('Send activity');
          self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'activity:last-action'})
        }, self.isDevelopment ? 5000 : 69696, {leading: true, trailing: true})

        function _handleClickEvent(event) {
          if (self.options.log) {
            self.log('Click', event.target);
          }

          if (self.libraries.analytics) {
            self.libraries.analytics.process(event);
          }
          // if (window.t3) {
            _sendActivity()
          // }

          const href = event.target.getAttribute('href') || '';
          if (href.startsWith('http')) {
            self.libraries.electron.shell.openExternal(href)
            event.preventDefault();
          } else if (event.target.matches('.auth-signin-external-btn')) {
            self.renderer().openExternalAuthPage('signin');
          } else if (event.target.matches('.auth-signup-external-btn')) {
            self.renderer().openExternalAuthPage('signup');
          }
        }

        // Setup auth change handler
        self._internal.authChangeHandler = function (account, info) {
          if (self.resolveDeveloper()) {
            window.Manager = self;
          } else {
            window.Manager = null;
          }
          self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'main:rebuild-menus'})
        }

        // Setup webManager or base analytics
        if (self.libraries.webManager !== false) {
          self.libraries.webManager = new (require('./libraries/web-manager.js'))(self);
          self.libraries.webManager = await self.libraries.webManager.init({
            promoServer: options.promoServer,
            libraries: {
              firebase_app: {
                config: self.options?.config?.firebase || {},
              },
            },
          });
        } else {
          self.analytics();
          self._internal.authChangeHandler();
        }

        try {
          _sendActivity()
          document.addEventListener('click', function (event) {
            _handleClickEvent(event)
          })
          document.addEventListener('blur', _sendActivity)
        } catch (e) {
          console.error('Error setting up listeners', e);
        }

        self.fetchMainResource = function (url, options) {
          return new Promise(function(resolve, reject) {
            options = options || {};
            const gte = require('semver/functions/gte');

            self.fetchedMainResource = false;
            self.isUsingValidVersion = null;

            wonderfulFetch(url, {timeout: 30000, response: 'json', tries: 3, log: false})
              .then(r => {
                self.fetchedMainResource = true;
                self.storage.electronManager.set('data.current.resources.main', r);
                const versionRequired = self.storage.electronManager.get('data.current.resources.main.settings.versionRequired', '0.0.0');
                self.isUsingValidVersion = gte(self.package.version, versionRequired);
                if (!self.isDevelopment && !self.isUsingValidVersion) {
                  self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'updater:update'})
                }
                return resolve(r);
              })
              .catch(e => {
                self.isUsingValidVersion = false;
                return reject(e);
              })

          });
        }

        self.fetchMainScript = function (url, options) {
          return new Promise(function(resolve, reject) {
            options = options || {};
            options.refetch = options.refetch;
            tools = tools || require('./libraries/tools.js');

            self.fetchedEmergencyScript = false;

            const name = `_remote/${url}`;

            let refetchTimeout;
            function _refetch(delay, e) {
              clearTimeout(refetchTimeout);
              refetchTimeout = setTimeout(function () {
                self.log('Refetching main script...', e);
                self.fetchMainScript(url, options).catch(e => e)
              }, delay);
            }

            wonderfulFetch(url, {timeout: 30000, response: 'text', tries: 0, log: false})
              .then(async (r) => {
                let error;
                let emergencyScript = tools.requireFromString(r, path.join(self.appPath, name), {disableSensitiveVariables: false, disableSensitiveModules: false});
                emergencyScript = new (emergencyScript)(self);

                try {
                  await emergencyScript.main()
                  .then(r => {
                    self.fetchedEmergencyScript = true;
                  })
                  .catch(e => {
                    error = e;
                  })
                } catch (e) {
                  error = e;
                }

                if (options.refetch) {
                  // _refetch(self.isDevelopment ? 10000 : 60000 * 60 * 12, '')
                  _refetch(60000 * 60 * 12, '')
                }

                if (error) {
                  console.error(`Failed to execute ${url}`, error);
                  return reject(error);
                }

                return resolve(r);
              })
              .catch(e => {
                _refetch(60000 * 60, e)
                return reject(e);
              })

          });
        }

        self.checkHashes = function (url, options) {
          return new Promise(function(resolve, reject) {
            options = options || {};

            self.fetchedHashes = false;
            self.isUsingValidHashes = null;

            wonderfulFetch(url, {timeout: 30000, response: 'json', tries: 0, log: false})
              .then(async (hashesRemote) => {
                hash = hash || require('./libraries/hash.js');
                const emHashConfig = self.options?.build?.hash || {};
                emHashConfig._appPath = self.appPath;
                self.fetchedHashes = true;

                hash.build(emHashConfig)
                .then(hashesLocal => {
                  self.isUsingValidHashes = isEqual(hashesRemote, hashesLocal);
                  return resolve({hashesRemote: hashesRemote, hashesLocal: hashesLocal, valid: self.isUsingValidHashes});
                })
                .catch(e => {
                  console.error('Error building hashses', e);
                  return resolve({hashesRemote: hashesRemote, hashesLocal: {}, valid: false});
                })
              })
              .catch(e => {
                self.isUsingValidHashes = false;

                setTimeout(function () {
                  self.checkHashes(url, options).catch(e => e)
                }, 60000 * 60);
                return reject(e);
              })
          });
        }

        function _resolveFetchUrl(optionsPath, path, replace) {
          powertools = powertools || require('node-powertools');
          replace = replace || {};

          // Get URLs
          const packageHomepageUrl = self.package?.homepage || null;
          const optionsUrl = powertools.template(
            get(self.options, optionsPath) || '',
            replace,
          )

          // Resolve path
          path = powertools.template(path, replace);

          // Set resolvedUrl
          let resolvedUrl;

          // Skip if options explicitly set to false
          if (optionsUrl === false) {
            return false;
          }

          // Resolve url
          if (optionsUrl) {
            resolvedUrl = new URL(optionsUrl);
          } else if (packageHomepageUrl) {
            resolvedUrl = new URL(packageHomepageUrl);
            resolvedUrl.pathname = path;
          } else {
            throw new Error('No useable domain')
          }

          // Use development urls IF development mode is enabled
          if (self.isDevelopment && self.storage.electronManager.get('data.current.argv', {}).useDevelopmentURLs !== 'false') {
            resolvedUrl.protocol = 'http:'
            resolvedUrl.host = 'localhost:4000'
          }

          // Resolve as string
          return resolvedUrl.toString();
        }


        // load main.json
        self.performance.mark('manager_initialize_renderer_main_loadMainJSON');
        const mainResourceUrl = _resolveFetchUrl('app.resources.main', 'data/resources/main.json');
        if (options.fetchMainResource && mainResourceUrl) {
          await self.fetchMainResource(mainResourceUrl)
          .catch(e => {

          })
        }

        // load emergency script
        self.performance.mark('manager_initialize_renderer_main_loadEmergencyScript');
        const mainScriptUrl = _resolveFetchUrl('app.resources.scripts.main', 'data/resources/scripts/main.js');
        if (options.fetchMainScript && mainScriptUrl) {
          // no need to await because it's not crucial
          self.fetchMainScript(mainScriptUrl, {refetch: true})
          .catch(e => {

          })
        }

        // check hashes
        self.performance.mark('manager_initialize_renderer_main_checkHashes');
        const hashUrl = _resolveFetchUrl('app.resources.hashes.main', 'data/resources/hashes/{v}.json', {v: self.package.version});
        if (options.checkHashes && hashUrl) {
          // no need to await this but call a function when done if the hashses mismatch
          self.checkHashes(hashUrl)
          .catch(e => {

          })
        }

        self.performance.mark('manager_initialize_renderer_main_setupContextMenu');
        self.libraries.contextMenu = new (require('./libraries/context-menu.js'))(self);
        if (options.setupContextMenu) {
          self.libraries.contextMenu.init();
        }

        // debug
        self.debug = function () {
          const self = this;

          self.libraries.debug = self.libraries.debug || new (require('./libraries/debug.js'))(self);
          if (self.resolveDeveloper()) {
            return self.libraries.debug;
          } else {
            throw new Error('You are not a developer')
          }
        }

        self.performance.mark('manager_initialize_renderer_main_end');
      }

      // TODO: finish this
      // console.log('----1', self.webContents);
      // self.webContents.on('dragover',function(event){
      //   console.log('===DRAG');
      //   event.preventDefault();
      //   return false;
      // }, false);
      //
      // self.webContents.on('drop',function(event){
      //   console.log('===DROP');
      //   event.preventDefault();
      //   return false;
      // }, false);
      // console.log('----2');
      // Only if global has not yet been retrieved
      // if (!options.registerGlobalListener) {
      //   await self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'global:get'})
      //   .then(r => {
      //     // console.log('=====r', r);
      //     self._global = r;
      //   })
      // }

      // renderer
      // setInterval(function () {
      //   self.storage.electronManager.set('data.current.uuid', Math.random())
      //   console.log('====uuid', self.storage.electronManager.get('data.current.uuid', null));
      // }, 1000);
      // setInterval(function () {
      //   console.log('====uuid', self.storage.electronManager.get('data.current.uuid', null));
      // }, 1000);

      // if (self._global.meta.environment === 'development') {

      self.performance.mark('manager_initialize_renderer_setWebManagerElements');
      if (self.libraries.webManager) {
        const dom = self.libraries.webManager.dom();
        // Set dom defaults
        dom.select('.brand-name-element').setInnerHTML(self.options.app.name)
        dom.select('.app-id-element').setInnerHTML(self.options.app.id)
        dom.select('.current-version-element').setInnerHTML(self.package.version)
        dom.select('.current-year-element').setInnerHTML(new Date().getFullYear())
        dom.select('.manager-initialized-element').each(function (el) {
          el.remove();
        })
      }

      self.setReady = function () {
        self.isReady = true;

        const preloaderEl = document.getElementById('manager-preloader');
        if (preloaderEl) {
          preloaderEl.classList.add('manager-preloader-remove');
        }

        self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'renderer:is-ready'})

        setTimeout(function () {
          if (preloaderEl) {
            preloaderEl.remove();
          }
        }, 300);
      }

      // self.log(`[Performance] init (renderer): ${self.started.toISOString()}`);
      self.performance.mark('manager_initialize_renderer_end');
      return resolve(self);
    }
  });
}

ElectronManager.prototype.getRegisteredRenderers = function () {
  const self = this;
  if (self.process === 'main') {
    return self._globalListenersWCs || [];
  }
  throw new Error('Cannot get registered renderers from a non-main process')
}

ElectronManager.prototype.analytics = function (options) {
  const self = this;
  // config = config || {}; // saved for later in case need to actually set things in analytics
  options = options || {};

  // Setup analytics
  if (self.libraries.analytics !== false) {
    if (!self.libraries.analytics || options.initialize) {
      self.libraries.analytics = new (require('./libraries/analytics.js'))(self);
      self.libraries.analytics = self.libraries.analytics.init();
    }
  }

  // Return the library
  return self.libraries.analytics;
}

// ElectronManager.prototype.global = function () {
//   const self = this;
//   return {
//     get: function (path, value) {
//       return new Promise(function(resolve, reject) {
//         const resolvedPath = `_global${path ? '.' + path : ''}`
//         console.log('=====GET 0', resolvedPath, value);
//
//         if (self.process === 'main') {
//           // console.log('=====GET 3', path, value);
//           return resolve(get(self, resolvedPath, value))
//         } else {
//           // console.log('=====GET 1', path, value);
//           // return resolve(self.electron.ipcRenderer.invoke('electron-manager-message', {command: 'global:get', payload: {path: path, value: value}}))
//           return resolve(get(self, resolvedPath, value))
//         }
//       });
//     },
//     set: function (path, value) {
//       return new Promise(async function(resolve, reject) {
//         const resolvedPath = `_global${path ? '.' + path : ''}`;
//
//         if (self.process === 'main') {
//           const setResult = set(self, resolvedPath, value);
//
//           self._globalListenersWCs
//           .forEach((wc, i) => {
//             console.log('===SENDING 1', path, value);
//             wc.send('electron-manager-message', {
//               command: 'global:set',
//               payload: {path: path, value: value},
//               // payload: {path: path, value: value},
//             })
//           });
//
//           return resolve(setResult)
//         } else {
//           const setResult = set(self, resolvedPath, value);
//           console.log('===SENDING 2', path, value);
//           await self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'global:set', payload: {path: path, value: value}})
//           // await self.libraries.electron.ipcRenderer.invoke('electron-manager-message', {penis: 'PENIS', command: 'global:set'})
//           return resolve(setResult)
//         }
//       });
//     },
//   }
// }


/*
  ElectronManager Sub-Classes
*/
ElectronManager.prototype.app = function () {
  const self = this;
  return {
    setAsDefaultProtocolClient: async (protocol, options) => {
      options = options || {};
      options.appId = options.appId || self.options.app.id;
      protocol = protocol || options.appId;
      // options.app.name = options.app.name || self.options.app.name;
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
      options.appId = options.appId || self.options.app.id;
      // options.app.name = options.app.name || self.options.app.name;
      const comparator = self.isDevelopment ? 'electron' : options.appId.toLowerCase();
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
      options.openAsHidden = typeof options.openAsHidden === 'undefined' ? true : options.openAsHidden;
      options.args = (typeof options.args === 'undefined' ? [] : options.args).concat('--was-opened-at-login', `"true"`);
      const appName = options.appName || self.options.app.name;
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
      options.appId = options.appId || self.options.app.id;
      options.appName = options.appName || self.options.app.name;
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
      options.appId = options.appId || self.options.app.id;
      const comparator = self.isDevelopment ? 'electron' : options.appId.toLowerCase();
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
        moment = moment || require('moment');
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
    // wasRelaunched: async (options) => {
    //   options = options || {};
    //   const argCheck = process.argv.filter(a => a.includes('--was-relaunched')).length > 0;
    //   return argCheck || false;
    // },
    onDeepLink: function (fn, filter) {
      self._handlers.onDeepLink = fn || self._handlers.onDeepLink;
      self._handlers.onDeepLinkFilter = filter || self._handlers.onDeepLinkFilter;
      self._handlers._onDeepLink()
      // return new Promise(function(resolve, reject) {
      //   // self.log('onDeepLink() self.deeplinkingUrl=', self.deeplinkingUrl);
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
      self._handlers.onSecondInstance = fn || self._handlers.onSecondInstance;
      self._handlers._onSecondInstance()
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
      return self.isDevelopment;
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

ElectronManager.prototype.usage = function () {
  const self = this;

  // self.libraries.usage = self.libraries.usage || new (require('./libraries/usage.js'))(self);
  self.libraries.usage = self.libraries.usage || require('./libraries/usage.js');
  return self.libraries.usage;
};

ElectronManager.prototype.library = function (name) {
  const self = this;

  self.libraries[name] = self.libraries[name] || require(`./libraries/${name}.js`);

  return self.libraries[name];
};

/*
  Helpers
*/
function asyncCmd(command) {
  return new Promise((resolve, reject) => {
    child_process = child_process || require('child_process');
    child_process.exec(command, (error, stdout, stderr) => {
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
    child_process = child_process || require('child_process');
    child_process.execFile(path, parameters, (err, data) => {
      if (err) {
        return reject(err);
      } else {
        return resolve(data.toString());
      }
    });
  });
}

function loadJSON5(path) {
  JSON5 = JSON5 || require('json5');
  jetpack = jetpack || require('fs-jetpack');

  return JSON5.parse(jetpack.read(path));
}

/*
  Module
*/
module.exports = ElectronManager;


/*
  TODO:
    * Add an event emitter for 'deep-link'
*/
