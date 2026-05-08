// Renderer-layer tests for the cross-context helpers (mode-helpers + url-helpers).
// Verifies that `manager.isDevelopment / isProduction / isTesting / getVersion`
// AND `manager.getEnvironment / getApiUrl / getFunctionsUrl / getWebsiteUrl` work
// end-to-end inside a real renderer process, not just in main.
//
// The renderer-preload (test/harness/renderer-preload.js) instantiates a renderer
// Manager and exposes its helpers via contextBridge as `window.__emTestManager`.
// Test bodies are stringified + reconstructed via `new Function('ctx', body)` so
// they only have access to `ctx` and `window` — no closures over module scope.

module.exports = {
  type: 'suite',
  layer: 'renderer',
  description: 'cross-context helpers (renderer)',
  tests: [
    {
      name: '__emTestManager is exposed by the test preload',
      run: (ctx) => {
        ctx.expect(typeof window.__emTestManager).toBe('object');
        ctx.expect(window.__emTestManager).toBeTruthy();
      },
    },
    {
      name: 'isTesting() returns true (we are running under EM_TEST_MODE=true)',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.isTesting()).toBe(true);
      },
    },
    {
      name: 'isDevelopment() works (renderer has no app.isPackaged so it falls through)',
      run: (ctx) => {
        // In renderer process, `electron.app` is undefined, so the helper falls back
        // to NODE_ENV / config.em.environment. The test harness seeds config with
        // environment='production' so this should report false.
        const v = window.__emTestManager.isDevelopment();
        ctx.expect(typeof v).toBe('boolean');
      },
    },
    {
      name: 'isProduction() is the inverse of isDevelopment()',
      run: (ctx) => {
        const dev  = window.__emTestManager.isDevelopment();
        const prod = window.__emTestManager.isProduction();
        ctx.expect(prod).toBe(!dev);
      },
    },
    {
      name: 'getVersion() returns a string or null without throwing',
      run: (ctx) => {
        const v = window.__emTestManager.getVersion();
        // In renderer, `electron.app` is unavailable and process.cwd()/package.json
        // resolves to whatever the test harness was launched from — could be either
        // a string or null. Assert just the shape.
        ctx.expect(v === null || typeof v === 'string').toBe(true);
      },
    },
    {
      name: 'getEnvironment(): returns config.em.environment when set',
      run: (ctx) => {
        window.__emTestManager.setConfig('em.environment', 'production');
        ctx.expect(window.__emTestManager.getEnvironment()).toBe('production');
        window.__emTestManager.setConfig('em.environment', 'development');
        ctx.expect(window.__emTestManager.getEnvironment()).toBe('development');
        // Reset.
        window.__emTestManager.setConfig('em.environment', 'production');
      },
    },
    {
      name: 'getFunctionsUrl: dev → localhost:5001/<projectId>/us-central1',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getFunctionsUrl('development'))
          .toBe('http://localhost:5001/demo-app/us-central1');
      },
    },
    {
      name: 'getFunctionsUrl: prod → us-central1-<projectId>.cloudfunctions.net',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getFunctionsUrl('production'))
          .toBe('https://us-central1-demo-app.cloudfunctions.net');
      },
    },
    {
      name: 'getApiUrl: dev → http://localhost:5002',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getApiUrl('development')).toBe('http://localhost:5002');
      },
    },
    {
      name: 'getApiUrl: prod → api.<authDomain>',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getApiUrl('production'))
          .toBe('https://api.demo-app.firebaseapp.com');
      },
    },
    {
      name: 'getWebsiteUrl: dev → https://localhost:4000 (BEM convention)',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getWebsiteUrl('development')).toBe('https://localhost:4000');
      },
    },
    {
      name: 'getWebsiteUrl: prod → config.brand.url',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getWebsiteUrl('production')).toBe('https://example.com');
      },
    },
    {
      name: 'getWebsiteUrl: respects current environment when no arg passed',
      run: (ctx) => {
        window.__emTestManager.setConfig('em.environment', 'development');
        ctx.expect(window.__emTestManager.getWebsiteUrl()).toBe('https://localhost:4000');
        window.__emTestManager.setConfig('em.environment', 'production');
        ctx.expect(window.__emTestManager.getWebsiteUrl()).toBe('https://example.com');
      },
    },
  ],
};
