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
      name: 'has app block with appId + productName',
      run: (ctx) => {
        ctx.expect(ctx.state.cfg.app).toBeTruthy();
        ctx.expect(ctx.state.cfg.app.appId).toBeTruthy();
        ctx.expect(ctx.state.cfg.app.productName).toBeTruthy();
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
      name: 'tray / menu / context-menu point to JS definition files',
      run: (ctx) => {
        // Tray, menu, and context-menu are defined in JS files for full power.
        // Config only carries the enable knob and the path to the definition.
        ctx.expect(ctx.state.cfg.tray).toBeTruthy();
        ctx.expect(typeof ctx.state.cfg.tray.enabled).toBe('boolean');
        ctx.expect(typeof ctx.state.cfg.tray.definition).toBe('string');
        ctx.expect(ctx.state.cfg.tray.items).toBeUndefined();

        ctx.expect(typeof ctx.state.cfg.menu.enabled).toBe('boolean');
        ctx.expect(typeof ctx.state.cfg.menu.definition).toBe('string');

        ctx.expect(typeof ctx.state.cfg.contextMenu.enabled).toBe('boolean');
        ctx.expect(typeof ctx.state.cfg.contextMenu.definition).toBe('string');
      },
    },
    {
      name: 'has named-window registry under windows',
      run: (ctx) => {
        ctx.expect(ctx.state.cfg.windows).toBeTruthy();
        ctx.expect(ctx.state.cfg.windows.main).toBeTruthy();
        ctx.expect(ctx.state.cfg.windows.main.view).toBe('main');
      },
    },
    {
      name: 'has signing.windows block (not windows.signing)',
      run: (ctx) => {
        ctx.expect(ctx.state.cfg.signing).toBeTruthy();
        ctx.expect(ctx.state.cfg.signing.windows).toBeTruthy();
        ctx.expect(['self-hosted', 'cloud', 'local']).toContain(ctx.state.cfg.signing.windows.strategy);
      },
    },
    {
      name: 'has deepLinks.schemes array',
      run: (ctx) => {
        ctx.expect(ctx.state.cfg.deepLinks).toBeTruthy();
        ctx.expect(Array.isArray(ctx.state.cfg.deepLinks.schemes)).toBeTruthy();
      },
    },
    {
      name: 'has em block with liveReloadPort',
      run: (ctx) => {
        ctx.expect(ctx.state.cfg.em).toBeTruthy();
        ctx.expect(typeof ctx.state.cfg.em.liveReloadPort).toBe('number');
      },
    },
  ],
};
