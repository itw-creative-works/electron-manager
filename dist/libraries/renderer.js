function Renderer(Manager) {
  const self = this;
  self.initialized = false;
  self.webviews = [];
  self.setupAuthChangeListener = false;
  self.Manager = Manager;
  self._webviewId = 0;
}

Renderer.prototype.init = function (options) {
  const self = this;

  return self;
};

Renderer.prototype.onDOMContentLoaded = function (fn) {
  const self = this;
  if (
      ['interactive', 'complete'].includes(document.readyState)
  ) {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      fn()
    });
  }
  return self;
};

Renderer.prototype.webview = function () {
  const self = this;
  const Manager = self.Manager;

  return {
    create: function (options) {
      return new Promise(async function(resolve, reject) {
        const powertools = Manager.require('node-powertools');

        options = options || {};
        options.parent = options.parent || document.body;
        options.position = options.position || 'beforeend';
        options.openDevTools = typeof options.openDevTools === 'undefined' ? Manager.isDevelopment : false
        options.fullscreen = typeof options.fullscreen === 'undefined' ? false : options.fullscreen
        options.lock = typeof options.lock === 'undefined' ? false : options.lock

        options.setupAuthenticationHandler = typeof options.setupAuthenticationHandler === 'undefined' ? false : options.setupAuthenticationHandler
        options.authenticationHandlerDestination = typeof options.authenticationHandlerDestination === 'undefined' ? options.url : options.authenticationHandlerDestination
        options.authenticationImmediatelyRequired = typeof options.authenticationImmediatelyRequired === 'undefined' ? false : options.authenticationImmediatelyRequired
        options.hidePricingFromStoreUsers = typeof options.hidePricingFromStoreUsers === 'undefined' ? false : options.hidePricingFromStoreUsers
        options.id = options.id || `webview-${self._webviewId++}`;
        options.url = options.url || 'https://google.com';
        options.style = options.style || (options.fullscreen ? 'display:inline-flex; width:100vw; height:100vh' : 'display:inline-flex;');
        options.preload = typeof options.preload === 'undefined' ? '' : options.preload
        options.httpreferrer = typeof options.httpreferrer === 'undefined' ? '' : options.httpreferrer
        options.useragent = typeof options.useragent === 'undefined' ? '' : options.useragent
        options.partition = typeof options.partition === 'undefined' ? '' : options.partition
        options.webpreferences = typeof options.webpreferences === 'undefined' ? '' : options.webpreferences

        options.nodeintegration = typeof options.nodeintegration === 'undefined' ? false : options.nodeintegration
        options.nodeintegrationinsubframes = typeof options.nodeintegrationinsubframes === 'undefined' ? false : options.nodeintegrationinsubframes
        options.plugins = typeof options.plugins === 'undefined' ? false : options.plugins
        options.disablewebsecurity = typeof options.disablewebsecurity === 'undefined' ? false : options.disablewebsecurity
        options.allowpopups = typeof options.allowpopups === 'undefined' ? false : options.allowpopups

        const parent = options.parent;
        parent.insertAdjacentHTML(
          options.position,
          `<webview
            id="${options.id}"
            src="${options.url}"
            style="${options.style}"

            ${options.preload ? `preload="${options.preload}"` : ''}
            ${options.httpreferrer ? `httpreferrer="${options.httpreferrer}"` : ''}
            ${options.useragent ? `useragent="${options.useragent}"` : ''}
            ${options.partition ? `partition="${options.partition}"` : ''}
            ${options.webpreferences ? `webpreferences="${options.webpreferences}"` : ''}

            ${options.nodeintegration ? 'nodeintegration' : ''}
            ${options.nodeintegrationinsubframes ? 'nodeintegrationinsubframes' : ''}
            ${options.plugins ? 'plugins' : ''}
            ${options.disablewebsecurity ? 'disablewebsecurity' : ''}
            ${options.allowpopups ? 'allowpopups' : ''}

            ${options.setupAuthenticationHandler ? 'setupAuthenticationHandler' : ''}
            ${options.authenticationHandlerDestination ? `authenticationHandlerDestination="${options.authenticationHandlerDestination}"` : ''}
          ></webview>`
        )
        const webview = document.getElementById(options.id);

        webview.addEventListener('dom-ready', function () {
          webview.blur();
          setTimeout(function () {
            document.body.focus();
            setTimeout(function () {
              webview.focus();
              return resolve(webview);
            }, 10);
          }, 10);
        })

        // Set up page lsitener
        webview.addEventListener('did-navigate', async function (event) {
          const newUrl = new URL(event.url);
          const isAuthEntryPage = newUrl.pathname.match(/signin|signup|forgot/igm);
          const isAnyAuthPage = isAuthEntryPage || newUrl.pathname.match(/account|authentication-required|authentication-token|authentication-required|oauth2|signout/igm);
          const isWebsitesAuthPage = isAuthEntryPage && !isAnyAuthPage;
          const signInToken = newUrl.searchParams.get('token') || null
          const homepageUrl = new URL(options.url);

          console.log('----newUrl.toString()', newUrl.toString());
          console.log('----isAnyAuthPage', isAnyAuthPage);
          console.log('----isAuthEntryPage', isAuthEntryPage);

          function _nav(url) {
            webview.stop();
            webview.loadURL(url)
            .catch(e => console.error)
          }

          if (options.lock && newUrl.host !== homepageUrl.host) {
            event.preventDefault();
            return _nav(homepageUrl.toString())
          }

          if (options.hidePricingFromStoreUsers && newUrl.pathname.includes('/pricing')) {
            const store = Manager.properties().isStore();
            const { dialog } = Manager.libraries.remote;

            // TODO: Implement IAP (in-app purchases)
            if (['mac'].includes(store)) {
              event.preventDefault();
              _nav(homepageUrl.toString())
              return setTimeout(function () {
                dialog.showMessageBox({
                  title: `Plan unlocked!`,
                  message: `You already have the highest plan!`,
                  type: 'info'
                })
              }, 1000);
            }
          }

          if (options.setupAuthenticationHandler && isAuthEntryPage) {
            homepageUrl.pathname = 'authentication-required'
            homepageUrl.searchParams.set('signout', true)
            homepageUrl.searchParams.set('inApp', true)

            await firebase.auth()
            .signOut()
            .catch(e => console.error)

            if (isAnyAuthPage) {
              self.openExternalAuthPage(isAuthEntryPage[0]);

              return _nav(homepageUrl.toString())
            } else {
              return _nav(homepageUrl.toString())
            }
          }
        })

        if (options.fullscreen) {
          webview.addEventListener('page-title-updated', function (event) {
            document.title = event.title;
          })
        }

        await powertools.poll(function() {
          try {
            webview.getURL();
            return true;
          } catch (e) {
            return false;
          }
        }, {
          timeout: 60000
        })
        .catch(e => {
        })

        if (options.openDevTools) {
          webview.openDevTools({ mode: 'undocked', activate: false });
        }

        self.webviews.push({
          id: webview.getWebContentsId(),
          webview: webview,
          options: options,
        })

        if (options.setupAuthenticationHandler && options.authenticationImmediatelyRequired && Manager.libraries.webManager !== false) {
          Manager.libraries.webManager.refreshWebviewAuths()
        }

        return webview;

      });
    },
    get: function (id) {
      if (id) {
        return self.webviews.filter(w => w.id === id)[0];
      } else {
        return self.webviews;
      }
    },
    navigate: function (id, url, options) {
      return new Promise(function(resolve, reject) {
        const item = self.webview().get(id)
        if (item && item.webview) {
          return item.webview.loadURL(url, options)
        } else {
          reject(new Error(`Webview with id=${id} does not exist`))
        }
      });
    },
  }
};

Renderer.prototype.openExternalAuthPage = function (pathname, options) {
  const self = this;
  const Manager = self.Manager;

  pathname = 'signin';
  options = options || {};
  // options.inApp = typeof options.inApp === 'undefined' ? true : options.inApp;
  options.provider = typeof options.provider === 'undefined' ? '' : options.provider;

  const newUrl = new URL(Manager.package.homepage)
  if (
    Manager.isDevelopment
    && Manager.storage.electronManager.get('data.current.argv', {}).useDevelopmentURLs !== 'false'
  ) {
    newUrl.protocol = 'http:'
    newUrl.host = 'localhost:4000'
  }
  newUrl.pathname = pathname;
  newUrl.searchParams.set('provider', options.provider || '')
  // newUrl.searchParams.set('inApp', options.inApp)
  newUrl.searchParams.set('source', 'app')
  newUrl.searchParams.set('signout', true)
  newUrl.searchParams.set('cb', new Date().getTime())
  newUrl.searchParams.set('destination', `${Manager.options.app.id}://electron-manager?command=user:authenticate`)

  const finalUrl = newUrl.toString();

  Manager.libraries.electron.shell.openExternal(finalUrl)
  return finalUrl;
}

Renderer.prototype.processDeepLink = function (url) {
  const self = this;
  const Manager = self.Manager;

  return new Promise(function(resolve, reject) {
    Manager.sendEM('main:process-deep-link', {
      url: url,
    })
    .then(r => {
      return resolve(r);
    })

  });
};

module.exports = Renderer;
