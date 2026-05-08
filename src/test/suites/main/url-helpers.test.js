// Tests for src/utils/url-helpers.js — getEnvironment / getFunctionsUrl /
// getApiUrl / getWebsiteUrl. Each helper routes through `this.config` and
// `this.getEnvironment()`, so the manager (already bootstrapped by the test
// harness) is the natural object under test.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'url-helpers (cross-context)',
  tests: [
    {
      name: 'getEnvironment: returns config.em.environment when set',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config?.em?.environment;
        m.config.em = m.config.em || {};
        try {
          m.config.em.environment = 'development';
          ctx.expect(m.getEnvironment()).toBe('development');
          m.config.em.environment = 'production';
          ctx.expect(m.getEnvironment()).toBe('production');
        } finally {
          m.config.em.environment = orig;
        }
      },
    },
    {
      name: 'getEnvironment: falls back to EM_BUILD_MODE when config has no env',
      run: (ctx) => {
        const m = ctx.manager;
        const origEnv  = m.config?.em?.environment;
        const origBuild = process.env.EM_BUILD_MODE;
        if (m.config.em) delete m.config.em.environment;
        try {
          process.env.EM_BUILD_MODE = 'true';
          ctx.expect(m.getEnvironment()).toBe('production');
          delete process.env.EM_BUILD_MODE;
          ctx.expect(m.getEnvironment()).toBe('development');
        } finally {
          if (origEnv !== undefined) m.config.em.environment = origEnv;
          if (origBuild !== undefined) process.env.EM_BUILD_MODE = origBuild;
          else delete process.env.EM_BUILD_MODE;
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
      name: 'getWebsiteUrl: respects current environment when no arg passed',
      run: (ctx) => {
        const m = ctx.manager;
        const origEnv = m.config.em?.environment;
        m.config.em = m.config.em || {};
        m.config.brand = m.config.brand || {};
        const origUrl = m.config.brand.url;
        m.config.brand.url = 'https://example.com';
        try {
          m.config.em.environment = 'development';
          ctx.expect(m.getWebsiteUrl()).toBe('https://localhost:4000');
          m.config.em.environment = 'production';
          ctx.expect(m.getWebsiteUrl()).toBe('https://example.com');
        } finally {
          if (origEnv !== undefined) m.config.em.environment = origEnv;
          else delete m.config.em.environment;
          m.config.brand.url = origUrl;
        }
      },
    },
  ],
};
