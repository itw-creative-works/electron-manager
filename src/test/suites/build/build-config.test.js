// Build-layer tests for gulp/tasks/build-config.js — verify that the YAML injection
// is correct, idempotent, and preserves other content.

const path = require('path');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'build-config — electron-builder.yml injection',
  tests: [
    {
      name: 'task module exports a function plus injectMacExtendInfo',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        ctx.expect(typeof mod).toBe('function');
        ctx.expect(typeof mod.injectMacExtendInfo).toBe('function');
      },
    },
    {
      name: 'injects LSUIElement under mac.extendInfo when extendInfo absent',
      run: (ctx) => {
        const { injectMacExtendInfo } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = [
          'appId: com.test',
          'mac:',
          '  category: public.app-category.utilities',
          '  hardenedRuntime: true',
          'win:',
          '  target: nsis',
          '',
        ].join('\n');

        const out = injectMacExtendInfo(input, { LSUIElement: true });
        ctx.expect(out).toContain('extendInfo:');
        ctx.expect(out).toContain('LSUIElement: true');
        // Original keys must still be there.
        ctx.expect(out).toContain('category: public.app-category.utilities');
        ctx.expect(out).toContain('hardenedRuntime: true');
        ctx.expect(out).toContain('win:');
      },
    },
    {
      name: 'merges into an existing mac.extendInfo block',
      run: (ctx) => {
        const { injectMacExtendInfo } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = [
          'mac:',
          '  category: x',
          '  extendInfo:',
          '    NSCameraUsageDescription: "We need the camera"',
          '',
        ].join('\n');

        const out = injectMacExtendInfo(input, { LSUIElement: true });
        ctx.expect(out).toContain('NSCameraUsageDescription:');
        ctx.expect(out).toContain('LSUIElement: true');
      },
    },
    {
      name: 'updates an existing key rather than duplicating it',
      run: (ctx) => {
        const { injectMacExtendInfo } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = [
          'mac:',
          '  extendInfo:',
          '    LSUIElement: false',
          '',
        ].join('\n');

        const out = injectMacExtendInfo(input, { LSUIElement: true });
        const matches = out.match(/LSUIElement:/g) || [];
        ctx.expect(matches.length).toBe(1);
        ctx.expect(out).toContain('LSUIElement: true');
        ctx.expect(out).not.toContain('LSUIElement: false');
      },
    },
    {
      name: 'idempotent: applying the same injection twice yields the same output',
      run: (ctx) => {
        const { injectMacExtendInfo } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = [
          'mac:',
          '  category: x',
          '',
        ].join('\n');

        const once  = injectMacExtendInfo(input, { LSUIElement: true });
        const twice = injectMacExtendInfo(once,  { LSUIElement: true });
        ctx.expect(twice).toBe(once);
      },
    },
    {
      name: 'injectPublish replaces existing publish block in place',
      run: (ctx) => {
        const { injectPublish } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = [
          'appId: com.test',
          '',
          'publish:',
          '  provider: github',
          '  releaseType: release',
          '',
        ].join('\n');
        const out = injectPublish(input, { provider: 'github', owner: 'foo', repo: 'update-server' });
        ctx.expect(out).toContain('owner: foo');
        ctx.expect(out).toContain('repo: update-server');
        // releaseType defaults to 'release' (not draft)
        ctx.expect(out).toContain('releaseType: release');
        // Adjacent content preserved
        ctx.expect(out).toContain('appId: com.test');
        // Single publish block, not duplicated
        ctx.expect((out.match(/^publish:/gm) || []).length).toBe(1);
      },
    },
    {
      name: 'injectPublish appends when no existing block',
      run: (ctx) => {
        const { injectPublish } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = 'appId: com.test\n';
        const out = injectPublish(input, { provider: 'github', owner: 'foo', repo: 'bar' });
        ctx.expect(out).toContain('publish:');
        ctx.expect(out).toContain('owner: foo');
        ctx.expect(out).toContain('repo: bar');
      },
    },
    {
      name: 'injectAfterSign replaces existing afterSign line',
      run: (ctx) => {
        const { injectAfterSign } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = [
          'appId: com.test',
          'afterSign: hooks/notarize.js',
          'asar: true',
          '',
        ].join('\n');
        const out = injectAfterSign(input, '/abs/path/to/notarize.js');
        ctx.expect(out).toContain('afterSign: "/abs/path/to/notarize.js"');
        ctx.expect(out).not.toContain('hooks/notarize.js');
        ctx.expect(out).toContain('asar: true');
        ctx.expect((out.match(/^afterSign:/gm) || []).length).toBe(1);
      },
    },
    {
      name: 'injectAfterSign appends when no existing line',
      run: (ctx) => {
        const { injectAfterSign } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = 'appId: com.test\n';
        const out = injectAfterSign(input, '/abs/notarize.js');
        ctx.expect(out).toContain('afterSign: "/abs/notarize.js"');
      },
    },
    {
      name: 'appends a complete mac block when none exists',
      run: (ctx) => {
        const { injectMacExtendInfo } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        const input = [
          'appId: com.test',
          'win:',
          '  target: nsis',
          '',
        ].join('\n');

        const out = injectMacExtendInfo(input, { LSUIElement: true });
        ctx.expect(out).toContain('mac:');
        ctx.expect(out).toContain('extendInfo:');
        ctx.expect(out).toContain('LSUIElement: true');
        // Original lines are preserved.
        ctx.expect(out).toContain('appId: com.test');
        ctx.expect(out).toContain('win:');
      },
    },
  ],
};
