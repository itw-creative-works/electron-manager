// Build-layer tests for utils/validate-config.js — schema-driven config validator.

const Manager = require('../../../build.js');
const root = Manager.getRootPath('main');
const path = require('path');
const { validateConfig } = require(path.join(root, 'dist', 'utils', 'validate-config.js'));

// Minimal "good" config — passes every required check.
const VALID = {
  brand: { id: 'myapp', name: 'MyApp' },
};

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'utils/validate-config',
  tests: [
    {
      name: 'required:true field present + valid → no error',
      run: (ctx) => {
        const schema = [
          { path: 'brand.id', type: 'string', required: true, match: /^[a-z]/ },
        ];
        const { errors } = validateConfig(VALID, schema);
        ctx.expect(errors).toEqual([]);
      },
    },
    {
      name: 'required:true field missing → error',
      run: (ctx) => {
        const schema = [
          { path: 'brand.id', type: 'string', required: true },
        ];
        const { errors } = validateConfig({}, schema);
        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0]).toContain('brand.id is required');
      },
    },
    {
      name: 'required:false field missing → no error',
      run: (ctx) => {
        const schema = [
          { path: 'brand.id', type: 'string', required: false },
        ];
        const { errors } = validateConfig({}, schema);
        ctx.expect(errors).toEqual([]);
      },
    },
    {
      name: 'required:function returning true → enforce',
      run: (ctx) => {
        const schema = [
          { path: 'analytics.providers.google.id', required: (c) => c?.analytics?.enabled !== false },
        ];
        const cfg = { analytics: { enabled: true } };
        const { errors } = validateConfig(cfg, schema);
        ctx.expect(errors.length).toBe(1);
      },
    },
    {
      name: 'required:function returning false → skip',
      run: (ctx) => {
        const schema = [
          { path: 'analytics.providers.google.id', required: (c) => c?.analytics?.enabled !== false },
        ];
        const cfg = { analytics: { enabled: false } };
        const { errors } = validateConfig(cfg, schema);
        ctx.expect(errors).toEqual([]);
      },
    },
    {
      name: 'match regex fails on present invalid string',
      run: (ctx) => {
        const schema = [
          { path: 'brand.id', type: 'string', required: false, match: /^[a-z]+$/ },
        ];
        const { errors } = validateConfig({ brand: { id: 'MY-APP' } }, schema);
        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0]).toContain('does not match');
      },
    },
    {
      name: 'match regex passes on present valid string',
      run: (ctx) => {
        const schema = [
          { path: 'brand.id', type: 'string', required: false, match: /^[a-z]+$/ },
        ];
        const { errors } = validateConfig({ brand: { id: 'myapp' } }, schema);
        ctx.expect(errors).toEqual([]);
      },
    },
    {
      name: 'match regex does NOT fire when value is absent',
      run: (ctx) => {
        const schema = [
          { path: 'brand.id', type: 'string', required: false, match: /^[a-z]+$/ },
        ];
        const { errors } = validateConfig({}, schema);
        ctx.expect(errors).toEqual([]);
      },
    },
    {
      name: 'enum rejects out-of-list value',
      run: (ctx) => {
        const schema = [
          { path: 'startup.mode', required: false, enum: ['normal', 'hidden'] },
        ];
        const { errors } = validateConfig({ startup: { mode: 'tray-only' } }, schema);
        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0]).toContain('not allowed');
      },
    },
    {
      name: 'type:string rejects boolean',
      run: (ctx) => {
        const schema = [
          { path: 'brand.id', type: 'string', required: false },
        ];
        const { errors } = validateConfig({ brand: { id: true } }, schema);
        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0]).toContain('wrong type');
      },
    },
    {
      name: 'type:boolean accepts boolean',
      run: (ctx) => {
        const schema = [
          { path: 'analytics.enabled', type: 'boolean', required: false },
        ];
        const { errors } = validateConfig({ analytics: { enabled: false } }, schema);
        ctx.expect(errors).toEqual([]);
      },
    },
    {
      name: 'EM default config passes schema validation',
      run: (ctx) => {
        const fs = require('fs');
        const JSON5 = require('json5');
        const defaultsPath = path.join(root, 'dist', 'defaults', 'config', 'electron-manager.json');
        const cfg = JSON5.parse(fs.readFileSync(defaultsPath, 'utf8'));
        const schema = require(path.join(root, 'dist', 'config', 'schema.js'));
        const { errors } = validateConfig(cfg, schema);
        // The defaults file uses 'myapp' / 'MyApp' as placeholders so brand.id + brand.name pass.
        // Anything that fails here means our defaults are incompatible with our own schema.
        ctx.expect(errors).toEqual([]);
      },
    },
  ],
};
