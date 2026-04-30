// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('publish');
const { execute } = require('node-powertools');
const validateCerts = require('./validate-certs.js');

module.exports = async function (options) {
  logger.log('Running publish...');

  // Refuse to publish without cert validation passing
  await validateCerts(options);

  process.env.EM_IS_PUBLISH = 'true';

  await execute('npm run publish', { log: true });
};
