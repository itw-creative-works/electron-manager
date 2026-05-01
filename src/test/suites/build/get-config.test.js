// Build-layer tests for Manager.getConfig() derived defaults.
// Stages a temp consumer dir with a config/electron-manager.json, sets process.cwd()
// at it, and asserts the derivation rules.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');

function stageConsumer(jsonText) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-getconfig-'));
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'config', 'electron-manager.json'), jsonText);
  return tmp;
}

function loadConfigInDir(dir) {
  const oldCwd = process.cwd();
  // Bust the build module cache since it's a singleton.
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/build.js')) delete require.cache[k];
  }
  try {
    process.chdir(dir);
    const Manager = require(path.join(__dirname, '..', '..', '..', 'build.js'));
    return Manager.getConfig();
  } finally {
    process.chdir(oldCwd);
  }
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'Manager.getConfig — derived defaults',
  tests: [
    {
      name: 'derives appId from brand.id when not set',
      run: (ctx) => {
        const tmp = stageConsumer(`{ brand: { id: 'somiibo', name: 'Somiibo' } }`);
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg.app.appId).toBe('com.itwcreativeworks.somiibo');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'derives productName from brand.name when not set',
      run: (ctx) => {
        const tmp = stageConsumer(`{ brand: { id: 'somiibo', name: 'Somiibo' } }`);
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg.app.productName).toBe('Somiibo');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'preserves explicit appId / productName when set',
      run: (ctx) => {
        const tmp = stageConsumer(`{
          brand: { id: 'somiibo', name: 'Somiibo' },
          app:   { appId: 'com.custom.id', productName: 'Custom Name' }
        }`);
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg.app.appId).toBe('com.custom.id');
          ctx.expect(cfg.app.productName).toBe('Custom Name');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'returns {} when config file missing',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-getconfig-empty-'));
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg).toEqual({});
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
