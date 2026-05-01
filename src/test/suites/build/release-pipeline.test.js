// Build-layer tests for the release pipeline modules.
// We don't actually run electron-builder or signtool — those are external tools.
// We verify the modules load cleanly, export the right shape, and dispatch correctly.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// Helper: stage a consumer dir with config/electron-manager.json containing the given
// signing.windows.strategy. Returns the abs path to the temp dir; caller is responsible
// for chdir'ing into it and cleaning up.
function stageStrategyConfig({ strategy }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-sign-'));
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'config', 'electron-manager.json'),
    JSON.stringify({ signing: { windows: { strategy } } }),
  );
  return tmp;
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'release pipeline — package / release / sign-windows / notarize hook',
  tests: [
    {
      name: 'gulp/package.js exports a function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'package.js'));
        ctx.expect(typeof mod).toBe('function');
      },
    },
    {
      name: 'gulp/release.js exports a function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'release.js'));
        ctx.expect(typeof mod).toBe('function');
      },
    },
    {
      name: 'gulp/build-config.js exports a function (already-tested separately, smoke check here)',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        ctx.expect(typeof mod).toBe('function');
      },
    },
    {
      name: 'commands/sign-windows.js exports an async function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        ctx.expect(typeof mod).toBe('function');
      },
    },
    {
      name: 'sign-windows: --smoke on non-Windows throws',
      run: async (ctx) => {
        if (process.platform === 'win32') return; // skip on actual Windows
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        let threw;
        try {
          await signWindows({ smoke: true });
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/Windows-only|WIN_EV_TOKEN_PATH|WIN_CSC_KEY_PASSWORD/);
      },
    },
    {
      name: 'sign-windows: --target with non-existent file throws',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        let threw;
        try {
          await signWindows({ target: '/nonexistent/binary.exe' });
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/--target file does not exist/);
      },
    },
    {
      name: 'sign-windows: errors clearly when no input directory exists',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        let threw;
        try {
          await signWindows({ in: '/nonexistent/path/that/does/not/exist' });
        } catch (e) {
          threw = e;
        }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/does not exist/);
      },
    },
    {
      name: 'sign-windows: cloud strategy with unknown provider throws a clear error',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        // Stage a consumer dir with strategy='cloud' in electron-manager.json, chdir there.
        const tmp = stageStrategyConfig({ strategy: 'cloud' });
        fs.writeFileSync(path.join(tmp, 'fake.exe'), 'fake');

        const origCwd      = process.cwd();
        const origProvider = process.env.WIN_CLOUD_SIGN_PROVIDER;
        process.env.WIN_CLOUD_SIGN_PROVIDER = 'imaginary-provider-xyz';
        process.chdir(tmp);

        try {
          let threw;
          try {
            await signWindows({ in: tmp, out: path.join(tmp, 'signed') });
          } catch (e) {
            threw = e;
          }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/imaginary-provider-xyz|not yet implemented/);
        } finally {
          process.chdir(origCwd);
          if (origProvider !== undefined) process.env.WIN_CLOUD_SIGN_PROVIDER = origProvider;
          else delete process.env.WIN_CLOUD_SIGN_PROVIDER;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'sign-windows: cloud strategy without provider throws',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        const tmp = stageStrategyConfig({ strategy: 'cloud' });
        fs.writeFileSync(path.join(tmp, 'fake.exe'), 'fake');

        const origCwd      = process.cwd();
        const origProvider = process.env.WIN_CLOUD_SIGN_PROVIDER;
        delete process.env.WIN_CLOUD_SIGN_PROVIDER;
        process.chdir(tmp);

        try {
          let threw;
          try {
            await signWindows({ in: tmp });
          } catch (e) {
            threw = e;
          }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/no provider set/);
        } finally {
          process.chdir(origCwd);
          if (origProvider !== undefined) process.env.WIN_CLOUD_SIGN_PROVIDER = origProvider;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'sign-windows: unknown strategy throws',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        const tmp = stageStrategyConfig({ strategy: 'banana' });
        fs.writeFileSync(path.join(tmp, 'fake.exe'), 'fake');

        const origCwd = process.cwd();
        process.chdir(tmp);

        try {
          let threw;
          try {
            await signWindows({ in: tmp });
          } catch (e) {
            threw = e;
          }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/Unknown Windows signing strategy/);
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'notarize hook: skipped on non-darwin platforms',
      run: async (ctx) => {
        const notarize = require(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize.js'));
        // Just confirms it returns cleanly without env vars when platform isn't darwin.
        const result = await notarize({
          electronPlatformName: 'win32',
          appOutDir: '/tmp',
          packager: { appInfo: { productFilename: 'test' } },
        });
        ctx.expect(result).toBeUndefined();
      },
    },
    {
      name: 'notarize hook: invokes consumer hook at hooks/notarize/post (not legacy hooks/notarize.js)',
      run: (ctx) => {
        // Source-text guard for the rename. We can't easily exercise the live call
        // without staging a fake API key + .app bundle, so this asserts the call site
        // points at the new path. If someone reverts to runConsumerHook('notarize', ...)
        // this fires.
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize.js'), 'utf8');
        ctx.expect(src).toContain("runConsumerHook('notarize/post'");
        ctx.expect(src).not.toMatch(/runConsumerHook\(['"]notarize['"]/);
      },
    },
    {
      name: 'default scaffold ships hooks/notarize/post.js (not legacy hooks/notarize.js)',
      run: (ctx) => {
        const defaultsHooks = path.join(__dirname, '..', '..', '..', 'defaults', 'hooks');
        ctx.expect(fs.existsSync(path.join(defaultsHooks, 'notarize', 'post.js'))).toBe(true);
        ctx.expect(fs.existsSync(path.join(defaultsHooks, 'notarize.js'))).toBe(false);
      },
    },
    {
      name: 'notarize hook: warns + returns when API key env vars are missing',
      run: async (ctx) => {
        const notarize = require(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize.js'));
        // Snapshot + clear env.
        const snapshot = {
          APPLE_API_KEY:    process.env.APPLE_API_KEY,
          APPLE_API_KEY_ID: process.env.APPLE_API_KEY_ID,
          APPLE_API_ISSUER: process.env.APPLE_API_ISSUER,
        };
        delete process.env.APPLE_API_KEY;
        delete process.env.APPLE_API_KEY_ID;
        delete process.env.APPLE_API_ISSUER;

        try {
          const result = await notarize({
            electronPlatformName: 'darwin',
            appOutDir: '/tmp',
            packager: { appInfo: { productFilename: 'test' } },
          });
          ctx.expect(result).toBeUndefined();
        } finally {
          for (const [k, v] of Object.entries(snapshot)) {
            if (v !== undefined) process.env[k] = v;
            else delete process.env[k];
          }
        }
      },
    },
  ],
};
