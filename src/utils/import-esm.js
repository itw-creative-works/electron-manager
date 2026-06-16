// Resolve an ESM-only package from EM's own node_modules when it isn't installed
// in the consumer. Tries the consumer's node_modules first (hoisted or direct dep),
// then falls back to EM's transitive copy.
//
// Usage:
//   const ElectronStore = await importESM('electron-store');
//
// Why: webpack externalizes nothing for ESM deps — they're loaded via dynamic
// import() with webpackIgnore. Node resolves the bare specifier from the bundle's
// location (the consumer's dist/), which only finds it if the consumer installed it.
// This utility adds a fallback through EM's own node_modules so consumers don't
// need to install EM's transitive ESM deps.

const path = require('path');

async function importESM(specifier) {
  // Try consumer's node_modules first (hoisted or direct dep)
  try {
    const mod = await import(/* webpackIgnore: true */ specifier);
    return mod.default || mod;
  } catch (e) {
    // Fall back to EM's own node_modules
    const appRoot = require('./app-root.js')();
    const emPath = path.join(appRoot, 'node_modules', 'electron-manager', 'node_modules', specifier, 'index.js');

    const mod = await import(/* webpackIgnore: true */ emPath);
    return mod.default || mod;
  }
}

module.exports = importESM;
