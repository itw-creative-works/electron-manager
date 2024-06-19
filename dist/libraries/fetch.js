// const fetch = require('node-fetch');
let JSON5;
let jetpack;
let nodeFetch;

function Fetch(m) {
  const self = this;
}

Fetch.fetch = function (url, options) {
  options = options || {};
  options.timeout = options.timeout || 30000;
  options.tries = typeof options.tries === 'undefined' ? 1 : options.tries;
  options.log = typeof options.log === 'undefined' ? false : options.log;
  options.cacheBreaker = typeof options.cacheBreaker === 'undefined' ? true : options.cacheBreaker;
  url = url || options.url;

  let tries = 1;
  let maxTries = options.tries - 1;
  // console.log('----maxTries', maxTries, url);

  return new Promise(function(resolve, reject) {
    if (!url) {
      return reject(new Error('No URL provided.'))
    }

    let fileStream;
    let config = {
      method: (options.method || 'get').toLowerCase(),
      headers: options.headers || {},
    }

    if (options.body) {
      config.body = typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body;
    }
    if (options.json && options.body && config.method === 'post') {
      config.headers['Content-Type'] = 'application/json';
    }

    let timeoutHolder;

    function _fetch() {
      let ms = Math.min((3000 * (tries - 1)), 60000);
      ms = ms > 0 ? ms : 1;

      url = new URL(url);
      const cacheBreaker = options.cacheBreaker === true ? Math.floor(new Date().getTime() / 1000) : options.cacheBreaker;
      if (cacheBreaker) {
        url.searchParams.set('cb', cacheBreaker)
      }
      url = url.toString();

      setTimeout(function () {
        if (options.log) {
          console.log(`Fetch (${tries}/${options.tries}, ${ms}ms): ${url}`, options);
        }

        clearTimeout(timeoutHolder);
        if (options.timeout > 0) {
          timeoutHolder = setTimeout(function () {
            return reject(new Error('Request timed out'))
          }, options.timeout);
        }

        // Set nodeFetch again to be sure we're using the right one
        if (typeof window !== 'undefined' && 'fetch' in window) {
          nodeFetch = window.fetch;
        }
        nodeFetch = nodeFetch || require('node-fetch');

        nodeFetch(url, config)
          .then(async (res) => {
            const text = await res.text();
            if (res.status >= 200 && res.status < 300) {
              if (options.raw) {
                return resolve(res);
              } else if (options.json) {
                JSON5 = JSON5 || require('json5');
                try {
                  return resolve(JSON5.parse(text));
                } catch (e) {
                  throw new Error(new Error(`Response is not JSON: ${e}`))
                }
              } else if (options.download) {
                jetpack = jetpack || require('fs-jetpack');
                if (!jetpack.exists(options.download)) {
                  path = path || require('path');
                  let name = path.parse(options.download).name;
                  let ext = path.parse(options.download).ext;
                  let dir = options.download.replace(name + ext, '');
                  jetpack.dir(dir)
                }
                fileStream = jetpack.createWriteStream(options.download);
                res.body.pipe(fileStream);
                res.body.on('error', (e) => {
                  throw new Error(new Error(`Failed to download: ${e}`))
                });
                fileStream.on('finish', function() {
                  return resolve({
                    path: options.download
                  });
                });
              } else {
                return resolve(text);
              }
            } else {
              const error = new Error(text || res.statusText || 'Unknown error');
              Object.assign(error , { status: res.status })
              throw error;
            }
          })
          .catch(async (e) => {
            if (tries > maxTries && maxTries > 0) {
              return reject(e);
            } else {
              return _fetch(tries++);
            }
          })
      }, ms);
    }
    _fetch();
  });
};

module.exports = Fetch;
