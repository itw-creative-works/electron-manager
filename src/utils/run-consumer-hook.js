// runConsumerHook(name, ...args) — load and invoke the consumer's optional hook file.
//
// Hook lookup: <projectRoot>/hooks/<name>.js.
// Hook contract:
//   - File missing entirely → log that the hook is not present and return undefined.
//   - File exists but fails to load (syntax error, throws on require) → throws.
//   - File exists but doesn't export a function → throws (malformed).
//   - File loads + exports a fn that throws at runtime → throws.
// In short: missing is fine (logged but doesn't fail); malformed or broken hooks fail the build
// loudly so consumers don't ship a broken hook silently.

const path = require('path');
const fs = require('fs');
const loadConsumerFile = require('./load-consumer-file.js');
const LoggerLite = require('../lib/logger-lite.js');

const logger = new LoggerLite('hooks');

async function runConsumerHook(name, ...args) {
  const projectRoot = process.cwd();
  const absPath = path.join(projectRoot, 'hooks', `${name}.js`);

  if (!fs.existsSync(absPath)) {
    logger.log(`hook "${name}" not present at ${absPath} — skipping.`);
    return undefined;
  }

  const exported = loadConsumerFile(absPath);

  if (typeof exported !== 'function') {
    throw new Error(`[em:hooks] hook "${name}" at ${absPath} did not export a function (got ${typeof exported}).`);
  }

  logger.log(`running hook "${name}"`);
  return await exported(...args);
}

module.exports = runConsumerHook;
