// Build-layer tests for test-suite discovery — specifically the
// "underscore = not a suite" convention: `_`-prefixed files and everything
// under `_`-prefixed directories (at ANY depth) must be excluded, so consumers
// can keep helpers and fixture trees (e.g. test/_fixtures/packages/x/index.js)
// next to their suites.

const path = require('path');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'test discovery — underscore exclusion convention',
  tests: [
    {
      name: 'runner exports DISCOVERY_IGNORE',
      run: (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', 'runner.js'));
        ctx.expect(Array.isArray(runner.DISCOVERY_IGNORE)).toBe(true);
        ctx.expect(runner.DISCOVERY_IGNORE.length >= 2).toBe(true);
      },
    },
    {
      name: 'glob with DISCOVERY_IGNORE skips _ files and _ dirs at any depth',
      run: (ctx) => {
        const fs = require('fs');
        const os = require('os');
        const glob = require('glob').globSync;
        const { DISCOVERY_IGNORE } = require(path.join(__dirname, '..', '..', 'runner.js'));

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-discovery-test-'));
        const write = (rel) => {
          const file = path.join(tmp, rel);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, 'module.exports = {};\n');
        };

        // Should be DISCOVERED:
        write('build/config.test.js');
        write('main/runner.test.js');
        write('boot/nested/deep.test.js');

        // Should be EXCLUDED:
        write('_init.js');                                  // top-level _ file
        write('main/_helper.js');                           // nested _ file
        write('_fixtures/runner-stack.js');                 // file in top-level _ dir
        write('_fixtures/packages/runner/mod/index.js');    // deep inside a _ dir
        write('boot/_private/util.js');                     // _ dir below a layer dir

        const found = glob('**/*.js', { cwd: tmp, ignore: [...DISCOVERY_IGNORE] }).sort();

        try {
          ctx.expect(found).toEqual([
            'boot/nested/deep.test.js',
            'build/config.test.js',
            'main/runner.test.js',
          ]);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
