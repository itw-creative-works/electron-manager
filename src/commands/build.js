// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('build');
const { execute } = require('node-powertools');

module.exports = async function (options) {
  logger.log('Running production build...');

  process.env.EM_BUILD_MODE = 'true';

  // Delegate to gulp build via the consumer's projectScripts
  await execute('npm run build', { log: true });
};
