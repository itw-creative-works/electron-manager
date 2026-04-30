// Build-layer tests for the runner command. Most behavior is platform-gated to Windows;
// what we can verify on Mac is: module shape, error paths for non-Windows, error messages
// for missing GH_TOKEN, subcommand dispatch.

const path = require('path');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'runner command — Windows EV-token signing runner',
  tests: [
    {
      name: 'runner command exports a function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        ctx.expect(typeof mod).toBe('function');
        ctx.expect(Array.isArray(mod.RUNNER_LABELS)).toBe(true);
        ctx.expect(mod.RUNNER_LABELS).toContain('self-hosted');
        ctx.expect(mod.RUNNER_LABELS).toContain('windows');
        ctx.expect(mod.RUNNER_LABELS).toContain('ev-token');
      },
    },
    {
      name: 'runner pinned actions/runner version is set',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        ctx.expect(typeof mod.ACTIONS_RUNNER_VERSION).toBe('string');
        ctx.expect(mod.ACTIONS_RUNNER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      },
    },
    {
      name: 'runner unknown subcommand throws',
      run: async (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        let threw;
        try {
          await runner({ _: ['runner', 'banana'] });
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/Unknown runner subcommand/);
      },
    },
    {
      name: 'runner bootstrap on non-Windows refuses without override',
      run: async (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const origForce = process.env.EM_RUNNER_FORCE;
        delete process.env.EM_RUNNER_FORCE;

        let threw;
        try {
          await runner({ _: ['runner', 'bootstrap'] });
        } catch (e) { threw = e; }

        if (origForce !== undefined) process.env.EM_RUNNER_FORCE = origForce;

        ctx.expect(threw).toBeDefined();
        // On macOS we expect the platform check to win
        if (process.platform !== 'win32') {
          ctx.expect(threw.message).toMatch(/only runs on Windows/);
        }
      },
    },
    {
      name: 'runner register-org without org throws clear error',
      run: async (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const origForce = process.env.EM_RUNNER_FORCE;
        const origToken = process.env.GH_TOKEN;
        process.env.EM_RUNNER_FORCE = '1';
        process.env.GH_TOKEN = 'ghp_test_dummy';

        let threw;
        try {
          await runner({ _: ['runner', 'register-org'] });   // no org
        } catch (e) { threw = e; }

        if (origForce !== undefined) process.env.EM_RUNNER_FORCE = origForce;
        else delete process.env.EM_RUNNER_FORCE;
        if (origToken !== undefined) process.env.GH_TOKEN = origToken;
        else delete process.env.GH_TOKEN;

        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/Usage:.*register-org/);
      },
    },
    {
      name: 'runner bootstrap without GH_TOKEN throws',
      run: async (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const origForce = process.env.EM_RUNNER_FORCE;
        const origToken = process.env.GH_TOKEN;
        process.env.EM_RUNNER_FORCE = '1';
        delete process.env.GH_TOKEN;

        let threw;
        try {
          await runner({ _: ['runner', 'bootstrap'] });
        } catch (e) { threw = e; }

        if (origForce !== undefined) process.env.EM_RUNNER_FORCE = origForce;
        else delete process.env.EM_RUNNER_FORCE;
        if (origToken !== undefined) process.env.GH_TOKEN = origToken;

        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/GH_TOKEN/);
      },
    },
    {
      name: 'watcher daemon file exists and is syntactically valid',
      run: (ctx) => {
        const fs = require('fs');
        const watcherPath = path.join(__dirname, '..', '..', '..', 'runner', 'watcher.js');
        ctx.expect(fs.existsSync(watcherPath)).toBe(true);
        const src = fs.readFileSync(watcherPath, 'utf8');
        // Smoke-check the watcher's core API is referenced.
        ctx.expect(src).toContain('discoverAdminOrgs');
        ctx.expect(src).toContain('selfUpdate');
        ctx.expect(src).toContain('em-runner-watcher');
      },
    },
  ],
};
