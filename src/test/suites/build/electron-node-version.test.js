// Build-layer tests for src/utils/electron-node-version.js — resolves the Node.js major
// version Electron's bundled runtime ships with by querying the electron releases feed.
//
// Network-dependent: skipped if EM_TEST_OFFLINE=true.

const path = require('path');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'electron-node-version — resolve bundled Node from electron version',
  tests: [
    {
      name: 'module exports the expected surface',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'utils', 'electron-node-version.js'));
        ctx.expect(typeof mod.resolveNodeMajorForElectron).toBe('function');
        ctx.expect(typeof mod.fetchReleases).toBe('function');
      },
    },
    {
      name: 'resolveNodeMajorForElectron(null) returns null',
      run: async (ctx) => {
        const { resolveNodeMajorForElectron } = require(path.join(__dirname, '..', '..', '..', 'utils', 'electron-node-version.js'));
        const result = await resolveNodeMajorForElectron(null);
        ctx.expect(result).toBe(null);
      },
    },
    {
      name: 'resolveNodeMajorForElectron("^41.0.0") returns 24 (real lookup)',
      run: async (ctx) => {
        if (process.env.EM_TEST_OFFLINE === 'true') ctx.skip('offline mode');
        const { resolveNodeMajorForElectron } = require(path.join(__dirname, '..', '..', '..', 'utils', 'electron-node-version.js'));
        const result = await resolveNodeMajorForElectron('^41.0.0');
        ctx.expect(String(result)).toBe('24');
      },
    },
    {
      name: 'resolveNodeMajorForElectron("^999.0.0") returns null (no match)',
      run: async (ctx) => {
        if (process.env.EM_TEST_OFFLINE === 'true') ctx.skip('offline mode');
        const { resolveNodeMajorForElectron } = require(path.join(__dirname, '..', '..', '..', 'utils', 'electron-node-version.js'));
        const result = await resolveNodeMajorForElectron('^999.0.0');
        ctx.expect(result).toBe(null);
      },
    },
  ],
};
