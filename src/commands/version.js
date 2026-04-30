// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('version');

const package = Manager.getPackage('main');

module.exports = async function (options) {
  logger.log(package.version);
};
