// STUB — stage consumer src/ + EM dist/ into .em-build/ for webpack to consume.
const Manager = new (require('../../build.js'));
const logger = Manager.logger('distribute');

module.exports = function distribute(done) {
  logger.log('distribute (stub)');
  done();
};
