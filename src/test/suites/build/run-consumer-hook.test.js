// Build-layer tests for src/utils/run-consumer-hook.js — loads consumer's hooks/<name>.js if it
// exists and invokes it; silently skips otherwise; never throws.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'run-consumer-hook — lifecycle hook loader',
  tests: [
    {
      name: 'returns undefined and logs gracefully when hook file does not exist',
      run: async (ctx) => {
        const runConsumerHook = require(path.join(__dirname, '..', '..', '..', 'utils', 'run-consumer-hook.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-hook-'));
        const origCwd = process.cwd();
        process.chdir(tmp);
        try {
          const result = await runConsumerHook('build/pre', { mode: 'production' });
          ctx.expect(result).toBeUndefined();
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'invokes the hook function with provided args and returns its value',
      run: async (ctx) => {
        const runConsumerHook = require(path.join(__dirname, '..', '..', '..', 'utils', 'run-consumer-hook.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-hook-'));
        fs.mkdirSync(path.join(tmp, 'hooks', 'build'), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, 'hooks', 'build', 'pre.js'),
          `module.exports = async (ctx) => ({ called: true, mode: ctx.mode });`,
        );
        // package.json so createRequire has an anchor
        fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"em-hook-test"}');

        const origCwd = process.cwd();
        process.chdir(tmp);
        try {
          const result = await runConsumerHook('build/pre', { mode: 'production' });
          ctx.expect(result).toBeDefined();
          ctx.expect(result.called).toBe(true);
          ctx.expect(result.mode).toBe('production');
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'propagates errors thrown by the hook function (does not swallow)',
      run: async (ctx) => {
        const runConsumerHook = require(path.join(__dirname, '..', '..', '..', 'utils', 'run-consumer-hook.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-hook-'));
        fs.mkdirSync(path.join(tmp, 'hooks'), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, 'hooks', 'thrower.js'),
          `module.exports = async () => { throw new Error('hook bug'); };`,
        );
        fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"em-hook-test"}');

        const origCwd = process.cwd();
        process.chdir(tmp);
        try {
          let caught;
          try {
            await runConsumerHook('thrower');
          } catch (e) { caught = e; }
          ctx.expect(caught).toBeDefined();
          ctx.expect(caught.message).toMatch(/hook bug/);
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'throws when hook file is malformed (syntax error)',
      run: async (ctx) => {
        const runConsumerHook = require(path.join(__dirname, '..', '..', '..', 'utils', 'run-consumer-hook.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-hook-'));
        fs.mkdirSync(path.join(tmp, 'hooks'), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, 'hooks', 'broken.js'),
          `module.exports = async () => { this is not valid javascript`,
        );
        fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"em-hook-test"}');

        const origCwd = process.cwd();
        process.chdir(tmp);
        try {
          let caught;
          try {
            await runConsumerHook('broken');
          } catch (e) { caught = e; }
          ctx.expect(caught).toBeDefined();
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'throws when hook does not export a function',
      run: async (ctx) => {
        const runConsumerHook = require(path.join(__dirname, '..', '..', '..', 'utils', 'run-consumer-hook.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-hook-'));
        fs.mkdirSync(path.join(tmp, 'hooks'), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, 'hooks', 'wrong-shape.js'),
          `module.exports = { not: 'a function' };`,
        );
        fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"em-hook-test"}');

        const origCwd = process.cwd();
        process.chdir(tmp);
        try {
          let caught;
          try {
            await runConsumerHook('wrong-shape');
          } catch (e) { caught = e; }
          ctx.expect(caught).toBeDefined();
          ctx.expect(caught.message).toMatch(/did not export a function/);
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
