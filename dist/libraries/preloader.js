const { get } = require('lodash');
const html = `
  <style media="screen">
    @keyframes manager-preloader-spinner {
      0% {
        transform: translate3d(-50%, -50%, 0) rotate(0deg);
      }

      100% {
        transform: translate3d(-50%, -50%, 0) rotate(360deg);
      }
    }

    @keyframes manager-preloader-fadeout {
      from {
        opacity: 1;
      }

      to {
        opacity: 0;
      }
    }

    #manager-preloader {
      opacity: 1;
      position: absolute;
      z-index: 9999999;
      left: 0px;
      top: 0px;
      right: 0px;
      bottom: 0px;
      background-color: white;
    }

    #manager-preloader #manager-preloader-content {
      left: 50%;
      opacity: inherit;
      position: absolute;
      top: 50%;
      transform: translate3d(-50%, -50%, 0);
      transform-origin: center;
    }

    #manager-preloader-animation {
      animation: manager-preloader-spinner 1s linear infinite, fadein 2s;
      border: solid 3px #eee;
      border-bottom-color: {brandColor};
      border-radius: 50%;
      content: "";
      height: 40px;
      opacity: inherit;
      width: 40px;
      will-change: transform;
      margin-left: 50%;
      margin-top: 50%;
    }

    #manager-preloader.manager-preloader-remove {
      animation: manager-preloader-fadeout 0.3s;
      animation-fill-mode: forwards;
    }

    #manager-preloader-text {
      font-size: 1rem;
      font-weight: 200;
      font-family: Arial, Helvetica, sans-serif;
      color: #c3c3c3;
      display: block;
    }
  </style>
  <div id="manager-preloader">
    <div id="manager-preloader-content">
      <div id="manager-preloader-animation"></div>
      <div id="manager-preloader-text">Welcome!</div>
    </div>
  </div>
`

module.exports = function (Manager, options) {
  options = options || {}

  return new Promise(function(resolve, reject) {
    // Log timing
    // console.log(`[Performance] preloadStart ${new Date().toISOString()}`);
    Manager.performance.mark('manager_initialize_renderer_preloader_start');

    // const logger = setInterval(function () {
    //   console.log('document.readyState', document.readyState, new Date().toISOString());
    // }, 100);

    function _ready() {
      const brandColor = get(Manager.options, 'brand.color', '#1E2022');
      const appName = get(Manager.options, 'app.name');

      // console.log(`[Preloader] state=${document.readyState}`, new Date().toISOString());
      // performance.mark('manager_initialize_renderer_preloader_ready');

      Manager.log(`[Preloader] readyState=${document.readyState}...`)

      // https://stackoverflow.com/questions/524696/how-to-create-a-style-tag-with-javascript
      document.body.insertAdjacentHTML('beforeend',
        html
        .replace(/{brandColor}/igm, brandColor)
      );
      const preloaderTextEl = document.getElementById('manager-preloader-text');

      preloaderTextEl.innerText = appName
        ? `Welcome to ${appName}`
        : `Welcome`

      setTimeout(function () {
        const previousVisibilityState = Manager.storage.electronManager.get('data.previous.usage.visibilityState');

        Manager.log(`[Preloader] Ready to show (visibilityState=${previousVisibilityState})`)

        if (previousVisibilityState === 'hidden') {
          return resolve()
        }

        // Send show event
        Manager.sendEM('renderer:show', {source: 'preloader'});

        return resolve();
      }, 300);

      // console.log(`[Performance] preloadEnd ${new Date().toISOString()}`);
      Manager.performance.mark('manager_initialize_renderer_preloader_end');
      // clearInterval(logger);
    }

    // Send log
    Manager.sendEM('console:log', [`[Preloader] Initializing...`]);

    // Wait for loaded
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
}
