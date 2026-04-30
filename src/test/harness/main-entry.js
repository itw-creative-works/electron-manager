// Main-process test harness — runs inside a spawned Electron main process.
//
// Started by ../runners/electron.js with:
//   electron <em>/dist/test/harness/main-entry.js -- --suites <json>
//
// Reports results to the parent runner via stdout JSON-lines:
//   { event: 'start',   name, total }
//   { event: 'result',  name, passed, duration, error? }
//   { event: 'skip',    name, reason }
//   { event: 'end',     passed, failed, skipped }
//
// The parent runner reads stdout, renders the BEM-style output, and the harness
// exits 0 on success / 1 on any failure.

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

// Suites to run come in via process.argv after `--`
const argv = process.argv.slice(2);
const sepIdx = argv.indexOf('--');
const positional = sepIdx >= 0 ? argv.slice(sepIdx + 1) : argv;

let suiteFiles = [];
const suiteFlagIdx = positional.indexOf('--suites');
if (suiteFlagIdx >= 0 && positional[suiteFlagIdx + 1]) {
  try {
    suiteFiles = JSON.parse(positional[suiteFlagIdx + 1]);
  } catch (e) {
    emit({ event: 'fatal', message: `Failed to parse --suites: ${e.message}` });
    app.exit(1);
  }
}

// Optional renderer suites — run in a hidden BrowserWindow after main suites finish.
let rendererSuiteFiles = [];
const rendererFlagIdx = positional.indexOf('--renderer-suites');
if (rendererFlagIdx >= 0 && positional[rendererFlagIdx + 1]) {
  try {
    rendererSuiteFiles = JSON.parse(positional[rendererFlagIdx + 1]);
  } catch (e) {
    emit({ event: 'fatal', message: `Failed to parse --renderer-suites: ${e.message}` });
    app.exit(1);
  }
}

const filter = (() => {
  const idx = positional.indexOf('--filter');
  return idx >= 0 ? positional[idx + 1] : null;
})();

function emit(obj) {
  process.stdout.write(`__EM_TEST__${JSON.stringify(obj)}\n`);
}

class SkipError extends Error {
  constructor(reason) { super(reason); this.name = 'SkipError'; }
}

async function runSuites() {
  const Manager = require('../../main.js');
  const manager = new Manager();

  // Test mode: load default config from EM defaults (since the harness CWD won't have one),
  // and skip window creation so we don't pop a UI during tests.
  const fs = require('fs');
  const JSON5 = require('json5');
  const defaultConfigPath = path.join(__dirname, '..', '..', 'defaults', 'config', 'electron-manager.json');
  const defaultConfig = JSON5.parse(fs.readFileSync(defaultConfigPath, 'utf8'));

  await manager.initialize(defaultConfig, { skipWindowCreation: true });

  const ctxBase = (state) => ({
    expect: require('../assert.js'),
    state,
    layer: 'main',
    manager,
    skip(reason) { throw new SkipError(reason); },
  });

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const file of suiteFiles) {
    let mod;
    try {
      delete require.cache[require.resolve(file)];
      mod = require(file);
    } catch (e) {
      emit({ event: 'result', name: file, passed: false, duration: 0, error: `Failed to load: ${e.message}` });
      failed += 1;
      continue;
    }

    if (Array.isArray(mod)) {
      mod = { type: 'group', tests: mod };
    }

    if (mod.layer !== 'main') continue;

    if (mod.skip) {
      const reason = typeof mod.skip === 'string' ? mod.skip : 'skipped';
      const count = Array.isArray(mod.tests) ? mod.tests.length : 1;
      emit({ event: 'skip', name: mod.description || file, reason, count });
      skipped += count;
      continue;
    }

    if (mod.type === 'suite' || mod.type === 'group' || Array.isArray(mod.tests)) {
      const result = await runSuite(mod, ctxBase, filter);
      passed += result.passed;
      failed += result.failed;
      skipped += result.skipped;
    } else {
      const result = await runStandalone(mod, ctxBase, filter);
      passed += result.passed;
      failed += result.failed;
      skipped += result.skipped;
    }
  }

  // After main suites finish, optionally run renderer suites in a hidden BrowserWindow.
  if (rendererSuiteFiles.length > 0) {
    try {
      const r = await runRendererSuites(rendererSuiteFiles);
      passed  += r.passed;
      failed  += r.failed;
      skipped += r.skipped;
    } catch (e) {
      emit({ event: 'fatal', message: `renderer harness: ${e.message}`, stack: e.stack });
      failed += 1;
    }
  }

  emit({ event: 'end', passed, failed, skipped });
  app.exit(failed > 0 ? 1 : 0);
}

// Spawn a hidden BrowserWindow and run each renderer suite inside it. Each suite file is
// loaded via require() in main, then its tests are serialized to { name, runSource } and
// shipped over IPC for the renderer to reconstruct + execute.
async function runRendererSuites(files) {
  // Serialize suites for transport. We can't ship functions directly via IPC, so we extract
  // the function body of each test's `run` and ship that as a string. The renderer rebuilds
  // it with `new Function('ctx', body)`.
  const suites = [];
  for (const file of files) {
    let mod;
    try {
      delete require.cache[require.resolve(file)];
      mod = require(file);
    } catch (e) {
      emit({ event: 'result', name: file, passed: false, duration: 0, error: `Failed to load: ${e.message}` });
      continue;
    }

    if (Array.isArray(mod)) mod = { type: 'group', tests: mod };
    if (mod.layer !== 'renderer') continue;
    if (mod.skip) {
      const reason = typeof mod.skip === 'string' ? mod.skip : 'skipped';
      const count = Array.isArray(mod.tests) ? mod.tests.length : 1;
      emit({ event: 'skip', name: mod.description || file, reason, count });
      continue;
    }

    const tests = (mod.tests || []).map((t) => ({
      name:    t.name,
      skip:    t.skip,
      timeout: t.timeout,
      runSource: extractFnBody(t.run),
    }));

    suites.push({
      description: mod.description || path.basename(file),
      isGroup:     mod.type === 'group',
      timeout:     mod.timeout,
      tests,
    });
  }

  if (suites.length === 0) {
    return { passed: 0, failed: 0, skipped: 0 };
  }

  const harnessDir = __dirname;
  const win = new BrowserWindow({
    show:           false,
    width:          800,
    height:         600,
    webPreferences: {
      preload:           path.join(harnessDir, 'renderer-preload.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      sandbox:           false,
    },
  });

  return new Promise((resolve, reject) => {
    let counts = { passed: 0, failed: 0, skipped: 0 };
    let resolved = false;
    const finish = (val, err) => {
      if (resolved) return;
      resolved = true;
      try { win.destroy(); } catch (_e) { /* noop */ }
      ipcMain.removeAllListeners('__emTest:ready');
      ipcMain.removeAllListeners('__emTest:result');
      if (err) reject(err); else resolve(val);
    };

    ipcMain.on('__emTest:ready', () => {
      win.webContents.send('__emTest:suites', suites);
    });

    ipcMain.on('__emTest:result', (_e, evt) => {
      // Forward verbatim to stdout — same envelope as main-process events.
      emit(evt);
      if (evt.event === 'result') {
        if (evt.passed) counts.passed += 1;
        else            counts.failed += 1;
      } else if (evt.event === 'skip') {
        counts.skipped += (evt.count || 1);
      } else if (evt.event === 'end') {
        finish(counts);
      } else if (evt.event === 'fatal') {
        counts.failed += 1;
        finish(counts);
      }
    });

    win.webContents.once('did-fail-load', (_e, code, desc) => {
      finish(null, new Error(`renderer load failed: ${desc} (${code})`));
    });

    win.loadFile(path.join(harnessDir, 'renderer.html')).catch((e) => finish(null, e));

    // Belt-and-suspenders: hard timeout in case the renderer never emits 'end'.
    setTimeout(() => finish(null, new Error('renderer harness timed out (no end event in 60s)')), 60000);
  });
}

// Extract the body of a function as a string so it can be reconstructed in the renderer.
// Preserves async semantics (the renderer wraps in `async () => { ... }`).
function extractFnBody(fn) {
  if (typeof fn !== 'function') return 'throw new Error("test has no run() function");';
  const src = fn.toString();
  // Match: `async (ctx) => { ... }` / `(ctx) => { ... }` / `function(ctx) { ... }` / `async function (ctx) { ... }`
  const arrow = src.match(/^\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*$/) || src.match(/^\s*\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*$/);
  if (arrow) return arrow[1];
  const named = src.match(/^\s*async\s+function\s*[a-zA-Z0-9_]*\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/) || src.match(/^\s*function\s*[a-zA-Z0-9_]*\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (named) return named[1];
  // Single-expression arrow: `(ctx) => ctx.expect(...).toBe(...)`
  const exprArrow = src.match(/^\s*async\s*\([^)]*\)\s*=>\s*([\s\S]+)$/) || src.match(/^\s*\([^)]*\)\s*=>\s*([\s\S]+)$/);
  if (exprArrow) return `return ${exprArrow[1].trim()};`;
  // Fallback: just inject the source as-is and hope for the best.
  return `return (${src})(ctx);`;
}

async function runSuite(suite, ctxBase, filter) {
  const description = suite.description || '(suite)';
  const isGroup = suite.type === 'group';
  const stopOnFailure = !isGroup && suite.stopOnFailure !== false;
  const tests = suite.tests || [];

  emit({ event: 'suite-start', name: description });

  const state = {};
  let passed = 0, failed = 0, skipped = 0;

  for (let i = 0; i < tests.length; i += 1) {
    const t = tests[i];
    const name = t.name || `step-${i + 1}`;

    if (filter && !name.includes(filter) && !description.includes(filter)) continue;

    if (t.skip) {
      emit({ event: 'skip', name: `${description} → ${name}`, reason: typeof t.skip === 'string' ? t.skip : 'skipped' });
      skipped += 1;
      continue;
    }

    const ctx = ctxBase(state);
    const start = Date.now();
    try {
      const timeout = t.timeout || suite.timeout || 30000;
      await Promise.race([
        Promise.resolve(t.run(ctx)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), timeout)),
      ]);
      const duration = Date.now() - start;
      emit({ event: 'result', suite: description, name, passed: true, duration });
      passed += 1;

      if (t.cleanup) {
        try { await t.cleanup(ctx); } catch (e) {
          emit({ event: 'cleanup-warn', name, message: e.message });
        }
      }
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
        if (remaining > 0) {
          emit({ event: 'suite-stopped', name: description, remaining });
          skipped += remaining;
        }
        break;
      }
    }
  }

  if (suite.cleanup) {
    try { await suite.cleanup(ctxBase(state)); }
    catch (e) { emit({ event: 'cleanup-warn', name: description, message: e.message }); }
  }

  return { passed, failed, skipped };
}

async function runStandalone(mod, ctxBase, filter) {
  const description = mod.description || '(test)';
  if (filter && !description.includes(filter)) return { passed: 0, failed: 0, skipped: 0 };

  const ctx = ctxBase({});
  const start = Date.now();
  try {
    const timeout = mod.timeout || 30000;
    await Promise.race([
      Promise.resolve(mod.run(ctx)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), timeout)),
    ]);
    const duration = Date.now() - start;
    emit({ event: 'result', name: description, passed: true, duration });
    if (mod.cleanup) {
      try { await mod.cleanup(ctx); } catch (e) {
        emit({ event: 'cleanup-warn', name: description, message: e.message });
      }
    }
    return { passed: 1, failed: 0, skipped: 0 };
  } catch (e) {
    const duration = Date.now() - start;
    if (e.name === 'SkipError') {
      emit({ event: 'skip', name: description, reason: e.message });
      return { passed: 0, failed: 0, skipped: 1 };
    }
    emit({ event: 'result', name: description, passed: false, duration, error: e.message });
    return { passed: 0, failed: 1, skipped: 0 };
  }
}

app.whenReady().then(runSuites).catch((e) => {
  emit({ event: 'fatal', message: e.message, stack: e.stack });
  app.exit(1);
});
