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

  // Give the consumer's `manager.initialize().then(() => { ... })` callback time
  // to surface windows / wire up handlers / etc. The harness runs from setImmediate
  // already (which flushes microtasks once), but `windows.create()` is async, so
  // we additionally poll for the main window for up to 3s. Apps that intentionally
  // launch hidden never create a main window — those tests should `if (!win) return`
  // when inspecting window state.
  await waitForMainWindow(manager, 3000);

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

  // Reconstitute each `inspect` from its serialized body string. We expose Node's
  // `require` + `process` + `Buffer` to the inspect body so tests can require('fs'),
  // require('electron'), etc. — `new Function(...)` creates a no-closure function so
  // these globals must be passed in explicitly. (Module-level `require` is the harness's
  // own; renaming it `require` inside the body restores the natural ergonomic.)
  const inspectors = tests.map((t) => ({
    description:  t.description,
    timeout:      t.timeout || 15000,
    inspect:      new Function('args', 'require', 'process', 'Buffer',
      `return (async function ({ manager, expect, projectRoot }) {\n${t.inspectSource}\n})(args)`,
    ),
  }));

  // Bring in EM's expect (assert.js) — same path conventions as main-entry.js uses.
  const expect = require(path.join(spec.emDistRoot, 'test', 'assert.js'));

  let passed = 0, failed = 0, skipped = 0;

  for (const t of inspectors) {
    const start = Date.now();
    try {
      await Promise.race([
        t.inspect({ manager, expect, projectRoot }, require, process, Buffer),
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

// Poll for the main window for up to `timeoutMs`. Resolves when it shows up, or after
// the timeout (no error — agent/hidden apps never create one and that's fine).
async function waitForMainWindow(manager, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (manager?.windows?.get?.('main')) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

module.exports = { run };
