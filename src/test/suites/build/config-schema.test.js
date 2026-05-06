// Validates the framework default config (src/defaults/config/electron-manager.json) parses
// as JSON5 and has all the keys the framework code reads.
//
// This is a SUITE (sequential, shared state) — the parsed config is loaded once by the first
// test and reused via state by the rest.

const path = require('path');
const fs = require('fs');
const JSON5 = require('json5');

const Manager = require('../../../build.js');
const root = Manager.getRootPath('main');
const defaultConfigPath = path.join(root, 'dist', 'defaults', 'config', 'electron-manager.json');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'Default config schema',
  tests: [
    {
      name: 'default config file exists',
      run: (ctx) => {
        ctx.expect(fs.existsSync(defaultConfigPath)).toBeTruthy();
        ctx.state.raw = fs.readFileSync(defaultConfigPath, 'utf8');
      },
    },
    {
      name: 'parses as JSON5',
      run: (ctx) => {
        ctx.state.cfg = JSON5.parse(ctx.state.raw);
        ctx.expect(ctx.state.cfg).toBeTruthy();
      },
    },
    {
      name: 'is JSON5 syntax (rejects strict JSON parse)',
      run: (ctx) => {
        let strictFailed = false;
        try { JSON.parse(ctx.state.raw); } catch (e) { strictFailed = true; }
        ctx.expect(strictFailed).toBeTruthy();
      },
    },
    {
      name: 'has brand block with id + name',
      run: (ctx) => {
        ctx.expect(ctx.state.cfg.brand).toBeTruthy();
        ctx.expect(ctx.state.cfg.brand.id).toBeTruthy();
        ctx.expect(ctx.state.cfg.brand.name).toBeTruthy();
      },
    },
    {
      name: 'has app block (appId + productName may be null — derived from brand)',
      run: (ctx) => {
        // appId and productName are derived from brand.id / brand.name at config-load
        // time (Manager.getConfig). The raw scaffold leaves them null on purpose so the
        // user only sets brand.{id,name} once. The `app` block itself must exist for
        // copyright + any future explicit overrides.
        ctx.expect(ctx.state.cfg.app).toBeTruthy();
        ctx.expect('appId' in ctx.state.cfg.app).toBe(true);
        ctx.expect('productName' in ctx.state.cfg.app).toBe(true);
      },
    },
    {
      name: 'has autoUpdate block',
      run: (ctx) => {
        ctx.expect(ctx.state.cfg.autoUpdate).toBeTruthy();
        ctx.expect(typeof ctx.state.cfg.autoUpdate.enabled).toBe('boolean');
      },
    },
    {
      name: 'tray / menu / context-menu have NO config block (paths are conventional)',
      run: (ctx) => {
        // Tray, menu, and context-menu use fixed conventional paths
        // (src/integrations/{tray,menu,context-menu}/index.js). Disabling is a runtime
        // call (manager.tray.disable() etc.), not a config flag. Config carries no entry
        // for these in v1 — guard against re-introducing one accidentally.
        ctx.expect(ctx.state.cfg.tray).toBeUndefined();
        ctx.expect(ctx.state.cfg.menu).toBeUndefined();
        ctx.expect(ctx.state.cfg.contextMenu).toBeUndefined();
      },
    },
    {
      name: 'has NO `windows` block — windows are created from main.js (lazy)',
      run: (ctx) => {
        // EM no longer auto-creates windows. The `windows` config block is optional —
        // consumer adds it only when overriding defaults persistently. Default config
        // ships without one.
        ctx.expect(ctx.state.cfg.windows).toBeFalsy();
      },
    },
    {
      name: 'has targets.win.signing block (Windows-specific signing config)',
      run: (ctx) => {
        ctx.expect(ctx.state.cfg.targets).toBeTruthy();
        ctx.expect(ctx.state.cfg.targets.win).toBeTruthy();
        ctx.expect(ctx.state.cfg.targets.win.signing).toBeTruthy();
        ctx.expect(['self-hosted', 'cloud', 'local']).toContain(ctx.state.cfg.targets.win.signing.strategy);
      },
    },
    {
      name: 'has NO deepLinks config block (scheme = brand.id, routes are runtime)',
      run: (ctx) => {
        // deep-link scheme is auto-derived from brand.id; routes register at runtime via
        // manager.deepLink.on(). Guard against re-introducing a config block.
        ctx.expect(ctx.state.cfg.deepLinks).toBeUndefined();
      },
    },
  ],
};
