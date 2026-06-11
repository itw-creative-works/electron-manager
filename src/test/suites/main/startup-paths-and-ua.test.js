// Verifies the early-init customizations applied in main.js#initialize:
//   - userData path gets an environment suffix: " (Testing)" under the test
//     harness, " (Development)" in dev, untouched in production
//   - app.userAgentFallback is set to a branded template via node-powertools.template
//
// These are observable side-effects of `manager.initialize()` so we just inspect
// the live electron `app` after the harness boot.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'startup paths + global user agent',
  tests: [
    {
      name: 'userData path includes "(Testing)" suffix under the test harness',
      run: (ctx) => {
        const { app } = require('electron');
        const userData = app.getPath('userData');
        // EM_TEST_MODE=true → isTesting() → dedicated " (Testing)" dir, wiped at
        // boot, so test runs never read or pollute dev ("(Development)") or
        // production data on the same machine.
        ctx.expect(typeof userData).toBe('string');
        ctx.expect(userData.endsWith(' (Testing)')).toBe(true);
      },
    },
    {
      name: 'testing userData dir is freshly created (wiped at boot)',
      run: (ctx) => {
        const fs = require('fs');
        const path = require('path');
        const { app } = require('electron');
        const userData = app.getPath('userData');
        // The wipe ran before storage.initialize(); only files written by THIS
        // boot may exist. A marker from a previous run must never survive.
        const marker = path.join(userData, '__em-wipe-marker');
        ctx.expect(fs.existsSync(marker)).toBe(false);
        // Leave a marker so the NEXT run proves the wipe (self-perpetuating check).
        fs.mkdirSync(userData, { recursive: true });
        fs.writeFileSync(marker, String(Date.now()));
      },
    },
    {
      name: 'app.userAgentFallback is a non-empty string',
      run: (ctx) => {
        const { app } = require('electron');
        ctx.expect(typeof app.userAgentFallback).toBe('string');
        ctx.expect(app.userAgentFallback.length > 0).toBe(true);
      },
    },
    {
      name: 'userAgentFallback merge tags resolved (no leftover {placeholders})',
      run: (ctx) => {
        const { app } = require('electron');
        // If node-powertools.template skipped a key, the literal `{...}` would remain.
        ctx.expect(app.userAgentFallback).not.toMatch(/\{brand\.name\}/);
        ctx.expect(app.userAgentFallback).not.toMatch(/\{app\.version\}/);
        ctx.expect(app.userAgentFallback).not.toMatch(/\{chrome\}/);
      },
    },
    {
      name: 'userAgentFallback contains the brand name from config',
      run: (ctx) => {
        const { app } = require('electron');
        const brand = ctx.manager.config?.brand?.name
          || ctx.manager.config?.app?.productName
          || 'App';
        ctx.expect(app.userAgentFallback).toContain(brand);
      },
    },
    {
      name: 'userAgentFallback contains the chromium version from process.versions.chrome',
      run: (ctx) => {
        const { app } = require('electron');
        ctx.expect(app.userAgentFallback).toContain(process.versions.chrome);
      },
    },
    {
      name: 'userAgentFallback shape matches the platform',
      run: (ctx) => {
        const { app } = require('electron');
        const expectedFragment = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X'
          : process.platform === 'win32'  ? 'Windows NT 10.0; Win64; x64'
          : 'X11; Linux x86_64';
        ctx.expect(app.userAgentFallback).toContain(expectedFragment);
      },
    },
    {
      name: 'userAgentFallback contains AppleWebKit + Chrome + Safari segments',
      run: (ctx) => {
        const { app } = require('electron');
        ctx.expect(app.userAgentFallback).toContain('AppleWebKit/537.36');
        ctx.expect(app.userAgentFallback).toContain('Chrome/');
        ctx.expect(app.userAgentFallback).toContain('Safari/537.36');
      },
    },
  ],
};
