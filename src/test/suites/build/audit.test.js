// Build-layer tests for gulp/audit — schema + filesystem validation against the consumer config.
//
// audit operates on process.cwd() so we stage a fake consumer dir in a temp folder, chdir in,
// invoke the gulp task, and inspect what it does (calls done() vs calls done(err)).

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const jetpack = require('fs-jetpack');

const auditPath = path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'audit.js');

function freshAudit() {
  // Clear require cache so each test gets a clean module (it instantiates Manager at require time).
  delete require.cache[require.resolve(auditPath)];
  return require(auditPath);
}

function stageConsumer(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-audit-'));
  jetpack.dir(path.join(tmp, 'config'));
  jetpack.dir(path.join(tmp, 'src'));
  jetpack.write(path.join(tmp, 'src', 'main.js'),    '// stub');
  jetpack.write(path.join(tmp, 'src', 'preload.js'), '// stub');

  const baseConfig = {
    brand: { id: 'testapp', name: 'TestApp', images: { icon: '' } },
    app:   { appId: 'com.test.app', productName: 'TestApp' },
  };
  const merged = { ...baseConfig, ...overrides };
  jetpack.write(path.join(tmp, 'config', 'electron-manager.json'), JSON.stringify(merged));

  return tmp;
}

function runAudit(cwd, env = {}) {
  return new Promise((resolve) => {
    const origCwd = process.cwd();
    // Force build/publish env off — minimal scaffolds don't include icons/cert files.
    // Tests that want to exercise publish-mode checks pass env explicitly.
    const baseEnv = { EM_BUILD_MODE: '', EM_IS_PUBLISH: '', EM_IS_SERVER: '' };
    const allEnv  = { ...baseEnv, ...env };
    const origEnv = {};
    for (const k of Object.keys(allEnv)) {
      origEnv[k] = process.env[k];
      process.env[k] = allEnv[k];
    }
    process.chdir(cwd);
    try {
      const audit = freshAudit();
      audit((err) => resolve(err || null));
    } finally {
      process.chdir(origCwd);
      for (const [k, v] of Object.entries(origEnv)) {
        if (v === undefined) delete process.env[k];
        else if (v === '') delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'gulp/audit — config + filesystem validation',
  tests: [
    {
      name: 'passes on a minimal valid scaffold',
      run: async (ctx) => {
        const tmp = stageConsumer();
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeNull();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'fails when brand.id is missing',
      run: async (ctx) => {
        const tmp = stageConsumer({ brand: {} });
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeDefined();
          ctx.expect(err.message).toMatch(/brand\.id is required/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'fails when brand.name is missing',
      run: async (ctx) => {
        // brand.name is now required (it drives the productName default).
        const tmp = stageConsumer({ brand: { id: 'x' } });
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeDefined();
          ctx.expect(err.message).toMatch(/brand\.name is required/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'passes when only brand.id + brand.name set (appId/productName auto-derive)',
      run: async (ctx) => {
        const tmp = stageConsumer({ brand: { id: 'x', name: 'X' } });
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeNull();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'fails when src/main.js is missing',
      run: async (ctx) => {
        const tmp = stageConsumer();
        fs.unlinkSync(path.join(tmp, 'src', 'main.js'));
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeDefined();
          ctx.expect(err.message).toMatch(/src\/main\.js not found/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'fails when brand.images.icon points to a missing file (build mode)',
      run: async (ctx) => {
        const tmp = stageConsumer({
          brand: { id: 'testapp', images: { icon: 'src/assets/icons/missing.png' } },
          app:   { appId: 'com.test.app', productName: 'TestApp' },
        });
        try {
          const err = await runAudit(tmp, { EM_BUILD_MODE: 'true' });
          ctx.expect(err).toBeDefined();
          ctx.expect(err.message).toMatch(/icon.*not found/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'passes when icon is missing in dev mode (icon is packaging-only)',
      run: async (ctx) => {
        const tmp = stageConsumer({
          brand: { id: 'testapp', name: 'TestApp', images: { icon: 'src/assets/icons/missing.png' } },
          app:   { appId: 'com.test.app', productName: 'TestApp' },
        });
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeNull();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'fails on invalid startup.mode',
      run: async (ctx) => {
        const tmp = stageConsumer({
          brand: { id: 'testapp' },
          app:   { appId: 'com.test.app', productName: 'TestApp' },
          startup: { mode: 'invisible' },
        });
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeDefined();
          ctx.expect(err.message).toMatch(/startup\.mode "invisible" is invalid/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'fails on invalid Windows signing strategy',
      run: async (ctx) => {
        const tmp = stageConsumer({
          brand:   { id: 'testapp', name: 'TestApp' },
          app:     { appId: 'com.test.app', productName: 'TestApp' },
          targets: { win: { signing: { strategy: 'banana' } } },
        });
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeDefined();
          ctx.expect(err.message).toMatch(/targets\.win\.signing\.strategy "banana" is invalid/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'fails on brand.id that is not a valid URL scheme',
      run: async (ctx) => {
        // brand.id doubles as the deep-link scheme — must be lowercase, alnum/+/-/.
        const tmp = stageConsumer({
          brand: { id: 'My App!', name: 'X' },
        });
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeDefined();
          ctx.expect(err.message).toMatch(/brand\.id.*URL scheme/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'collects multiple errors into one numbered list',
      run: async (ctx) => {
        // Multiple required fields missing + an invalid mode → must collect all into one
        // numbered list (not stop at first failure).
        const tmp = stageConsumer({
          brand:   {},
          app:     {},
          startup: { mode: 'invisible' },
        });
        try {
          const err = await runAudit(tmp);
          ctx.expect(err).toBeDefined();
          // brand.id, brand.name, startup.mode = 3 numbered lines.
          ctx.expect(err.message).toMatch(/1\. /);
          ctx.expect(err.message).toMatch(/2\. /);
          ctx.expect(err.message).toMatch(/3\. /);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
