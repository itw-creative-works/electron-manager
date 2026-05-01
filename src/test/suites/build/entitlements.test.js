// Build-layer tests for lib/sign-helpers/entitlements.js — defaults merge + plist render.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'entitlements — mac plist generation',
  tests: [
    {
      name: 'module exposes DEFAULT_MAC_ENTITLEMENTS + helpers',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'entitlements.js'));
        ctx.expect(typeof mod.DEFAULT_MAC_ENTITLEMENTS).toBe('object');
        ctx.expect(typeof mod.mergeMacEntitlements).toBe('function');
        ctx.expect(typeof mod.renderPlist).toBe('function');
        ctx.expect(typeof mod.writeMacEntitlements).toBe('function');
      },
    },
    {
      name: 'defaults include the canonical hardened-runtime keys',
      run: (ctx) => {
        const { DEFAULT_MAC_ENTITLEMENTS } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'entitlements.js'));
        ctx.expect(DEFAULT_MAC_ENTITLEMENTS['com.apple.security.cs.allow-jit']).toBe(true);
        ctx.expect(DEFAULT_MAC_ENTITLEMENTS['com.apple.security.cs.disable-library-validation']).toBe(true);
        ctx.expect(DEFAULT_MAC_ENTITLEMENTS['com.apple.security.network.client']).toBe(true);
      },
    },
    {
      name: 'mergeMacEntitlements: empty/missing overrides → defaults verbatim',
      run: (ctx) => {
        const { mergeMacEntitlements, DEFAULT_MAC_ENTITLEMENTS } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'entitlements.js'));
        ctx.expect(mergeMacEntitlements()).toEqual(DEFAULT_MAC_ENTITLEMENTS);
        ctx.expect(mergeMacEntitlements({})).toEqual(DEFAULT_MAC_ENTITLEMENTS);
        ctx.expect(mergeMacEntitlements(null)).toEqual(DEFAULT_MAC_ENTITLEMENTS);
      },
    },
    {
      name: 'mergeMacEntitlements: consumer override wins over default',
      run: (ctx) => {
        const { mergeMacEntitlements } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'entitlements.js'));
        const merged = mergeMacEntitlements({
          'com.apple.security.cs.allow-jit': false,
        });
        ctx.expect(merged['com.apple.security.cs.allow-jit']).toBe(false);
        ctx.expect(merged['com.apple.security.network.client']).toBe(true);   // default preserved
      },
    },
    {
      name: 'mergeMacEntitlements: new key (not in defaults) added',
      run: (ctx) => {
        const { mergeMacEntitlements } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'entitlements.js'));
        const merged = mergeMacEntitlements({
          'com.apple.security.device.camera': true,
        });
        ctx.expect(merged['com.apple.security.device.camera']).toBe(true);
      },
    },
    {
      name: 'mergeMacEntitlements: null/undefined value removes a default',
      run: (ctx) => {
        const { mergeMacEntitlements } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'entitlements.js'));
        const merged = mergeMacEntitlements({
          'com.apple.security.network.server': null,
        });
        ctx.expect('com.apple.security.network.server' in merged).toBe(false);
      },
    },
    {
      name: 'renderPlist: outputs valid XML with declared DOCTYPE + dict',
      run: (ctx) => {
        const { renderPlist } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'entitlements.js'));
        const xml = renderPlist({
          'com.apple.security.cs.allow-jit': true,
          'com.apple.security.network.server': false,
        });
        ctx.expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        ctx.expect(xml).toContain('<!DOCTYPE plist');
        ctx.expect(xml).toContain('<plist version="1.0">');
        ctx.expect(xml).toContain('<key>com.apple.security.cs.allow-jit</key>');
        ctx.expect(xml).toContain('<true/>');
        ctx.expect(xml).toContain('<key>com.apple.security.network.server</key>');
        ctx.expect(xml).toContain('<false/>');
        ctx.expect(xml).toMatch(/<\/plist>\s*$/);
      },
    },
    {
      name: 'writeMacEntitlements: writes to dist/build/entitlements.mac.plist',
      run: (ctx) => {
        const { writeMacEntitlements } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'entitlements.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-entitlements-'));
        try {
          const written = writeMacEntitlements(tmp, { 'com.apple.security.cs.allow-jit': false });
          ctx.expect(written).toBe(path.join(tmp, 'build', 'entitlements.mac.plist'));
          const xml = fs.readFileSync(written, 'utf8');
          ctx.expect(xml).toContain('<key>com.apple.security.cs.allow-jit</key>');
          ctx.expect(xml).toContain('<false/>');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
