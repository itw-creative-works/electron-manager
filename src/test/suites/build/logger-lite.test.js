// Build-layer tests for lib/logger-lite.js — runtime logger surface + serialization.
//
// Note: full file-transport behavior requires a real Electron `app` module, which
// only exists in main-process tests. Those live in the main-layer suite. Here we
// pin the module shape, the renderer-side serialization, and the `outside-Electron`
// fallback (console-only) — all the parts that DON'T need a running Electron.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const MOD_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'logger-lite.js');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'logger-lite — runtime logger module shape + serialization',
  tests: [
    {
      name: 'module exports a constructor with log/info/warn/error/debug methods',
      run: (ctx) => {
        // Clear cache so we get a fresh module instance.
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        ctx.expect(typeof Logger).toBe('function');
        const inst = new Logger('test');
        ctx.expect(typeof inst.log).toBe('function');
        ctx.expect(typeof inst.info).toBe('function');
        ctx.expect(typeof inst.warn).toBe('function');
        ctx.expect(typeof inst.error).toBe('function');
        ctx.expect(typeof inst.debug).toBe('function');
      },
    },
    {
      name: 'getLogFilePath() exposed as static helper',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        ctx.expect(typeof Logger.getLogFilePath).toBe('function');
      },
    },
    {
      name: 'FORWARD_CHANNEL exposed as the canonical IPC channel name',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        ctx.expect(Logger.FORWARD_CHANNEL).toBe('em:log:forward');
      },
    },
    {
      name: 'log() always writes to console, never throws',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        const inst = new Logger('test-console');
        const origLog = console.log;
        let captured = null;
        console.log = function () { captured = Array.from(arguments); };
        try {
          inst.log('hello', 'world');
        } finally {
          console.log = origLog;
        }
        ctx.expect(captured).toBeDefined();
        ctx.expect(captured[0]).toMatch(/test-console/);
      },
    },
    {
      name: '_internals exposes isElectron + isMain booleans',
      run: (ctx) => {
        // In the test runner the test layer DOES run inside an Electron child for main-layer
        // tests, so isElectron may be true here. We just check the values are booleans —
        // their exact value depends on whether this happens to run in an Electron context.
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        ctx.expect(typeof Logger._internals.isElectron).toBe('boolean');
        ctx.expect(typeof Logger._internals.isMain).toBe('boolean');
      },
    },
    {
      name: 'serializeArgs: Error → { __error, name, message, stack }',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        const err = new Error('boom');
        const out = Logger._internals.serializeArgs([err]);
        ctx.expect(out[0].__error).toBe(true);
        ctx.expect(out[0].name).toBe('Error');
        ctx.expect(out[0].message).toBe('boom');
        ctx.expect(typeof out[0].stack).toBe('string');
      },
    },
    {
      name: 'serializeArgs: undefined → { __undefined: true }',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        const out = Logger._internals.serializeArgs([undefined]);
        ctx.expect(out[0].__undefined).toBe(true);
      },
    },
    {
      name: 'serializeArgs: function → "[Function: name]" string',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        function namedFn() {}
        const out = Logger._internals.serializeArgs([namedFn]);
        ctx.expect(out[0]).toBe('[Function: namedFn]');
      },
    },
    {
      name: 'serializeArgs: plain objects round-trip via JSON',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        const out = Logger._internals.serializeArgs([{ a: 1, b: 'x', nested: { c: true } }]);
        ctx.expect(out[0]).toEqual({ a: 1, b: 'x', nested: { c: true } });
      },
    },
    {
      name: 'serializeArgs: circular ref → falls back to String(arg)',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        const obj = { name: 'circ' };
        obj.self = obj;
        const out = Logger._internals.serializeArgs([obj]);
        // Either falls back to String() or returns "[object Object]" — either is acceptable
        // as long as it doesn't throw.
        ctx.expect(typeof out[0]).toBe('string');
      },
    },
    {
      name: 'tryForwardToMain returns false when no IPC available',
      run: (ctx) => {
        delete require.cache[require.resolve(MOD_PATH)];
        const Logger = require(MOD_PATH);
        // No window.em, no electron → returns false.
        const result = Logger._internals.tryForwardToMain('test', 'info', ['hi']);
        ctx.expect(result).toBe(false);
      },
    },
  ],
};
