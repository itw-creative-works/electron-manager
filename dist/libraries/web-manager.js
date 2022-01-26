let get;

function WM(m) {
  this.Manager = m;
}

WM.prototype.init = function (options) {
  const self = this;
  options = options || {};
  get = require('lodash/get')

  return new Promise(function(resolve, reject) {
    function _ready() {
      const WebManager = new (require('web-manager'));
      const cacheBreaker = new Date().getTime();
      const Configuration = {
        libraries: {
          firebase_app: {
            enabled: get(options, 'libraries.firebase_app.enabled', true),
            load: function (m) {
              return m.dom().loadScript({src: `../node_modules/firebase/firebase-app.js?cb=${cacheBreaker}`})
              .then(r => {
                return m.dom().loadScript({src: `../node_modules/firebase/firebase-database.js?cb=${cacheBreaker}`})
              })
              .catch(e => e)
            },
            config: get(options, 'libraries.firebase_app.config', {}),
          },
          firebase_auth: {
            enabled: get(options, 'libraries.firebase_auth.enabled', true),
            load: function (m) {
              return m.dom().loadScript({src: `../node_modules/firebase/firebase-auth.js?cb=${cacheBreaker}`})
            },
          },
          firebase_firestore: {
            enabled: get(options, 'libraries.firebase_firestore.enabled', true),
            load: function (m) {
              return m.dom().loadScript({src: `../node_modules/firebase/firebase-firestore.js?cb=${cacheBreaker}`})
            },
          },
          firebase_messaging: {
            enabled: get(options, 'libraries.firebase_messaging.enabled', true),
            load: function (m) {
              return m.dom().loadScript({src: `../node_modules/firebase/firebase-messaging.js?cb=${cacheBreaker}`})
            },
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

      WebManager.init({
        page: {
          code: '',
          type: '',
          breadcrumb: '',
          settings: Configuration,
        },
        global: {
          app: self.Manager.options.appId,
          version: '1.0.0',
          url: window.location.href,
          cacheBreaker: cacheBreaker,
          settings: Configuration,
          brand: {
            name: self.Manager.options.appName,
          },
          // contact: {
          //   emailSupport: 'support@sniips.com',
          //   emailBusiness: 'support@sniips.com'
          // }
        }
      }, function() {
        WebManager.auth().ready(function () {
          const promoServer = new (require('promo-server'))({
            app: self.Manager.options.appId, // <any string>
            environment: 'electron', // web | electron | extension
            log: true, // true | false
            firebase: firebase // reference to firebase (one will be implied if not provided)
          });
          self.Manager.libraries.promoServer = promoServer;
          return resolve(WebManager);
        })
      });
    }

    if (
        document.readyState === 'complete'
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
