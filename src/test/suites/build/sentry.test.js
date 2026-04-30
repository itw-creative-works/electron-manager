// Build-layer tests for lib/sentry/{core,index,main,renderer,preload}.js — config gating,
// dev mode, normalize user, release tagging, no-op behavior when SDK absent.

const path = require('path');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'sentry — per-context lib structure',
  tests: [
    {
      name: 'core exports the expected helpers',
      run: (ctx) => {
        const core = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'core.js'));
        ctx.expect(typeof core.resolveConfig).toBe('function');
        ctx.expect(typeof core.normalizeUser).toBe('function');
        ctx.expect(typeof core.resolveRelease).toBe('function');
        ctx.expect(typeof core.DEFAULTS).toBe('object');
      },
    },
    {
      name: 'index detects context and re-exports a context module',
      run: (ctx) => {
        const sentry = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'index.js'));
        ctx.expect(typeof sentry.initialize).toBe('function');
        ctx.expect(typeof sentry.captureException).toBe('function');
        ctx.expect(typeof sentry.captureMessage).toBe('function');
      },
    },
    {
      name: 'resolveConfig: disabled when no DSN set',
      run: (ctx) => {
        const { resolveConfig } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'core.js'));
        const result = resolveConfig({ config: { sentry: { dsn: '' } } });
        ctx.expect(result.shouldEnable).toBe(false);
        ctx.expect(result.reason).toMatch(/dsn/i);
      },
    },
    {
      name: 'resolveConfig: disabled in dev mode unless EM_SENTRY_FORCE',
      run: (ctx) => {
        const { resolveConfig } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'core.js'));
        const orig = { mode: process.env.EM_BUILD_MODE, force: process.env.EM_SENTRY_FORCE };
        delete process.env.EM_BUILD_MODE;
        delete process.env.EM_SENTRY_FORCE;
        try {
          const result = resolveConfig({ config: { sentry: { dsn: 'https://x@y.io/1' } } });
          ctx.expect(result.shouldEnable).toBe(false);
          ctx.expect(result.reason).toMatch(/dev mode/);
        } finally {
          if (orig.mode !== undefined) process.env.EM_BUILD_MODE = orig.mode;
          if (orig.force !== undefined) process.env.EM_SENTRY_FORCE = orig.force;
        }
      },
    },
    {
      name: 'resolveConfig: enabled in production with DSN',
      run: (ctx) => {
        const { resolveConfig } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'core.js'));
        const orig = process.env.EM_BUILD_MODE;
        process.env.EM_BUILD_MODE = 'true';
        try {
          const result = resolveConfig({ config: { sentry: { dsn: 'https://x@y.io/1' } } });
          ctx.expect(result.shouldEnable).toBe(true);
          ctx.expect(result.options.environment).toBe('production');
          ctx.expect(result.options.dsn).toBe('https://x@y.io/1');
        } finally {
          if (orig === undefined) delete process.env.EM_BUILD_MODE; else process.env.EM_BUILD_MODE = orig;
        }
      },
    },
    {
      name: 'resolveConfig: EM_SENTRY_ENABLED=false overrides everything',
      run: (ctx) => {
        const { resolveConfig } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'core.js'));
        const origMode = process.env.EM_BUILD_MODE;
        const origEnabled = process.env.EM_SENTRY_ENABLED;
        process.env.EM_BUILD_MODE = 'true';
        process.env.EM_SENTRY_ENABLED = 'false';
        try {
          const result = resolveConfig({ config: { sentry: { dsn: 'https://x@y.io/1' } } });
          ctx.expect(result.shouldEnable).toBe(false);
          ctx.expect(result.reason).toMatch(/EM_SENTRY_ENABLED/);
        } finally {
          if (origMode === undefined) delete process.env.EM_BUILD_MODE; else process.env.EM_BUILD_MODE = origMode;
          if (origEnabled === undefined) delete process.env.EM_SENTRY_ENABLED; else process.env.EM_SENTRY_ENABLED = origEnabled;
        }
      },
    },
    {
      name: 'normalizeUser maps uid + email',
      run: (ctx) => {
        const { normalizeUser } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'core.js'));
        const out = normalizeUser({ uid: 'abc123', email: 'foo@bar.com', extraField: 'ignored' });
        ctx.expect(out.id).toBe('abc123');
        ctx.expect(out.email).toBe('foo@bar.com');
        ctx.expect(out.extraField).toBeUndefined();
      },
    },
    {
      name: 'normalizeUser scrubs email when scrubEmail option set',
      run: (ctx) => {
        const { normalizeUser } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'core.js'));
        const out = normalizeUser({ uid: 'abc', email: 'foo@bar.com' }, { scrubEmail: true });
        ctx.expect(out.id).toBe('abc');
        ctx.expect(out.email).toBeUndefined();
      },
    },
    {
      name: 'normalizeUser returns null for null/empty input',
      run: (ctx) => {
        const { normalizeUser } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'core.js'));
        ctx.expect(normalizeUser(null)).toBe(null);
        ctx.expect(normalizeUser({})).toBe(null);
      },
    },
    {
      name: 'main.initialize is a no-op when sentry disabled (no DSN)',
      run: (ctx) => {
        const main = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'main.js'));
        main.shutdown();
        main.initialize({ config: { sentry: { dsn: '' } } });
        ctx.expect(main._enabled).toBe(false);
        // captureException should not throw.
        main.captureException(new Error('test'));
      },
    },
    {
      name: 'main.captureException is a no-op when not enabled',
      run: (ctx) => {
        const main = require(path.join(__dirname, '..', '..', '..', 'lib', 'sentry', 'main.js'));
        main.shutdown();
        // Don't initialize.
        let threw;
        try { main.captureException(new Error('test')); } catch (e) { threw = e; }
        ctx.expect(threw).toBeUndefined();
      },
    },
  ],
};
