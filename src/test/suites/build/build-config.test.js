// Build-layer tests for gulp/tasks/build-config.js — verify the object generation
// from EM defaults + consumer config + override merging.

const path = require('path');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'build-config — generate electron-builder.yml from electron-manager.json',
  tests: [
    {
      name: 'task module exports a function plus baseConfig + deepMerge',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        ctx.expect(typeof mod).toBe('function');
        ctx.expect(typeof mod.baseConfig).toBe('function');
        ctx.expect(typeof mod.deepMerge).toBe('function');
      },
    },
    {
      name: 'baseConfig: applies appId/productName/copyright from consumer config',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({
          app: { appId: 'com.itwcreativeworks.somiibo', productName: 'Somiibo', copyright: '© Somiibo' },
        });
        ctx.expect(out.appId).toBe('com.itwcreativeworks.somiibo');
        ctx.expect(out.productName).toBe('Somiibo');
        ctx.expect(out.copyright).toBe('© Somiibo');
      },
    },
    {
      name: 'baseConfig: ships EM defaults for mac/win/linux targets',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({});
        // Mac: dmg + zip, universal arch (one binary that runs on both Intel + Apple Silicon).
        ctx.expect(out.mac.target.find((t) => t.target === 'dmg')).toBeDefined();
        ctx.expect(out.mac.target.find((t) => t.target === 'zip')).toBeDefined();
        ctx.expect(out.mac.target[0].arch).toEqual(['universal']);
        // Win: nsis x64 + ia32 (multi-arch single installer).
        ctx.expect(out.win.target[0].target).toBe('nsis');
        ctx.expect(out.win.target[0].arch).toEqual(['x64', 'ia32']);
        // Linux: deb + AppImage, both x64. No i386.
        const linuxTargets = out.linux.target.map((t) => t.target);
        ctx.expect(linuxTargets).toContain('deb');
        ctx.expect(linuxTargets).toContain('AppImage');
        for (const t of out.linux.target) {
          ctx.expect(t.arch).toEqual(['x64']);
        }
      },
    },
    {
      name: 'baseConfig: notarize is false (notarization runs via afterSign hook)',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({});
        ctx.expect(out.mac.notarize).toBe(false);
        ctx.expect(out.mac.hardenedRuntime).toBe(true);
      },
    },
    {
      name: 'deepMerge: arrays in override REPLACE (not concat) defaults',
      run: (ctx) => {
        const { deepMerge } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = deepMerge(
          { mac: { target: [{ target: 'dmg' }, { target: 'zip' }] } },
          { mac: { target: [{ target: 'dmg', arch: ['x64'] }] } },
        );
        ctx.expect(out.mac.target.length).toBe(1);
        ctx.expect(out.mac.target[0].arch).toEqual(['x64']);
      },
    },
    {
      name: 'deepMerge: nested objects merge per-key',
      run: (ctx) => {
        const { deepMerge } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = deepMerge(
          { mac: { hardenedRuntime: true, gatekeeperAssess: false } },
          { mac: { gatekeeperAssess: true } },
        );
        ctx.expect(out.mac.hardenedRuntime).toBe(true);
        ctx.expect(out.mac.gatekeeperAssess).toBe(true);
      },
    },
    {
      name: 'deepMerge: top-level keys from override added to base',
      run: (ctx) => {
        const { deepMerge } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = deepMerge(
          { appId: 'a', mac: {} },
          { extraField: 'hello' },
        );
        ctx.expect(out.appId).toBe('a');
        ctx.expect(out.extraField).toBe('hello');
      },
    },
    {
      name: 'baseConfig: falls back to safe defaults when consumer config is empty',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({});
        ctx.expect(out.appId).toBeTruthy();
        ctx.expect(out.productName).toBeTruthy();
        ctx.expect(out.directories.output).toBe('release');
      },
    },
    {
      name: 'expandYear: substitutes {YEAR} with current year',
      run: (ctx) => {
        const { expandYear } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const year = new Date().getFullYear();
        ctx.expect(expandYear('© {YEAR}, ITW Creative Works')).toBe(`© ${year}, ITW Creative Works`);
        ctx.expect(expandYear('no token here')).toBe('no token here');
        ctx.expect(expandYear(null)).toBe(null);
      },
    },
    {
      name: 'baseConfig: copyright defaults to "© <YEAR>, ITW Creative Works" when not set',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({});
        const year = new Date().getFullYear();
        ctx.expect(out.copyright).toBe(`© ${year}, ITW Creative Works`);
      },
    },
    {
      name: 'baseConfig: copyright {YEAR} token expanded when consumer overrides',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const year = new Date().getFullYear();
        const out = baseConfig({ app: { copyright: '© {YEAR}, MyCompany' } });
        ctx.expect(out.copyright).toBe(`© ${year}, MyCompany`);
      },
    },
    {
      name: 'baseConfig: app.category maps to per-platform values',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({ app: { category: 'developer-tools' } });
        ctx.expect(out.mac.category).toBe('public.app-category.developer-tools');
        ctx.expect(out.linux.category).toBe('Development');
      },
    },
    {
      name: 'baseConfig: unknown app.category falls back to productivity',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({ app: { category: 'made-up-thing' } });
        ctx.expect(out.mac.category).toBe('public.app-category.productivity');
        ctx.expect(out.linux.category).toBe('Utility');
      },
    },
    {
      name: 'baseConfig: NSIS defaults to oneClick + shortcuts on',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({});
        ctx.expect(out.nsis.oneClick).toBe(true);
        ctx.expect(out.nsis.createDesktopShortcut).toBe('always');
        ctx.expect(out.nsis.createStartMenuShortcut).toBe(true);
        ctx.expect(out.nsis.runAfterFinish).toBe(true);
        ctx.expect(out.nsis.perMachine).toBe(false);
      },
    },
    {
      name: 'baseConfig: targets.win.oneClick: false produces wizard installer',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({ targets: { win: { oneClick: false } } });
        ctx.expect(out.nsis.oneClick).toBe(false);
        ctx.expect(out.nsis.allowToChangeInstallationDirectory).toBe(true);
      },
    },
    {
      name: 'baseConfig: snap disabled by default — no snap target, no snap block',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({});
        ctx.expect(out.linux.target.find((t) => t.target === 'snap')).toBeUndefined();
        ctx.expect(out.snap).toBeUndefined();
      },
    },
    {
      name: 'baseConfig: snap enabled emits snap target + snap publish block',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({ targets: { linux: { snap: { enabled: true } } } });
        ctx.expect(out.linux.target.find((t) => t.target === 'snap')).toBeDefined();
        ctx.expect(out.snap).toBeDefined();
        ctx.expect(out.snap.confinement).toBe('strict');
        ctx.expect(out.snap.publish.provider).toBe('snapStore');
        ctx.expect(out.snap.publish.channels).toEqual(['stable']);
      },
    },
    {
      name: 'baseConfig: targets.<plat>.arch overrides apply per-target',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({
          targets: {
            mac:   { arch: ['arm64'] },
            win:   { arch: ['x64'] },
            linux: { arch: ['arm64'] },
          },
        });
        ctx.expect(out.mac.target[0].arch).toEqual(['arm64']);
        ctx.expect(out.win.target[0].arch).toEqual(['x64']);
        ctx.expect(out.linux.target[0].arch).toEqual(['arm64']);
      },
    },
    {
      name: 'baseConfig: app.languages applied as mac.electronLanguages',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({ app: { languages: ['en', 'es', 'fr'] } });
        ctx.expect(out.mac.electronLanguages).toEqual(['en', 'es', 'fr']);
      },
    },
    {
      name: 'baseConfig: app.darkModeSupport defaults to true; can be disabled',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        ctx.expect(baseConfig({}).mac.darkModeSupport).toBe(true);
        ctx.expect(baseConfig({ app: { darkModeSupport: false } }).mac.darkModeSupport).toBe(false);
      },
    },
    {
      name: 'baseConfig: fileAssociations + protocols passthrough when set',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({
          fileAssociations: [{ name: 'Foo', ext: 'foo' }],
          protocols:        [{ name: 'CustomScheme', schemes: ['custom'] }],
        });
        ctx.expect(out.fileAssociations).toEqual([{ name: 'Foo', ext: 'foo' }]);
        ctx.expect(out.protocols).toEqual([{ name: 'CustomScheme', schemes: ['custom'] }]);
      },
    },
    {
      name: 'baseConfig: empty fileAssociations + protocols arrays NOT emitted',
      run: (ctx) => {
        const { baseConfig } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const out = baseConfig({});
        ctx.expect(out.fileAssociations).toBeUndefined();
        ctx.expect(out.protocols).toBeUndefined();
      },
    },
  ],
};
