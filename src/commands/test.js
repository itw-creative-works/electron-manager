// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('test');
const { run } = require('../test/runner.js');

module.exports = async function (options) {
  const layer       = options.layer    || 'all';
  const filter      = options.filter   || null;
  const reporter    = options.reporter || 'pretty';
  const integration = options.integration === true || options.integration === 'true';

  if (integration) {
    process.env.EM_TEST_INTEGRATION = '1';
  }

  if (reporter !== 'json') {
    logger.log(`Running tests (layer=${layer}${filter ? ` filter="${filter}"` : ''}${integration ? ' +integration' : ''})`);
  }

  const result = await run({ layer, filter, reporter });

  if (reporter === 'json') {
    // Final machine-readable summary.
    process.stdout.write(JSON.stringify({
      event:   'summary',
      passed:  result.passed,
      failed:  result.failed,
      skipped: result.skipped,
      total:   result.passed + result.failed + result.skipped,
    }) + '\n');
  }

  if (result.failed > 0) {
    process.exitCode = 1;
    throw new Error(`${result.failed} test(s) failed`);
  }
};
