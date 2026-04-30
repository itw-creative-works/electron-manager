// Verifies all package.json `exports` resolve to valid module files.

const path = require('path');
const fs = require('fs');

const Manager = require('../../../build.js');
const pkg = Manager.getPackage('main');
const root = Manager.getRootPath('main');

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'Package exports',
  tests: [
    {
      name: 'all exported subpaths resolve to existing files',
      run: (ctx) => {
        const entries = Object.entries(pkg.exports);
        ctx.expect(entries.length).toBeGreaterThan(0);

        for (const [subpath, target] of entries) {
          const filePath = path.join(root, target);
          if (!fs.existsSync(filePath)) {
            throw new Error(`Export "${subpath}" → ${target} does not exist on disk.`);
          }
        }
      },
    },
    {
      name: 'main / renderer / preload / build all loadable',
      run: (ctx) => {
        const fromDist = (subpath) => path.join(root, 'dist', subpath);
        ctx.expect(typeof require(fromDist('main.js'))).toBe('function');
        ctx.expect(typeof require(fromDist('renderer.js'))).toBe('function');
        ctx.expect(typeof require(fromDist('preload.js'))).toBe('function');
        ctx.expect(typeof require(fromDist('build.js'))).toBe('function');
      },
    },
    {
      name: 'every lib module exports a singleton or constructor',
      run: (ctx) => {
        const libDir = path.join(root, 'dist', 'lib');
        const files = fs.readdirSync(libDir).filter((f) => f.endsWith('.js'));
        ctx.expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
          const mod = require(path.join(libDir, file));
          if (mod === null || mod === undefined) {
            throw new Error(`lib/${file} exports null/undefined`);
          }
          // Loggers are constructors; everything else is a singleton object with initialize()
          const isLogger = file.startsWith('logger');
          if (!isLogger && typeof mod.initialize !== 'function') {
            throw new Error(`lib/${file} singleton missing initialize() method`);
          }
        }
      },
    },
  ],
};
