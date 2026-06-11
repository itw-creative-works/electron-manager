// Libraries
const path = require('path');
const fs = require('fs');
const Manager = new (require('../build.js'));
const logger = Manager.logger('test');
const { run } = require('../test/runner.js');
const attachLogFile = require('../utils/attach-log-file.js');
const { EXTENDED_MODE_WARNING } = require('../test/utils/extended-mode-warning.js');

module.exports = async function (options) {
  // Tee all test output to <projectRoot>/logs/test.log (ANSI-stripped) — mirrors
  // BEM's test.log and EM's own dev.log pattern.
  attachLogFile(path.join(process.cwd(), 'logs', 'test.log'));

  const layer       = options.layer    || 'all';
  // Positional target: `npx mgr test <target>` where target supports source
  // prefixes — `project:`, `project:<path>`, `em:`, `em:<path>`, or a bare
  // `<path>` (matches both sources). Selects which test FILES run.
  const target      = (options._ && options._[1]) || null;
  // `--filter` flag: substring match on test NAMES/descriptions (orthogonal to target).
  const filter      = options.filter   || null;
  const reporter    = options.reporter || 'pretty';
  // Extended mode — opt into tests that hit REAL external services (Firebase, analytics,
  // update feeds) instead of skipping them. Off by default so `npx mgr test` stays fast and
  // offline-safe. The canonical signal is the unprefixed `TEST_EXTENDED_MODE` env var — the
  // SAME name across BEM/BXM/UJM/EM (cross-framework parity); `--extended` is the CLI
  // shorthand. Once set on process.env it propagates to every spawned child (electron
  // main/renderer/boot, the gulp boot build) automatically via `{ ...process.env }`.
  const extended    = options.extended === true
    || options.extended === 'true'
    || process.env.TEST_EXTENDED_MODE === 'true'
    || process.env.TEST_EXTENDED_MODE === '1';

  if (extended) {
    process.env.TEST_EXTENDED_MODE = 'true';
  }

  // When EM itself runs its own boot-layer tests (the cwd's package.json is EM's), there's
  // no real consumer app to boot. Point the boot runner at the fixture under
  // dist/test/fixtures/consumer-app unless the caller has already set EM_TEST_BOOT_PROJECT
  // explicitly. Mirrors BXM's BXM_TEST_BOOT_PROJECT / UJM's UJ_TEST_BOOT_PROJECT.
  if (!process.env.EM_TEST_BOOT_PROJECT) {
    try {
      const cwdPkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
      if (cwdPkg.name === 'electron-manager') {
        process.env.EM_TEST_BOOT_PROJECT = path.join(__dirname, '..', 'test', 'fixtures', 'consumer-app');
      }
    } catch (_) { /* no package.json — leave unset */ }
  }

  if (reporter !== 'json') {
    const parts = [`layer=${layer}`];
    if (target) parts.push(`target="${target}"`);
    if (filter) parts.push(`filter="${filter}"`);
    if (extended) parts.push('+extended');
    logger.log(`Running tests (${parts.join(' ')})`);
    logger.log(`Test mode: ${extended ? 'extended (real external APIs)' : 'normal (external APIs skipped)'}`);
    if (extended) {
      logger.warn(EXTENDED_MODE_WARNING[0]);
      EXTENDED_MODE_WARNING.slice(1).forEach((line) => logger.warn(line));
    }
  }

  const result = await run({ layer, target, filter, reporter });

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
    await attachLogFile.detach();
    throw new Error(`${result.failed} test(s) failed`);
  }

  // Flush test.log fully before exiting — stream writes are async and
  // process.exit() would drop the buffered tail (the Results block).
  await attachLogFile.detach();
  process.exit(0);
};
