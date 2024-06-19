let REQUIRE_BLACKLIST = [
  // Core
  /^fs$/, /^os$/, /child_process/, /^module$/,
  // Third party
  /electron/,
  /@sentry/,
  /fs-jetpack/,
  /jszip/,
  /winreg/,
  /macaddress/,

  /auto-launch/,

  /firebase/,
  /universal-analytics/,
  /live-plugin-manager/,
  /^npm/,
  /^glob/,
  /confetti-js/,
  /discord-rpc/,
  /intro.js/,
  /jquery/, /bootstrap/, /popper.js/,
  /material-icons/,
  /web-manager/,
  // Somiibo
  // 'tools',
];

let BASIC_SECURITY_VARIABLES = `
  let root; let global; let process;
  let firebase;
  let Renderer;
`

function Tools(m) {
}

Tools.requireFromString = function (src, filename, options) {
  options = options || {};
  options.disableSensitiveVariables = typeof options.disableSensitiveVariables !== 'undefined' ? options.disableSensitiveVariables : true;
  options.disableSensitiveModules = typeof options.disableSensitiveModules !== 'undefined' ? options.disableSensitiveModules : true;
  if (options.disableSensitiveVariables) {
    src = `
    ${BASIC_SECURITY_VARIABLES}
    ${src}
    `
  }
  if (options.disabledVariables) {
    for (var i = 0, l = options.disabledVariables.length; i < l; i++) {
      src = `let ${options.disabledVariables[i]};\n${src}`;
    }
  }
  // console.log('FINAL src', src);

  var m = new module.constructor();
  m.paths = module.paths;
  if (options.disableSensitiveModules) {
    // https://stackoverflow.com/questions/5409428/how-to-override-a-javascript-function
    m.require = (function(_super) {
      return function() {
        let path = arguments[0] || '';

        if (REQUIRE_BLACKLIST.some(v => v.test(path)))  {
          throw new Error(`${path} is not allowed in modules for security reasons.`)
        } else if (path.match(/^(\/|\\)|(\.\/|\.\\)|(:\/|:\\)/img)) {
          throw new Error(`Local modules and dependencies are not allowed for security reasons.`)
        } else {
          // https://stackoverflow.com/questions/9210542/node-js-require-cache-possible-to-invalidate
          delete require.cache[require.resolve(path)];
          return _super.apply(this, arguments);
        }
      };
    })(m.require);
  }
  m._compile(src, filename);

  return m.exports;
};

module.exports = Tools;
