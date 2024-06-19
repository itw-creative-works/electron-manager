function All(options) {
  const self = options.self;
  self._openStorage = function() {
    self.storage.electronManager = new Store({
      cwd: 'electron-manager',
      clearInvalidConfig: true,
    });
  }
}
module.exports = All;
