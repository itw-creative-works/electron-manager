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
      name: 'getEnvironment is production when EM_BUILD_MODE=true',
      run: (ctx) => {
        const prev = process.env.EM_BUILD_MODE;
        process.env.EM_BUILD_MODE = 'true';
        try {
          ctx.expect(Manager.getEnvironment()).toBe('production');
        } finally {
          if (prev === undefined) delete process.env.EM_BUILD_MODE;
          else process.env.EM_BUILD_MODE = prev;
        }
      },
    },
    {
      name: 'getEnvironment is development when EM_BUILD_MODE unset',
      run: (ctx) => {
        const prev = process.env.EM_BUILD_MODE;
        delete process.env.EM_BUILD_MODE;
        try {
          ctx.expect(Manager.getEnvironment()).toBe('development');
        } finally {
          if (prev !== undefined) process.env.EM_BUILD_MODE = prev;
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
