// Loads a JS module from an arbitrary path on disk (e.g. consumer's src/tray/index.js).
//
// Used by tray/menu/context-menu to load consumer-defined definition files. Webpack would
// normally rewrite `require(<dynamicPath>)` into a context loader that can't resolve runtime
// paths, so we use Node's `module.createRequire(...)` to get a real require function. Webpack
// emits a noisy "Critical dependency" warning at build time but the runtime behavior is correct.

const path   = require('path');
const Module = require('module');

// Returns the module.exports of the file, or null if the file doesn't exist.
// THROWS if the file exists but fails to load (syntax error, throws at module-eval, etc.).
// Callers can decide whether to treat load errors as fatal — most should.
// On success, also clears Node's require cache for the file so subsequent reloads pick up edits.
function loadConsumerFile(absPath) {
  const fs = require('fs');
  if (!fs.existsSync(absPath)) return null;

  const consumerRequire = Module.createRequire(path.join(process.cwd(), 'package.json'));
  const resolved = consumerRequire.resolve(absPath);
  delete consumerRequire.cache[resolved];
  return consumerRequire(resolved);
}

module.exports = loadConsumerFile;
