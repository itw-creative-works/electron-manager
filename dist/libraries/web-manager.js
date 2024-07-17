const _ = require('lodash')
const fetch = require('wonderful-fetch');
const powertools = require('node-powertools');

function WM(m) {
  const self = this;

  self.Manager = m;

  return self;
}

WM.prototype.init = function (options) {
  const self = this;
  const Manager = self.Manager;
  options = options || {};

  return new Promise(function(resolve, reject) {
    function _ready() {
      const os = require('os');
      const path = require('path');
      const uuidv4 = require('uuid').v4;
      const projectPackageJSON = require(path.join(Manager.appPath, 'package.json'));
      const WebManager = new (require('web-manager'));
      const WebManagerRequire = require('web-manager/lib/require.js');
      const dom = WebManager.dom();
      const AccountResolver = new (require('web-manager/lib/account.js'))({
        utilities: {
          get: _.get,
          set: _.set,
        },
        dom: dom,
      });

      // @@@TODO: FIGURE OUT HOW TO REQUIRE IT A BETTER WAY
      // console.log(`WebManagerRequire`, WebManagerRequire)
      // console.log(`WebManagerRequire('firebase/compat/app')`, WebManagerRequire('firebase/compat/app'))
      // return;

      // Get configuration
      const firebase_app = options?.libraries?.firebase_app;
      const firebase_auth = options?.libraries?.firebase_auth;
      const firebase_firestore = options?.libraries?.firebase_firestore;
      const cacheBreaker = new Date().getTime();

      // Setup configuration
      const Configuration = {
        refreshNewVersion: {
          enabled: false,
        },
        libraries: {
          firebase_app: {
            enabled: firebase_app?.enabled || true,
            config: firebase_app?.config || {},
            load: async () => {
              await dom.loadScript({src: '../node_modules/firebase/firebase-app.js'});
              await dom.loadScript({src: '../node_modules/firebase/firebase-database.js'});
            },
          },
          firebase_auth: {
            enabled: firebase_auth?.enabled || true,
            load: async () => {
              await dom.loadScript({src: '../node_modules/firebase/firebase-auth.js'});
            },
          },
          firebase_firestore: {
            enabled: firebase_firestore?.enabled || true,
            load: async () => {
              await dom.loadScript({src: '../node_modules/firebase/firebase-firestore.js'});
            },
          },
          firebase_messaging: {
            enabled: false,
          },
          firebase_appCheck: {
            enabled: false,
          },
          cookieconsent: {
            enabled: false,
          },
          tawk: {
            enabled: false,
          },
          lazysizes: {
            enabled: false,
          },
          sentry: {
            enabled: false,
          }
        }
      }
      const electronManagerConfig = Manager.storage.electronManager.get('data.config', {})

      self._firebaseProjectId = options?.libraries?.firebase_app?.config?.projectId || '';

      self._sessionId = uuidv4();
      self._sessionListener = null;
      self._connectedListener = null;
      self._authChangeTriggers = 0;

      self._authFirestoreListener = null;

      self._resolveAccountQueue = [];
      self._resolveAccountTimeout = null;
      self._resolveAccountLocked = false;

      self._onAuthUpdateHandler = function () {};

      self._authUser = undefined;
      self._authUserAdditionalInfo = {
        connectedDevices: 0,
        previousPlanId: 'basic',
        authStateChangeCount: 0,
        signInToken: null,
      };
      self._storedPreviousPlanId = '';
      self._autoResolveTimeout = undefined;
      self._tempSignInToken = null;

      function log() {
        if (true) {
          console.log('[Session]', ...arguments);
        }
      }

      const contactEmail = projectPackageJSON?.author?.email || 'support@itwcreativeworks.com'

      // Initialize it
      WebManager.init({
        page: {
          code: '',
          type: '',
          breadcrumb: '',
          settings: Configuration,
        },
        global: {
          app: Manager.options.appId,
          version: projectPackageJSON.version,
          url: window.location.href,
          cacheBreaker: cacheBreaker,
          settings: Configuration,
          brand: {
            name: Manager.options.app.name,
          },
          contact: {
            emailSupport: contactEmail,
            emailBusiness: contactEmail,
          },
          validRedirectHosts: ['itwcreativeworks.com'],
        }
      }, function () {
        // return console.log('++++HERE')

        // Auto resolve if it takes too long
        self._autoResolveTimeout = setTimeout(function () {
          _finalAccountDetermined()
        }, 10000);

        WebManager.onAuthUpdate = function (handler) {
          self._onAuthUpdateHandler = handler;
          self._onAuthUpdateHandler(self._authUser, self._authUserAdditionalInfo)
        }

        WebManager.authenticate = function (options) {
          return new Promise(async function(resolve, reject) {
            options = options || {};
            let result;
            const wasAlreadySignedIn = !!firebase.auth().currentUser

            log('authenticate()');

            if (options.token) {
              self._tempSignInToken = options.token;

              await firebase.auth().signInWithCustomToken(options.token)
              .then(r => result = r)
              .catch(e => result = e)
            } else if (options.email && options.password) {
              await firebase.auth().signInWithEmailAndPassword(options.email, options.password)
              .then(r => result = r)
              .catch(e => result = e)
            } else {
              result = new Error('No auth credentials provided')
            }

            if (wasAlreadySignedIn) {
              WebManager.triggerAuthUpdate();
            }

            if (result instanceof Error) {
              return reject(result)
            } else {
              return resolve(result)
            }

          });
        }

        WebManager.getAuth = function () {
          return {user: self._authUser, info: self._authUserAdditionalInfo}
        }

        WebManager.triggerAuthUpdate = function () {
          log('triggerAuthUpdate()');
          _triggerAuthStateChangeHandlers()
        }

        WebManager.refreshWebviewAuths = function () {
          const user = self._authUser;
          const info = self._authUserAdditionalInfo;

          dom.select('webview[setupAuthenticationHandler]')
          .each(async (el) => {
            const originalUrl = el.getAttribute('authenticationHandlerDestination');
            const url = new URL(originalUrl);

            function _nav(url) {
              el.stop();
              el.loadURL(url)
              .catch(e => console.error)
            }

            url.searchParams.set('inApp', true)
            if (user.auth.uid) {
              url.pathname = 'authentication-required';

              if (info.signInToken) {
                url.searchParams.set('token', info.signInToken)
              }

              url.searchParams.set('destination', originalUrl)
            } else {
              url.pathname = 'authentication-required'
              url.searchParams.set('signout', true)
              await firebase.auth()
              .signOut()
              .catch(e => console.error)
            }

            _nav(url.toString())
          })
        };

        async function _processResolveAccountQueue() {
          if (!self._resolveAccountLocked) {
            const firebaseUser = self._resolveAccountQueue[0].firebaseUser;
            const firebaseUser_uid = firebaseUser?.uid || '';
            const firebaseUser_email = firebaseUser?.email || '';

            let firebaseUser_token;

            self._resolveAccountLocked = true;
            self._authUser = self._resolveAccountQueue[0].account;
            AccountResolver._resolveAccount(firebaseUser, self._authUser)

            if (!self._authUser.auth.uid) {
              self._tempSignInToken = null
            }

            // console.log('====self._authUserAdditionalInfo.authStateChangeCount', self._authUserAdditionalInfo.authStateChangeCount);
            // console.log('---1', self._authUserAdditionalInfo);
            if (self._authUserAdditionalInfo.authStateChangeCount > 0) {
              self._authUserAdditionalInfo.previousPlanId = self._storedPreviousPlanId;
            }


            if (firebaseUser) {
              await firebaseUser.getIdToken(false)
              .then(async (token) => {
                firebaseUser_token = token;
              })
              .catch(e => {
                log('Failed to get firebase token', e);
              })
            }

            // console.log('---firebaseUser_token', firebaseUser_token);

            let bemResponse = {};
            await fetch(`https://us-central1-${self._firebaseProjectId}.cloudfunctions.net/bm_api`, {
            // await fetch(`http://localhost:5001/${self._firebaseProjectId}/us-central1/bm_api`, {
              method: 'post',
              response: 'json',
              body: {
                authenticationToken: firebaseUser_token,
                command: 'special:setup-electron-manager-client',
                payload: {
                  uid: firebaseUser_uid || Manager.storage.electronManager.get('data.current.meta.deviceId') || null,
                  appId: Manager.options.config?.app?.id || null,
                  config: electronManagerConfig,
                }
              },
              timeout: 60000,
              tries: 3,
              log: false,
            })
            .then(response => {
              bemResponse = response || {};
              Manager.fetchedBEMClientData = true;
            })
            .catch(e => {
              bemResponse.timestamp = '9999-01-01';
              console.error('Failed to get uuid', e);
              Manager.fetchedBEMClientData = false;
            })
            .finally(() => {
              bemResponse.signInToken = bemResponse.signInToken || null;
              bemResponse.uuid = bemResponse.uuid || null;
              bemResponse.timestamp = bemResponse.timestamp || '9999-01-01';
              bemResponse.ip = bemResponse.ip || '0.0.0.0';
              bemResponse.country = bemResponse.country || 'ZZ';
              bemResponse.config = bemResponse.config || {};

              // Overwrite user with config
              if (Object.keys(bemResponse.config.data || {}).length > 0) {
                _.merge(self._authUser, bemResponse?.config?.data?.user || {})
                Manager.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'special:alert-config', payload: bemResponse.config.data})
              }

              log('Request for special:setup-electron-manager-client', bemResponse);

              if (bemResponse.signInToken) {
                self._tempSignInToken = bemResponse.signInToken;
              }

              const products = bemResponse?.app?.products || {};

              // Set uuid and init analytics
              Manager.storage.electronManager.set('data.current.uuid', bemResponse.uuid)
              // console.log('----1', Manager.storage.electronManager.get('data.current'));
              if (Manager.libraries.analytics !== false) {
                // console.log('----2');
                if (!Manager.libraries.analytics) {
                  // console.log('----3');
                  Manager.analytics()
                } else if (Manager.libraries.analytics.uuid !== bemResponse.uuid) {
                  // console.log('----4');
                  Manager.analytics({initialize: true})
                }
              }

              // Check plan against actual timeserver
              const now = new Date(bemResponse.timestamp);
              const expires = new Date(self._authUser?.plan?.expires?.timestamp || 0);
              const planIsExpired = now >= expires;
              if (planIsExpired) {
                _.set(self._authUser, 'plan.id', 'basic')
              }

              // Set up plan from app
              if (products) {
                Object.keys(products)
                .forEach((key, i) => {
                  const product = products[key];

                  if ((self._authUser?.plan?.id || 'basic') === product.planId) {
                    const limits = product.limits || {};
                    // Set limits
                    Object.keys(limits)
                    .forEach((limit, i) => {
                      const userDefinedLimit = self._authUser?.plan?.limits?.[limit] || undefined;
                      if (typeof userDefinedLimit === 'undefined') {
                        _.set(self._authUser, `plan.limits.${limit}`, limits[limit])
                      }
                    });

                  }
                });
              }

              // Do something with IP
              if (bemResponse.ip) {
                Manager.storage.electronManager.set('data.current.meta.ip', bemResponse.ip)
              }

              // Do something with Country
              if (bemResponse.country) {
                Manager.storage.electronManager.set('data.current.meta.country', bemResponse.country)
              }
            })


            if (Manager.storage.electronManager.get('data.current.meta.environment') === 'development') {
              self._authUser.roles.developer = true;
            }

            if (self._authUserAdditionalInfo.authStateChangeCount === 0) {
              self._authUserAdditionalInfo.previousPlanId = self._authUser.plan.id
            }
            self._storedPreviousPlanId = self._authUser.plan.id;

            // console.log('---_resolveAccount', self._authUser);

            // https://firebase.google.com/docs/firestore/solutions/presence#solution_cloud_functions_with_realtime_database
            // const uid = firebaseUser ? firebaseUser.uid : Math.floor(new Date().getTime()) + '-' + (Math.floor((Math.random() * 1000)) + '').padStart(4, '0');
            // const _sessionId = uuidv4();
            const globalMeta = Manager.storage.electronManager.get('data.current.meta', {})
            const connectedRef = firebase.database().ref('.info/connected');
            const sessionUserRef = firebase.database().ref(`sessions/app/${self._sessionId}`);
            const sessionGenericRef = firebase.database().ref(`sessions/app`);
            // const sessionUserCommandRef = firebase.database().ref(`sessions/app/${self._sessionId}/command`);
            // const sessionUserResponseRef = firebase.database().ref(`sessions/app/${self._sessionId}/response`);
            const session = {
              id: self._sessionId,
              uid: firebaseUser_uid,
              email: firebaseUser_email,
              plan: self._authUser.plan.id,
              // timestamp: new Date().toISOString(),
              timestampUNIX: firebase.database.ServerValue.TIMESTAMP,
              ip: globalMeta?.ip || '0.0.0.0',
              version: globalMeta?.version || '',
              deviceId: globalMeta?.deviceId || '',
              platform: globalMeta?.os?.name || '',
              command: '',
              response: '',
            }
            if (Manager.isDevelopment) {
              session.temporary = ''
            }
            // firebase.database().ref(`sessions/app/${session.previousKey}`).off('value', session.updateListener)

            // If the user is signed out below, skip it to prevent running twice
            let userWasSignedOut = false;

            connectedRef.off();
            sessionUserRef.off();

            connectedRef
            .on('value', async (snapshot) => {
              if (snapshot.val() == false) { return; };

              await sessionUserRef
              .onDisconnect()
              .remove()
              .then(async () => {

                await sessionUserRef
                .set(session)
                .then(r => {
                  log(`Connect succeeded: ${self._sessionId}`);
                })
                .catch(e => {
                  log(`Connect failed: ${self._sessionId}`, e);
                })

                // .orderByValue('temporary')
                // .equalTo('k')
                // .startAfter((new Date().getTime() + 2000))
                // .endBefore((new Date().getTime() + 3000))
                // .endBefore((new Date().getTime()))

                sessionUserRef
                .on('value', async (snapshot) => {
                  const data = snapshot.val() || {};
                  const command = data.command;
                  log(`Snapshot command:`, command || 'none', data);
                  if (command === 'ping' || command === 'general:ping') {
                    await sessionUserRef
                    .child('response')
                    .set('pong')
                    .then(r => {
                      log(`Pong response success!`);
                    })
                    .catch(e => {
                      log(`Pong response failed:`, e);
                    })
                  } else if (command === 'signout' || command === 'user:signout') {
                    firebase.auth().signOut();
                  } else if (command === 'relaunch' || command === 'app:relaunch') {
                    Manager.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'app:relaunch', payload: {force: true}})
                  } else if (command === 'quit' || command === 'app:quit') {
                    Manager.libraries.electron.ipcRenderer.invoke('electron-manager-message', {command: 'app:quit', payload: {force: true}})
                  }
                })

                // await sessionGenericRef
                // .orderByChild('id')
                // .equalTo(self._sessionId)
                // .on('value', async (snapshot) => {
                //   const data = snapshot.val() || {};
                //   log(`====Data changed:`, data);
                //   // if (data.command === 'ping' || data.command === 'general:ping') {
                //   //   await sessionUserRef
                //   //   .set(session)
                //   //   .then(r => {
                //   //     log(`Connect succeeded: ${self._sessionId}`);
                //   //   })
                //   //   .catch(e => {
                //   //     log(`Connect failed: ${self._sessionId}`, e);
                //   //   })
                //   // } else if (data.command === 'signout' || data.command === 'user:signout') {
                //   //   firebase.auth().signOut();
                //   // }
                // })

                dom.select('.upgrade-account-btn').each(function (el) {
                  el.style.display = 'none !important';
                  el.setAttribute('hidden', true)
                  if (self._authUser.plan.id === 'basic') {
                    el.style.display = 'inherit';
                    el.removeAttribute('hidden')
                  }
                })

                if (firebaseUser_uid) {

                  await sessionGenericRef
                  .orderByChild('uid')
                  .equalTo(firebaseUser_uid)
                  .once('value')
                  .then(async (snap) => {
                    const connectedDevices = Object.keys(snap.val() || {}).length;
                    const allowedDevices = self._authUser?.plan?.limits?.devices || 1;
                    self._authUserAdditionalInfo.connectedDevices = connectedDevices;

                    log(`Fetched devices ${connectedDevices}/${allowedDevices}`);

                    if (firebaseUser && connectedDevices > allowedDevices) {
                    // if (firebaseUser) {

                      await firebase.auth().signOut()
                      .then(() => {
                        log('Signed user out of this session');
                        userWasSignedOut = true;
                      })
                      .catch((e) => {
                        log('Failed to sign user out of this session', e);
                      })

                      await fetch(`https://us-central1-${self._firebaseProjectId}.cloudfunctions.net/bm_api`, {
                        method: 'post',
                        response: 'json',
                        body: {
                          authenticationToken: firebaseUser_token,
                          command: 'user:sign-out-all-sessions',
                          payload: {},
                        },
                        timeout: 60000,
                        tries: 1,
                        log: false,
                      })
                      .then(response => {
                        log('Signed user out of all sessions', response);
                      })
                      .catch(e => {
                        log('Failed to sign out user', e);
                      })

                    }

                  })
                  .catch(e => {
                    log('Failed to fetch devices', e);
                  })
                } else {
                  log('Skipping device fetch because user is not logged in');
                }
              })
              .catch((e) => {
                log('Failed to set onDisconnect()', e);
              })
              .finally(() => {
                if (!userWasSignedOut) {
                  _finalAccountDetermined()
                }
              })
            });

            self._resolveAccountLocked = false;
            self._resolveAccountQueue.shift();


          } else {
            clearTimeout(self._resolveAccountTimeout);
            self._resolveAccountTimeout = setTimeout(function () {
              _processResolveAccountQueue();
            }, 1000);
          }
        }

        function _resolveAccount(account) {
          account = account || {}
          self._resolveAccountQueue.push({
            firebaseUser: firebase.auth().currentUser,
            account: account,
          })

          _processResolveAccountQueue();
        }

        function _finalAccountDetermined() {
          clearTimeout(self._autoResolveTimeout);
          self._authUser = self._authUser || AccountResolver._resolveAccount(firebase.auth().currentUser, self._authUser)
          self._authUserAdditionalInfo.authStateChangeCount++;
          Manager.storage.electronManager.set('data.current.user', self._authUser)
          _setupPromoServer();
          if (self._tempSignInToken) {
            self._authUserAdditionalInfo.signInToken = self._tempSignInToken;
            self._tempSignInToken = null;
          }

          WebManager.refreshWebviewAuths()

          self._onAuthUpdateHandler(self._authUser, self._authUserAdditionalInfo)
          Manager._internal.authChangeHandler(self._authUser, self._authUserAdditionalInfo);
          return resolve(WebManager);
        }

        function _setupPromoServer() {
          setTimeout(function () {
            if (!Manager.libraries.promoServer && Manager.libraries.promoServer !== false) {
              options.promoServer.app = Manager.options.app.id;
              options.promoServer.platform = 'electron';
              options.promoServer.libraries = options.promoServer.libraries || {};
              options.promoServer.libraries.firebase = firebase;
              options.promoServer.libraries.electron = self.Manager.options.libraries.electron;
              options.promoServer.user = self._authUser;
              // options.promoServer.alwaysRun = Manager.isDevelopment;

              Manager.libraries.promoServer = new (require('promo-server'))(options.promoServer);
              Manager.libraries.promoServer.handle()
            }
            Manager.libraries.promoServer.setUser(firebase.auth().currentUser)
          }, Manager.isDevelopment ? 3000 : 30000);
        }

        function _triggerAuthStateChangeHandlers(user) {
          user = user || firebase.auth().currentUser

          if (self._authFirestoreListener) {
            self._authFirestoreListener();
          }

          if (user) {
            self._authFirestoreListener = firebase.firestore().doc(`users/${user.uid}`)
              .onSnapshot((snap) => {
                _resolveAccount(snap.data());
              }, (e) => {
                console.error('Lacking permissions so using default account', e);
                _resolveAccount();
              })
          } else {
            _resolveAccount();
          }
        }

        WebManager._redirectResultSetup = true; // Prevent the web-manager error
        WebManager.auth().ready(function () {

          _setupPromoServer();

          firebase.auth().onAuthStateChanged(function (user) {
            _triggerAuthStateChangeHandlers(user)
          })
        })
      });
    }

    // Wait for the dom to be ready
    if (
      ['interactive', 'complete'].includes(document.readyState)
    ) {
      _ready();
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        _ready()
      });
    }
  });
};

module.exports = WM;
