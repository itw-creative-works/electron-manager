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
        // Win: nsis x64.
        ctx.expect(out.win.target[0].target).toBe('nsis');
        ctx.expect(out.win.target[0].arch).toEqual(['x64']);
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
  ],
};
