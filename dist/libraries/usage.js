const get = require('lodash/get')
const moment = require('moment')
const store = new (require('electron-store'))({
  cwd: 'electron-manager/main',
  clearInvalidConfig: true,
});
const storage = store.get('data.current', {})

function Usage(Manager) {
  const self = this;
}

Usage.calculate = function (options) {
  const self = this;

  options = options || {};

  return {
    total: {
      hours: _resolve('usage.hours', 1, options),
      opens: _resolve('usage.opens', 1, options),
    },
    session: {
      hours: _resolve('meta.startTime', new Date().toISOString(), options, function (val) {
        return moment().diff(moment(val), 'hours', true)
      }),
      // opens: _resolve('stats.opens', 1, options),
    }
  }
};
// Helpers
function _resolve(path, def, options, fn) {
  let val = get(storage, path, def);
  if (fn) {
    val = fn(val)
  }
  val = options.round ? (Math.round(val * 4) / 4).toFixed(2) : val;
  val = options.number ? parseFloat(val) : val;
  return val
}

module.exports = Usage;
