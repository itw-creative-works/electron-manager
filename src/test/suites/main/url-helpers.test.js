// Tests for src/utils/url-helpers.js — getFunctionsUrl / getApiUrl / getWebsiteUrl —
// plus the getEnvironment() resolution they depend on (getEnvironment itself is the
// SSOT defined in src/utils/mode-helpers.js; these tests exercise it through the
// Manager because the URL helpers route through `this.config` and `this.getEnvironment()`).
// The manager (already bootstrapped by the test harness) is the natural object under test.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'url-helpers (cross-context)',
  tests: [
    {
      name: 'getEnvironment: testing (EM_TEST_MODE) wins; else config.em.environment',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config?.em?.environment;
        const origTest = process.env.EM_TEST_MODE;
        m.config.em = m.config.em || {};
        try {
          // Testing takes precedence over the config override.
          process.env.EM_TEST_MODE = 'true';
          m.config.em.environment = 'production';
          ctx.expect(m.getEnvironment()).toBe('testing');
          // With testing cleared, the config override is honored.
          delete process.env.EM_TEST_MODE;
          m.config.em.environment = 'development';
          ctx.expect(m.getEnvironment()).toBe('development');
          m.config.em.environment = 'production';
          ctx.expect(m.getEnvironment()).toBe('production');
        } finally {
          m.config.em.environment = orig;
          if (origTest === undefined) delete process.env.EM_TEST_MODE; else process.env.EM_TEST_MODE = origTest;
        }
      },
    },
    {
      // In the MAIN process, app.isPackaged is the authoritative signal and beats the
      // EM_BUILD_MODE fallback. The test harness is unpackaged, so once testing + config are
      // cleared, getEnvironment() resolves to 'development' from app.isPackaged === false —
      // regardless of EM_BUILD_MODE. (The EM_BUILD_MODE fallback only applies where `app` is
      // unavailable: renderer / preload / plain Node — covered by the build-layer manager test.)
      name: 'getEnvironment: app.isPackaged (unpackaged → development) wins over EM_BUILD_MODE in main',
      run: (ctx) => {
        const m = ctx.manager;
        const origEnv  = m.config?.em?.environment;
        const origBuild = process.env.EM_BUILD_MODE;
        const origTest = process.env.EM_TEST_MODE;
        if (m.config.em) delete m.config.em.environment;
        delete process.env.EM_TEST_MODE; // isolate from testing precedence
        try {
          // Unpackaged harness → 'development' even with EM_BUILD_MODE set (app.isPackaged wins).
          process.env.EM_BUILD_MODE = 'true';
          ctx.expect(m.getEnvironment()).toBe('development');
          delete process.env.EM_BUILD_MODE;
          ctx.expect(m.getEnvironment()).toBe('development');
        } finally {
          if (origEnv !== undefined) m.config.em.environment = origEnv;
          if (origBuild !== undefined) process.env.EM_BUILD_MODE = origBuild;
          else delete process.env.EM_BUILD_MODE;
          if (origTest !== undefined) process.env.EM_TEST_MODE = origTest;
        }
      },
    },
    {
      name: 'getFunctionsUrl: dev returns localhost:5001/<projectId>/us-central1',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.firebaseConfig = m.config.firebaseConfig || {};
        const orig = m.config.firebaseConfig.projectId;
        m.config.firebaseConfig.projectId = 'demo-app';
        try {
          ctx.expect(m.getFunctionsUrl('development')).toBe('http://localhost:5001/demo-app/us-central1');
        } finally { m.config.firebaseConfig.projectId = orig; }
      },
    },
    {
      name: 'getFunctionsUrl: prod returns us-central1-<projectId>.cloudfunctions.net',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.firebaseConfig = m.config.firebaseConfig || {};
        const orig = m.config.firebaseConfig.projectId;
        m.config.firebaseConfig.projectId = 'demo-app';
        try {
          ctx.expect(m.getFunctionsUrl('production')).toBe('https://us-central1-demo-app.cloudfunctions.net');
        } finally { m.config.firebaseConfig.projectId = orig; }
      },
    },
    {
      name: 'getFunctionsUrl: throws when projectId missing',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config.firebaseConfig?.projectId;
        if (m.config.firebaseConfig) delete m.config.firebaseConfig.projectId;
        try {
          let threw;
          try { m.getFunctionsUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/firebaseConfig\.projectId/);
        } finally {
          if (orig !== undefined) m.config.firebaseConfig.projectId = orig;
        }
      },
    },
    {
      name: 'getApiUrl: dev returns http://localhost:5002',
      run: (ctx) => {
        ctx.expect(ctx.manager.getApiUrl('development')).toBe('http://localhost:5002');
      },
    },
    {
      name: 'getApiUrl: testing also returns http://localhost:5002 (local, not prod)',
      run: (ctx) => {
        // Testing resolves to the local URL just like development — tests must hit the
        // local emulator, never the production API.
        ctx.expect(ctx.manager.getApiUrl('testing')).toBe('http://localhost:5002');
      },
    },
    {
      name: 'getApiUrl: prod returns api.<authDomain>',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.firebaseConfig = m.config.firebaseConfig || {};
        const orig = m.config.firebaseConfig.authDomain;
        m.config.firebaseConfig.authDomain = 'demo-app.firebaseapp.com';
        try {
          ctx.expect(m.getApiUrl('production')).toBe('https://api.demo-app.firebaseapp.com');
        } finally { m.config.firebaseConfig.authDomain = orig; }
      },
    },
    {
      name: 'getApiUrl: throws when authDomain missing in prod',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config.firebaseConfig?.authDomain;
        if (m.config.firebaseConfig) delete m.config.firebaseConfig.authDomain;
        try {
          let threw;
          try { m.getApiUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/firebaseConfig\.authDomain/);
        } finally {
          if (orig !== undefined) m.config.firebaseConfig.authDomain = orig;
        }
      },
    },
    {
      name: 'getWebsiteUrl: dev returns https://localhost:4000 (BEM convention)',
      run: (ctx) => {
        ctx.expect(ctx.manager.getWebsiteUrl('development')).toBe('https://localhost:4000');
      },
    },
    {
      name: 'getWebsiteUrl: prod returns config.brand.url',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.brand = m.config.brand || {};
        const orig = m.config.brand.url;
        m.config.brand.url = 'https://example.com';
        try {
          ctx.expect(m.getWebsiteUrl('production')).toBe('https://example.com');
        } finally { m.config.brand.url = orig; }
      },
    },
    {
      name: 'getWebsiteUrl: throws in prod when brand.url is missing',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config.brand?.url;
        if (m.config.brand) delete m.config.brand.url;
        try {
          let threw;
          try { m.getWebsiteUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/brand\.url/);
        } finally {
          if (orig !== undefined) m.config.brand.url = orig;
        }
      },
    },
    {
      name: 'getWebsiteUrl: respects current environment (config override) when no arg passed',
      run: (ctx) => {
        const m = ctx.manager;
        const origEnv = m.config.em?.environment;
        const origTest = process.env.EM_TEST_MODE;
        m.config.em = m.config.em || {};
        m.config.brand = m.config.brand || {};
        const origUrl = m.config.brand.url;
        m.config.brand.url = 'https://example.com';
        // Clear EM_TEST_MODE so the config override is exercised — otherwise testing wins
        // (correctly) and every URL resolves local regardless of config.
        delete process.env.EM_TEST_MODE;
        try {
          m.config.em.environment = 'development';
          ctx.expect(m.getWebsiteUrl()).toBe('https://localhost:4000');
          m.config.em.environment = 'production';
          ctx.expect(m.getWebsiteUrl()).toBe('https://example.com');
        } finally {
          if (origEnv !== undefined) m.config.em.environment = origEnv;
          else delete m.config.em.environment;
          if (origTest !== undefined) process.env.EM_TEST_MODE = origTest;
          m.config.brand.url = origUrl;
        }
      },
    },
  ],
};
