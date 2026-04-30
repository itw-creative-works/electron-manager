// Renderer test-harness entry. Runs inside the hidden BrowserWindow.
//
// Lifecycle:
//   1. window load → __emTest.ready()
//   2. main sends suites via __emTest:suites
//   3. renderer reconstructs each test fn via new Function('ctx', body), runs it sequentially
//   4. emits { event, ... } for each result; emits { event: 'end' } when done
//
// Tests get a `ctx` object with:
//   - expect: a tiny assert helper (chained, like the build/main layer)
//   - skip(reason): throws a SkipError
//   - state: per-suite shared object
//   - layer: 'renderer'
//
// Test source is sent as a stringified function body. We reconstruct the function inside
// the renderer with `new Function('ctx', body)`.

(function () {
  'use strict';

  const log = (...args) => {
    const el = document.getElementById('log');
    if (el) el.textContent += args.join(' ') + '\n';
  };

  function emit(evt) {
    try { window.__emTest.emit(evt); } catch (e) { /* harness gone */ }
  }

  // Tiny inline expect — mirrors src/test/assert.js minimal surface used by tests.
  function expect(actual) {
    return {
      toBe(expected) {
        if (actual !== expected) {
          throw new Error(`expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
        }
      },
      toEqual(expected) {
        const a = JSON.stringify(actual);
        const b = JSON.stringify(expected);
        if (a !== b) throw new Error(`expected ${a} to equal ${b}`);
      },
      toBeDefined() {
        if (actual === undefined) throw new Error(`expected value to be defined`);
      },
      toBeNull() {
        if (actual !== null) throw new Error(`expected ${JSON.stringify(actual)} to be null`);
      },
      toBeTruthy() {
        if (!actual) throw new Error(`expected ${JSON.stringify(actual)} to be truthy`);
      },
      toBeFalsy() {
        if (actual) throw new Error(`expected ${JSON.stringify(actual)} to be falsy`);
      },
      toContain(needle) {
        if (typeof actual === 'string') {
          if (!actual.includes(needle)) throw new Error(`expected "${actual}" to contain "${needle}"`);
        } else if (Array.isArray(actual)) {
          if (!actual.includes(needle)) throw new Error(`expected array to contain ${JSON.stringify(needle)}`);
        } else {
          throw new Error(`toContain only supports string/array, got ${typeof actual}`);
        }
      },
      toMatch(re) {
        if (!re.test(actual)) throw new Error(`expected "${actual}" to match ${re}`);
      },
    };
  }

  class SkipError extends Error {
    constructor(reason) { super(reason); this.name = 'SkipError'; }
  }

  function makeCtx(state) {
    return {
      expect,
      state,
      layer: 'renderer',
      skip(reason) { throw new SkipError(reason || 'skipped at runtime'); },
    };
  }

  async function runSuite(suite) {
    const description = suite.description || '(suite)';
    const isGroup     = suite.isGroup;
    const stopOnFailure = !isGroup;
    const tests       = suite.tests || [];

    emit({ event: 'suite-start', name: description });

    const state = {};
    let passed = 0, failed = 0, skipped = 0;

    for (let i = 0; i < tests.length; i += 1) {
      const t = tests[i];
      const name = t.name || `step-${i + 1}`;

      if (t.skip) {
        const reason = typeof t.skip === 'string' ? t.skip : 'skipped';
        emit({ event: 'skip', name: `${description} → ${name}`, reason });
        skipped += 1;
        continue;
      }

      let fn;
      try {
        // eslint-disable-next-line no-new-func
        fn = new Function('ctx', `return (async () => { ${t.runSource} })();`);
      } catch (e) {
        emit({ event: 'result', suite: description, name, passed: false, duration: 0, error: `Failed to compile: ${e.message}` });
        failed += 1;
        if (stopOnFailure) {
          const remaining = tests.length - i - 1;
          if (remaining > 0) emit({ event: 'suite-stopped', name: description, remaining });
          skipped += remaining;
          break;
        }
        continue;
      }

      const ctx = makeCtx(state);
      const start = Date.now();
      try {
        const timeout = t.timeout || suite.timeout || 30000;
        await Promise.race([
          fn(ctx),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), timeout)),
        ]);
        const duration = Date.now() - start;
        emit({ event: 'result', suite: description, name, passed: true, duration });
        passed += 1;
      } catch (e) {
        const duration = Date.now() - start;
        if (e.name === 'SkipError') {
          emit({ event: 'skip', name: `${description} → ${name}`, reason: e.message });
          skipped += 1;
          continue;
        }
        emit({ event: 'result', suite: description, name, passed: false, duration, error: e.message });
        failed += 1;
        if (stopOnFailure) {
          const remaining = tests.length - i - 1;
          if (remaining > 0) emit({ event: 'suite-stopped', name: description, remaining });
          skipped += remaining;
          break;
        }
      }
    }

    return { passed, failed, skipped };
  }

  async function runAll(suites) {
    log(`Running ${suites.length} renderer suite(s)...`);
    let passed = 0, failed = 0, skipped = 0;
    for (const suite of suites) {
      const r = await runSuite(suite);
      passed  += r.passed;
      failed  += r.failed;
      skipped += r.skipped;
    }
    emit({ event: 'end', passed, failed, skipped });
  }

  window.__emTest.onSuites((suites) => {
    runAll(suites).catch((e) => {
      emit({ event: 'fatal', message: e.message, stack: e.stack });
    });
  });

  // Signal ready as soon as the page is parsed.
  window.__emTest.ready();
})();
