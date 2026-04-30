// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('install');
const { execute } = require('node-powertools');
const os = require('os');

const package = Manager.getPackage('main');

module.exports = async function (options) {
  logger.log(`Installing ${package.name}...`);

  const type = options._[1] || 'prod';

  try {
    if (['prod', 'p', 'production'].includes(type)) {
      logger.log('Installing production...');
      await run(`npm uninstall ${package.name}`);
      await run(`npm install ${package.name}@latest --save-dev`);
      return logger.log('Production installation complete.');
    }

    if (['dev', 'd', 'development', 'local', 'l'].includes(type)) {
      logger.log('Installing development...');
      await run(`npm uninstall ${package.name}`);
      await run(`npm install ${os.homedir()}/Developer/Repositories/ITW-Creative-Works/${package.name} --save-dev`);
      return logger.log('Development installation complete.');
    }
  } catch (e) {
    logger.error('Error during install:', e);
  }
};

function run(command) {
  return execute(command, { log: true });
}
