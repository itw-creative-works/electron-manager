const powertools = require('node-powertools');

function Debug(Manager) {
  const self = this;
  self.Manager = Manager;

  self.process = process;

  self.initialized = false;
}

Debug.prototype.openAppFolder = function (name) {
  const self = this;
  const Manager = self.Manager;

  const path = name ? Manager.libraries.remote.app.getPath(name) : Manager.libraries.remote.app.getAppPath()
  console.log('Opening...', path);
  Manager.libraries.electron.shell.showItemInFolder(path)
};

Debug.prototype.throw = function (type, message, delay) {
  const self = this;
  const Manager = self.Manager;

  type = typeof type === 'undefined' ? 'regular' : type;
  // e = e instanceof Error ? e : new Error()

  if (!type || type === 'regular' || type === 0) {
    const err = new Error(`Test error thrown (${type}): ${message}`);
    if (delay) {
      setTimeout(function () {
        throw err;
      }, 10);
    } else {
      throw err;
    }
  } else if (type === 'unhandled-promise-rejection') {
    powertools.poll(function () {}, {timeout: 1})
  } else {
    return new Promise(async function(resolve, reject) {
      if (type === 'promise-rejection' || type === 1) {
        return reject(new Error(`Test promise rejection (${type}): ${message}`));
      } else if (type === 'unhandled-promise-rejection-inner' || type === 2) {
        powertools.poll(function () {}, {timeout: 1})
      }
    });
  }
};

Debug.prototype.require = function (id) {
  const self = this;
  const Manager = self.Manager;

  return require(path.join(appPath, 'node_modules', id))
};


module.exports = Debug;
