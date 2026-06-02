// Build-time tests for the Manager class (build.js).

const Manager = require('../../../build.js');

module.exports = {
  type: 'group', // independent tests; run all even on failure
  layer: 'build',
  description: 'Manager (build.js)',
  tests: [
    {
      name: 'class is exported and instantiable',
      run: (ctx) => {
        ctx.expect(typeof Manager).toBe('function');
        ctx.expect(new Manager()).toBeInstanceOf(Manager);
      },
    },
    {
      name: 'getMode returns the mode shape',
      run: (ctx) => {
        const mode = Manager.getMode();
        ctx.expect(mode).toHaveProperty('build');
        ctx.expect(mode).toHaveProperty('publish');
        ctx.expect(mode).toHaveProperty('server');
        ctx.expect(mode).toHaveProperty('environment');
        ctx.expect(['development', 'production']).toContain(mode.environment);
      },
    },
    {
      name: 'getEnvironment is testing when EM_TEST_MODE=true (takes precedence)',
      run: (ctx) => {
        const prevTest = process.env.EM_TEST_MODE;
        const prevBuild = process.env.EM_BUILD_MODE;
        process.env.EM_TEST_MODE = 'true';
        process.env.EM_BUILD_MODE = 'true'; // even with build mode set, testing wins
        try {
          ctx.expect(Manager.getEnvironment()).toBe('testing');
        } finally {
          if (prevTest === undefined) delete process.env.EM_TEST_MODE; else process.env.EM_TEST_MODE = prevTest;
          if (prevBuild === undefined) delete process.env.EM_BUILD_MODE; else process.env.EM_BUILD_MODE = prevBuild;
        }
      },
    },
    {
      name: 'getEnvironment is production when EM_BUILD_MODE=true (and not testing)',
      run: (ctx) => {
        const prevTest = process.env.EM_TEST_MODE;
        const prevBuild = process.env.EM_BUILD_MODE;
        delete process.env.EM_TEST_MODE;
        process.env.EM_BUILD_MODE = 'true';
        try {
          ctx.expect(Manager.getEnvironment()).toBe('production');
        } finally {
          if (prevTest !== undefined) process.env.EM_TEST_MODE = prevTest;
          if (prevBuild === undefined) delete process.env.EM_BUILD_MODE; else process.env.EM_BUILD_MODE = prevBuild;
        }
      },
    },
    {
      // EM defaults to 'production' when no signal is present (no app.isPackaged in plain Node,
      // no EM_TEST_MODE/EM_BUILD_MODE, no NODE_ENV=development). EM's deployed RUNTIME can
      // legitimately reach here without a dev signal (a shipped binary), so production is the
      // safe default. NODE_ENV=development is the explicit dev override (tested separately).
      name: 'getEnvironment defaults to production when no dev/test signal is present',
      run: (ctx) => {
        const prevTest = process.env.EM_TEST_MODE;
        const prevBuild = process.env.EM_BUILD_MODE;
        const prevNode = process.env.NODE_ENV;
        delete process.env.EM_TEST_MODE;
        delete process.env.EM_BUILD_MODE;
        delete process.env.NODE_ENV;
        try {
          ctx.expect(Manager.getEnvironment()).toBe('production');
          // NODE_ENV=development is the explicit local-dev override.
          process.env.NODE_ENV = 'development';
          ctx.expect(Manager.getEnvironment()).toBe('development');
        } finally {
          if (prevTest !== undefined) process.env.EM_TEST_MODE = prevTest;
          if (prevBuild !== undefined) process.env.EM_BUILD_MODE = prevBuild;
          if (prevNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNode;
        }
      },
    },
    {
      // The core invariant of the SSOT refactor: is*() DERIVE from getEnvironment(), so they
      // can NEVER disagree with it, and exactly one is always true. (In plain Node `app` is
      // unavailable, so getEnvironment() resolves via the env-var / config fallback.)
      name: 'invariant: is*() exactly matches getEnvironment() + mutually exclusive (every scenario)',
      run: (ctx) => {
        const prevTest = process.env.EM_TEST_MODE;
        const prevBuild = process.env.EM_BUILD_MODE;
        const prevNode = process.env.NODE_ENV;
        const scenarios = [
          { env: { EM_TEST_MODE: 'true', EM_BUILD_MODE: 'true' }, expect: 'testing' },
          { env: { EM_BUILD_MODE: 'true' },                       expect: 'production' },
          { env: { NODE_ENV: 'development' },                     expect: 'development' },
          { env: {},                                              expect: 'production' }, // EM defaults prod (shipped artifact)
        ];
        try {
          for (const s of scenarios) {
            delete process.env.EM_TEST_MODE; delete process.env.EM_BUILD_MODE; delete process.env.NODE_ENV;
            for (const k of Object.keys(s.env)) process.env[k] = s.env[k];
            const e = Manager.getEnvironment();
            ctx.expect(e).toBe(s.expect);
            ctx.expect(Manager.isDevelopment()).toBe(e === 'development');
            ctx.expect(Manager.isTesting()).toBe(e === 'testing');
            ctx.expect(Manager.isProduction()).toBe(e === 'production');
            const trueCount = [Manager.isDevelopment(), Manager.isTesting(), Manager.isProduction()].filter(Boolean).length;
            ctx.expect(trueCount).toBe(1);
          }
        } finally {
          if (prevTest === undefined) delete process.env.EM_TEST_MODE; else process.env.EM_TEST_MODE = prevTest;
          if (prevBuild === undefined) delete process.env.EM_BUILD_MODE; else process.env.EM_BUILD_MODE = prevBuild;
          if (prevNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNode;
        }
      },
    },
    {
      name: 'getPackage("main") resolves to EM package.json',
      run: (ctx) => {
        const pkg = Manager.getPackage('main');
        ctx.expect(pkg.name).toBe('electron-manager');
        ctx.expect(pkg).toHaveProperty('version');
        ctx.expect(pkg).toHaveProperty('exports');
      },
    },
    {
      name: 'getRootPath("main") returns a non-empty string',
      run: (ctx) => {
        const root = Manager.getRootPath('main');
        ctx.expect(typeof root).toBe('string');
        ctx.expect(root.length).toBeGreaterThan(0);
      },
    },
    {
      name: 'getLiveReloadPort defaults to 35729',
      run: (ctx) => {
        const prev = process.env.EM_LIVERELOAD_PORT;
        delete process.env.EM_LIVERELOAD_PORT;
        try {
          ctx.expect(Manager.getLiveReloadPort()).toBe(35729);
        } finally {
          if (prev !== undefined) process.env.EM_LIVERELOAD_PORT = prev;
        }
      },
    },
    {
      name: 'getWindowsSignStrategy defaults to self-hosted when no config',
      run: (ctx) => {
        // No EM_WIN_SIGN_STRATEGY env-var support anymore — config is the only source.
        // Run from a cwd with no electron-manager.json to confirm the default.
        const fs = require('fs'); const os = require('os'); const path = require('path');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-strategy-'));
        const orig = process.cwd();
        try {
          process.chdir(tmp);
          ctx.expect(Manager.getWindowsSignStrategy()).toBe('self-hosted');
        } finally {
          process.chdir(orig);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getWindowsSignStrategy reads config.targets.win.signing.strategy',
      run: (ctx) => {
        const fs = require('fs'); const os = require('os'); const path = require('path');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-strategy-'));
        fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'config', 'electron-manager.json'),
          `{ targets: { win: { signing: { strategy: 'cloud' } } } }`);
        const orig = process.cwd();
        try {
          process.chdir(tmp);
          ctx.expect(Manager.getWindowsSignStrategy()).toBe('cloud');
        } finally {
          process.chdir(orig);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'logger returns a named logger',
      run: (ctx) => {
        const m = new Manager();
        const logger = m.logger('test-name');
        ctx.expect(logger.name).toBe('test-name');
        ctx.expect(typeof logger.log).toBe('function');
        ctx.expect(typeof logger.error).toBe('function');
      },
    },
  ],
};
