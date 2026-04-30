// Libraries
const chalk = require('chalk').default;

// Build-time logger (used by gulp tasks + CLI commands)
function Logger(name) {
  const self = this;
  self.name = name;
}

['log', 'error', 'warn', 'info'].forEach((method) => {
  Logger.prototype[method] = function () {
    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let color;
    switch (method) {
      case 'warn':
        color = chalk.yellow;
        break;
      case 'error':
        color = chalk.red;
        break;
      default:
        color = (text) => text;
    }

    const args = [`[${chalk.magenta(time)}] '${chalk.cyan(this.name)}':`, ...Array.from(arguments).map((arg) => {
      if (typeof arg === 'string') {
        return color(arg);
      }
      if (arg instanceof Error) {
        return color(arg.stack);
      }
      return arg;
    })];

    console[method].apply(console, args);
  };
});

Logger.prototype.format = chalk;

module.exports = Logger;
