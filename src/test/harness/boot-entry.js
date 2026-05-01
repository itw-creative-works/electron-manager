// Boot harness — invoked from EM's main.js after manager.initialize() resolves
// when EM_TEST_BOOT=1. Reads the spec file pointed to by EM_TEST_BOOT_SPEC,
// runs each `inspect` against the live manager, emits results, and quits.
//
// Why call from main.js instead of preloading via electron's --require?
// Because Electron rejects unknown CLI flags, we can't sneak args/preload modules in.
// So EM's main.js opts into the harness when it sees EM_TEST_BOOT=1, after a
// fully-completed initialize() guarantees every lib is up.
//
// Protocol matches main-entry.js — emit `__EM_TEST__` JSON lines on stdout.

'use strict';

function emit(obj) {
  process.stdout.write(`__EM_TEST__${JSON.stringify(obj)}\n`);
}

async function run(manager) {
  const { app } = require('electron');
  const path = require('path');

  const specPath = process.env.EM_TEST_BOOT_SPEC;
  if (!specPath) {
    emit({ event: 'fatal', message: 'boot-entry.js: EM_TEST_BOOT_SPEC env var not set' });
    app.exit(1);
    return;
  }

  let spec;
  try {
    spec = require(specPath);
  } catch (e) {
    emit({ event: 'fatal', message: `boot-entry.js: failed to load spec ${specPath}: ${e.message}` });
    app.exit(1);
    return;
  }

  const projectRoot = spec.projectRoot;
  const tests       = spec.tests || [];

  // Reconstitute each `inspect` from its serialized body string.
  const inspectors = tests.map((t) => ({
    description:  t.description,
    timeout:      t.timeout || 15000,
    inspect:      new Function('args', `return (async function ({ manager, expect, projectRoot }) {\n${t.inspectSource}\n})(args)`),
  }));

  // Bring in EM's expect (assert.js) — same path conventions as main-entry.js uses.
  const expect = require(path.join(spec.emDistRoot, 'test', 'assert.js'));

  let passed = 0, failed = 0, skipped = 0;

  for (const t of inspectors) {
    const start = Date.now();
    try {
      await Promise.race([
        t.inspect({ manager, expect, projectRoot }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Boot test timeout')), t.timeout)),
      ]);
      const duration = Date.now() - start;
      emit({ event: 'result', name: t.description, passed: true, duration });
      passed += 1;
    } catch (e) {
      const duration = Date.now() - start;
      emit({ event: 'result', name: t.description, passed: false, duration, error: e.message });
      failed += 1;
    }
  }

  emit({ event: 'end', passed, failed, skipped });
  app.exit(failed > 0 ? 1 : 0);
}

module.exports = { run };
