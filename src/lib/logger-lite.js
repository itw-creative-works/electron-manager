// Runtime-side lite logger (works in main / renderer / preload — no chalk dep)
function Logger(name) {
  const self = this;
  self.name = name;
}

['log', 'error', 'warn', 'info', 'debug'].forEach((method) => {
  Logger.prototype[method] = function () {
    const self = this;

    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const args = [`[${time}] ${self.name}:`, ...Array.from(arguments)];

    console[method].apply(console, args);
  };
});

module.exports = Logger;
