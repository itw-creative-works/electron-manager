const { execute } = require('node-powertools');

let _hasSfw;
async function safeInstall(command, options) {
  if (_hasSfw === undefined) {
    _hasSfw = await execute('sfw --version', { log: false }).then(() => true).catch(() => false);
  }
  const isInstall = /^npm\s+(install|i)\b/.test(command);
  const prefix = (_hasSfw && isInstall) ? 'sfw ' : '';
  return execute(`${prefix}${command}`, options || { log: true });
}

module.exports = { safeInstall };
