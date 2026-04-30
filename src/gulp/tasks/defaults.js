// STUB — copy src/defaults → consumer project root.
// Real impl in pass 2: smart overwrite, dotfile renaming (`_.gitignore` → `.gitignore`).
const Manager = new (require('../../build.js'));
const logger = Manager.logger('defaults');

module.exports = function defaults(done) {
  logger.log('defaults (stub) — would copy framework defaults into project.');
  done();
};
