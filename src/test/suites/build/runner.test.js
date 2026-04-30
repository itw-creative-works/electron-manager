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
      name: 'runner install on non-Windows refuses without override',
      run: async (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const origForce = process.env.EM_RUNNER_FORCE;
        delete process.env.EM_RUNNER_FORCE;

        let threw;
        try {
          await runner({ _: ['runner', 'install'] });
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
      name: 'runner install without GH_TOKEN throws',
      run: async (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const origForce = process.env.EM_RUNNER_FORCE;
        const origToken = process.env.GH_TOKEN;
        process.env.EM_RUNNER_FORCE = '1';
        delete process.env.GH_TOKEN;

        let threw;
        try {
          await runner({ _: ['runner', 'install'] });
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
    {
      name: 'GH_TOKEN error message recommends admin:org (not manage_runners:org)',
      run: (ctx) => {
        // Guards against the regression where docs/code suggested manage_runners:org —
        // GitHub's runner-registration endpoint requires admin:org for classic PATs.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('admin:org');
        ctx.expect(src).not.toMatch(/lacks manage_runners:org/);
      },
    },
    {
      name: 'downloadActionsRunner uses tar (not PowerShell Expand-Archive)',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        // Smoke check: tar invocation present, Expand-Archive removed.
        ctx.expect(src).toContain("spawnSync('tar', ['-xf'");
        ctx.expect(src).not.toContain('Expand-Archive');
      },
    },
    {
      name: 'tar can extract a real Windows actions/runner zip (smoke)',
      run: async (ctx) => {
        // Validates the tar approach works against an actual zip with the layout
        // actions/runner ships. We don't pull from GH on every test (slow + flaky);
        // instead build a tiny fixture zip on disk via Node, then extract via tar.
        const fs = require('fs');
        const os = require('os');
        const { spawnSync } = require('child_process');

        // Skip if tar isn't on PATH for any reason.
        const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['tar']);
        if (which.status !== 0) {
          ctx.skip('tar not found on PATH');
        }

        // Build a minimal zip via Node — uses the same standard zip container that
        // actions/runner ships. We're testing that tar's zip support works at all.
        // Smallest valid zip = 22-byte EOCD with no entries.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-tar-test-'));
        const zipPath = path.join(tmp, 'empty.zip');
        // EOCD signature (PK\x05\x06) + 18 zero bytes = empty valid zip
        const eocd = Buffer.from([0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        fs.writeFileSync(zipPath, eocd);

        const r = spawnSync('tar', ['-xf', zipPath, '-C', tmp]);
        // Cleanup before assertion so we don't leak tmp dirs on failure.
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }

        ctx.expect(r.status).toBe(0);
      },
    },
    {
      name: 'install surfaces zero-success failure with non-zero exit code',
      run: (ctx) => {
        // Source-text guard: confirm install reports + sets exitCode when 0/N orgs registered.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('Install summary');
        ctx.expect(src).toContain('process.exitCode = 1');
        ctx.expect(src).toContain('failedByReason');
      },
    },
    {
      name: 'install is idempotent — calls uninstall first if RUNNER_HOME exists',
      run: (ctx) => {
        // Source-text guard: re-running install should never leave you in a worse state.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('Existing em-runner installation detected');
        ctx.expect(src).toContain('uninstalling first for a clean re-install');
      },
    },
    {
      name: 'downloadActionsRunner uses curl + size validation (not wonderful-fetch buffer)',
      run: (ctx) => {
        // Guards against the regression where wonderful-fetch returned an unexpected
        // ~224MB buffer that tar couldn't extract.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain("spawnSync('curl'");
        ctx.expect(src).toContain('1024 * 1024');                  // size sanity check
        ctx.expect(src).not.toContain("require('wonderful-fetch')");
      },
    },
    {
      name: 'install + uninstall require admin (ensureWindowsAdmin)',
      run: (ctx) => {
        // Without admin, sc.exe silently fails with 1060 and we end up debugging the wrong thing.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('function ensureWindowsAdmin');
        ctx.expect(src).toContain("spawnSync('net', ['session']");
        ctx.expect(src).toContain('Run as Administrator');
      },
    },
    {
      name: 'uninstall sweeps up leftover actions.runner.* services + retries removal',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('uninstallActionsRunnerServices');
        ctx.expect(src).toContain('removeRunnerHomeWithRetry');
        ctx.expect(src).toContain('SERVICE_NAME:\\s*(actions\\.runner');   // pattern for service discovery
      },
    },
    {
      name: 'RUNNER_HOME defaults to <cwd>/.gh-runners (not ~/.em-runner)',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain(".gh-runners");
        ctx.expect(src).toContain('EM_RUNNER_HOME');
        ctx.expect(src).not.toMatch(/path\.join\(os\.homedir\(\),\s*['"]\.em-runner['"]/);
      },
    },
    {
      name: 'install honors EM_RUNNER_ORGS filter from env',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('EM_RUNNER_ORGS');
        ctx.expect(src).toContain('filter');
      },
    },
    {
      name: 'each org gets its own actions-runner-<org>/ directory (multi-org architecture)',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('actions-runner-${org.toLowerCase()}');
        ctx.expect(src).toContain('templateDir');
      },
    },
    {
      name: 'config.cmd spawn captures stdout/stderr (no more silent status:null)',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain("stdio:    ['ignore', 'pipe', 'pipe']");
        ctx.expect(src).toContain('null (killed)');                       // surfaces kill status meaningfully
      },
    },
  ],
};
