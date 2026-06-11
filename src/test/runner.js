// Test runner — discovers + runs suites, reports BEM-style.
//
// Discovery: globs for `test/**/*.js` (recursively, excluding directories starting with `_`)
// in two locations:
//   1. The framework itself (electron-manager/dist/test/suites/...) — default suites.
//   2. The consumer project's CWD (./test/...) — consumer suites.
//
// Each test file is a CommonJS module that exports a test definition (see ./index.js).
// Three forms supported:
//
//   - Standalone:  module.exports = { layer, description, run, cleanup, timeout, skip };
//   - Suite:       module.exports = { type: 'suite', layer, description, tests: [...], cleanup, stopOnFailure };
//   - Group:       module.exports = { type: 'group', layer, description, tests: [...], cleanup };
//   - Array form:  module.exports = [ {name, run}, ... ];   // implicit group
//
// `tests[]` items are { name, run(ctx), cleanup?, skip?, timeout? }.
//
// Suites stop on first failure (sequential, share state). Groups run all tests regardless.
//
// Layers:
//   - 'build'    runs in plain Node (this file).
//   - 'main'     spawns Electron via runners/electron.js, runs in the main process.
//   - 'renderer' runs in a hidden BrowserWindow (Pass 2.3c).

const path = require('path');
const glob = require('glob').globSync;
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const expect = require('./assert.js');
const { runElectronTests } = require('./runners/electron.js');
const { runBootTests }     = require('./runners/boot.js');

class SkipError extends Error {
  constructor(reason) { super(reason); this.name = 'SkipError'; }
}

async function run(options = {}) {
  options.layer    = options.layer    || 'all';
  options.target   = options.target   || null;
  options.filter   = options.filter   || null;
  options.reporter = options.reporter || 'pretty';

  const startTime = Date.now();

  const sources = discoverTestFiles(options.target);

  console.log('');
  console.log(chalk.bold('  Electron Manager Tests'));

  // Run the optional test/_init.js setup() hooks (framework + consumer) ONCE,
  // before any suite. There is no cleanup hook — tests clean up after themselves.
  await runInitSetups();

  const results = { passed: 0, failed: 0, skipped: 0, tests: [] };

  if (sources.framework.length > 0) {
    console.log('');
    console.log(chalk.bold('  Framework Tests'));
    await runSource(sources.framework, 'framework', options, results);
  }

  if (sources.project.length > 0) {
    console.log('');
    console.log(chalk.bold('  Project Tests'));
    await runSource(sources.project, 'project', options, results);
  }

  if (sources.framework.length === 0 && sources.project.length === 0) {
    console.log(chalk.gray('  No test files found.'));
  }

  reportResults(results, Date.now() - startTime);

  return results;
}

async function runSource(files, source, options, results) {
  // Partition by layer (peek at module.exports without invoking run functions).
  const byLayer = { build: [], main: [], renderer: [], boot: [] };
  for (const file of files) {
    const layer = peekLayer(file) || 'build';
    if (byLayer[layer]) byLayer[layer].push(file);
  }

  // Build layer — run inline.
  if ((options.layer === 'all' || options.layer === 'build') && byLayer.build.length > 0) {
    for (const file of byLayer.build) {
      await runBuildFile(file, source, options, results);
    }
  }

  // Main + renderer layers run in the same spawned electron process — main suites first,
  // then a hidden BrowserWindow takes over for renderer suites. This keeps a single
  // electron boot per `npx mgr test` invocation.
  const wantsMain     = (options.layer === 'all' || options.layer === 'main')     && byLayer.main.length     > 0;
  const wantsRenderer = (options.layer === 'all' || options.layer === 'renderer') && byLayer.renderer.length > 0;

  if (wantsMain || wantsRenderer) {
    const projectRoot = process.cwd();
    const harnessEntry = path.join(__dirname, 'harness', 'main-entry.js');
    const counts = await runElectronTests({
      harnessEntry,
      suiteFiles:         wantsMain     ? byLayer.main     : [],
      rendererSuiteFiles: wantsRenderer ? byLayer.renderer : [],
      filter: options.filter,
      projectRoot,
    });
    results.passed  += counts.passed;
    results.failed  += counts.failed;
    results.skipped += counts.skipped;
  }

  // Boot layer — spawn the consumer's actual built bundle and inspect the live manager.
  // Skipped when running framework tests (no consumer to boot).
  if ((options.layer === 'all' || options.layer === 'boot') && byLayer.boot.length > 0) {
    if (source !== 'project') {
      // Framework's own boot tests can run too, but only when there's a built bundle to test.
      // Fall through and let the runner skip if dist/main.bundle.js is missing.
    }
    await runBootLayer(byLayer.boot, source, options, results);
  }
}

async function runBootLayer(files, source, options, results) {
  // Aggregate every boot test (whether standalone or inside a suite) into one flat list.
  // The boot harness runs them sequentially in a single Electron process to keep startup
  // cost amortized. State doesn't carry across boot tests — each runs against a single
  // shared `manager` from the consumer's actual main bundle.
  const tests = [];

  for (const file of files) {
    let mod;
    try {
      delete require.cache[require.resolve(file)];
      mod = require(file);
    } catch (e) {
      const rel = relativizePath(file, source);
      console.log(chalk.red(`    ✗ ${rel}`));
      console.log(chalk.red(`      Failed to load: ${e.message}`));
      results.failed += 1;
      continue;
    }

    if (Array.isArray(mod))                      mod = { type: 'group', tests: mod };
    if (Array.isArray(mod.tests))                {/* multi-test */ }
    else if (typeof mod.inspect === 'function')  mod = { tests: [mod] };

    const baseDescription = mod.description || relativizePath(file, source);

    for (const t of (mod.tests || [])) {
      if (typeof t.inspect !== 'function') continue;
      if (options.filter && !(t.description || baseDescription).includes(options.filter)) continue;
      tests.push({
        description: t.description || baseDescription,
        timeout:     t.timeout || mod.timeout || 15000,
        inspect:     t.inspect,
      });
    }
  }

  if (tests.length === 0) return;

  console.log(chalk.cyan('    ⤷ boot tests (consumer bundle)'));

  const projectRoot = process.cwd();
  const emDistRoot  = __dirname; // dist/test/runner.js → dist/test
  const counts = await runBootTests({
    tests,
    projectRoot,
    emDistRoot: path.resolve(emDistRoot, '..'),
  });
  results.passed  += counts.passed;
  results.failed  += counts.failed;
  results.skipped += counts.skipped;
}

function peekLayer(file) {
  try {
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    if (Array.isArray(mod)) return 'build';
    return mod.layer || 'build';
  } catch (e) {
    return null;
  }
}

function peekDescription(file) {
  try {
    const mod = require(file);
    return mod.description;
  } catch (e) { return null; }
}

function peekTestCount(file) {
  try {
    const mod = require(file);
    if (Array.isArray(mod)) return mod.length;
    if (Array.isArray(mod.tests)) return mod.tests.length;
    return 1;
  } catch (e) { return 1; }
}

async function runBuildFile(file, source, options, results) {
  let mod;
  try {
    delete require.cache[require.resolve(file)];
    mod = require(file);
  } catch (e) {
    const rel = relativizePath(file, source);
    console.log(chalk.red(`    ✗ ${rel}`));
    console.log(chalk.red(`      Failed to load: ${e.message}`));
    results.failed += 1;
    return;
  }

  if (Array.isArray(mod)) {
    mod = { type: 'group', tests: mod };
  }

  const rel = relativizePath(file, source);

  if (mod.skip) {
    const reason = typeof mod.skip === 'string' ? mod.skip : '';
    console.log(chalk.yellow(`    ○ ${mod.description || rel}`) + chalk.gray(` (skipped${reason ? ': ' + reason : ''})`));
    const count = Array.isArray(mod.tests) ? mod.tests.length : 1;
    results.skipped += count;
    return;
  }

  if (mod.type === 'suite' || mod.type === 'group' || Array.isArray(mod.tests)) {
    await runSuite(mod, rel, options, results);
  } else {
    await runStandalone(mod, rel, options, results);
  }
}

async function runSuite(suite, rel, options, results) {
  const description = suite.description || rel;
  const isGroup = suite.type === 'group';
  const stopOnFailure = !isGroup && suite.stopOnFailure !== false;
  const tests = suite.tests || [];

  console.log(chalk.cyan(`    ⤷ ${description}`));

  const state = {};

  for (let i = 0; i < tests.length; i += 1) {
    const t = tests[i];
    const name = t.name || `step-${i + 1}`;

    if (options.filter && !name.includes(options.filter) && !description.includes(options.filter)) continue;

    if (t.skip) {
      const reason = typeof t.skip === 'string' ? t.skip : '';
      console.log(chalk.yellow(`      ○ ${name}`) + chalk.gray(` (skipped${reason ? ': ' + reason : ''})`));
      results.skipped += 1;
      continue;
    }

    const ctx = createContext({ state, layer: suite.layer || 'build' });
    const timeout = t.timeout || suite.timeout || 30000;

    const start = Date.now();
    try {
      await Promise.race([
        Promise.resolve(t.run(ctx)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), timeout)),
      ]);
      const duration = Date.now() - start;
      console.log(chalk.green(`      ✓ ${name}`) + chalk.gray(` (${duration}ms)`));
      results.passed += 1;

      if (t.cleanup) {
        try { await t.cleanup(ctx); } catch (e) {
          console.log(chalk.yellow(`        ⚠ Cleanup failed: ${e.message}`));
        }
      }
    } catch (e) {
      const duration = Date.now() - start;
      if (e.name === 'SkipError') {
        console.log(chalk.yellow(`      ○ ${name}`) + chalk.gray(` (skipped: ${e.message})`));
        results.skipped += 1;
        continue;
      }
      console.log(chalk.red(`      ✗ ${name}`) + chalk.gray(` (${duration}ms)`));
      console.log(chalk.red(`        ${e.message || e}`));
      results.failed += 1;

      if (stopOnFailure) {
        const remaining = tests.length - i - 1;
        if (remaining > 0) {
          console.log(chalk.yellow(`        Skipping ${remaining} remaining test(s) in suite`));
          results.skipped += remaining;
        }
        break;
      }
    }
  }

  if (suite.cleanup) {
    try {
      const ctx = createContext({ state, layer: suite.layer || 'build' });
      await suite.cleanup(ctx);
    } catch (e) {
      console.log(chalk.yellow(`      ⚠ Suite cleanup failed: ${e.message}`));
    }
  }
}

async function runStandalone(mod, rel, options, results) {
  const description = mod.description || rel;
  if (options.filter && !description.includes(options.filter)) return;

  const ctx = createContext({ state: {}, layer: mod.layer || 'build' });
  const timeout = mod.timeout || 30000;

  const start = Date.now();
  try {
    await Promise.race([
      Promise.resolve(mod.run(ctx)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), timeout)),
    ]);
    const duration = Date.now() - start;
    console.log(chalk.green(`    ✓ ${description}`) + chalk.gray(` (${duration}ms)`));
    results.passed += 1;

    if (mod.cleanup) {
      try { await mod.cleanup(ctx); } catch (e) {
        console.log(chalk.yellow(`      ⚠ Cleanup failed: ${e.message}`));
      }
    }
  } catch (e) {
    const duration = Date.now() - start;
    if (e.name === 'SkipError') {
      console.log(chalk.yellow(`    ○ ${description}`) + chalk.gray(` (skipped: ${e.message})`));
      results.skipped += 1;
      return;
    }
    console.log(chalk.red(`    ✗ ${description}`) + chalk.gray(` (${duration}ms)`));
    console.log(chalk.red(`      ${e.message || e}`));
    results.failed += 1;
  }
}

function createContext({ state, layer }) {
  return {
    expect,
    state,
    layer,
    skip(reason) { throw new SkipError(reason || 'skipped at runtime'); },
  };
}

function reportResults(results, durationMs) {
  const total = results.passed + results.failed + results.skipped;
  console.log('');
  console.log('  ' + chalk.bold('Results'));
  console.log(`    ${chalk.green(`${results.passed} passing`)}`);
  if (results.failed > 0)  console.log(`    ${chalk.red(`${results.failed} failing`)}`);
  if (results.skipped > 0) console.log(`    ${chalk.yellow(`${results.skipped} skipped`)}`);
  console.log(chalk.gray(`\n    Total: ${total} tests in ${durationMs}ms\n`));
}

// Parse a positional test target into a source filter + path part.
// Source prefixes (standardized across all OMEGA frameworks):
//   'mgr:' / 'em:' / 'framework:' → framework tests  ('mgr:' is the universal alias)
//   'project:'                    → project tests
//   no prefix                     → both sources, matched by path
// Supported forms:
//   'project:'              → { source: 'project',   pathPart: null }   (all project tests)
//   'project:main/tab'      → { source: 'project',   pathPart: 'main/tab' }
//   'mgr:' / 'em:'          → { source: 'framework', pathPart: null }   (all framework tests)
//   'mgr:build/config'      → { source: 'framework', pathPart: 'build/config' }
//   'main/tab'  (no prefix) → { source: null,        pathPart: 'main/tab' }  (both sources)
//   null / ''               → { source: null,        pathPart: null }   (everything)
function parseTarget(target) {
  if (!target) {
    return { source: null, pathPart: null };
  }

  const m = String(target).match(/^(project|mgr|em|framework):(.*)$/);
  if (m) {
    const source = m[1] === 'project' ? 'project' : 'framework';
    return { source, pathPart: m[2] || null };
  }

  return { source: null, pathPart: target };
}

// Narrow a source's file list by the parsed target. A source-prefixed target
// excludes the other source entirely; the path part (if any) matches by
// relative path prefix.
function filterBySource(source, files, sourceFilter, pathPart) {
  if (sourceFilter && sourceFilter !== source) {
    return [];
  }
  if (!pathPart) {
    return files;
  }

  return files.filter((file) => {
    const rel = relativizePath(file, source);
    const relNoExt = rel.replace(/\.js$/, '').replace(/\.test$/, '');
    const partNoExt = pathPart.replace(/\.js$/, '').replace(/\.test$/, '');
    return rel.startsWith(pathPart)
      || relNoExt === partNoExt
      || relNoExt.startsWith(partNoExt + '/')
      || rel.includes(pathPart);
  });
}

function discoverTestFiles(target) {
  const { source: sourceFilter, pathPart } = parseTarget(target);
  const framework = [];
  const project = [];

  // Detect whether we're running EM's own framework self-tests, vs a consumer
  // who installed EM and is running their own tests. Used below to filter the
  // boot/ layer of framework suites — those target EM's internal fixture, so
  // they only make sense when EM tests itself. Matches BXM/UJM pattern.
  const isFrameworkSelfTest = (() => {
    try {
      const cwdPkg = require(path.join(process.cwd(), 'package.json'));
      return cwdPkg.name === 'electron-manager';
    } catch (_) { return false; }
  })();

  // Framework default suites (relative to this file: dist/test/runner.js).
  // For consumers, we exclude boot/ — framework boot suites assert on EM's own
  // fixture app surface and would fail noisily when run against a real consumer's
  // built app. Consumers write their own boot tests under <cwd>/test/boot/.
  const frameworkSuitesDir = path.join(__dirname, 'suites');
  if (jetpack.exists(frameworkSuitesDir)) {
    const ignore = ['_**'];
    if (!isFrameworkSelfTest) ignore.push('boot/**');
    glob('**/*.js', { cwd: frameworkSuitesDir, ignore }).sort().forEach((rel) => {
      framework.push(path.join(frameworkSuitesDir, rel));
    });
  }

  // Consumer project suites — CWD/test/**/*.js.
  // Exclude directories starting with `_`.
  const projectTestsDir = path.join(process.cwd(), 'test');
  if (jetpack.exists(projectTestsDir) && projectTestsDir !== path.dirname(frameworkSuitesDir)) {
    glob('**/*.js', { cwd: projectTestsDir, ignore: ['_**'] }).sort().forEach((rel) => {
      project.push(path.join(projectTestsDir, rel));
    });
  }

  return {
    framework: filterBySource('framework', framework, sourceFilter, pathPart),
    project:   filterBySource('project',   project,   sourceFilter, pathPart),
  };
}

function relativizePath(file, source) {
  if (source === 'framework') {
    return path.relative(path.join(__dirname, 'suites'), file);
  }
  return path.relative(path.join(process.cwd(), 'test'), file);
}

// ---------------------------------------------------------------------------
// test/_init.js — pre-test lifecycle hook (setup only)
//
// Mirrors the backend framework's hook so all four frameworks share one shape.
// A project may add `<cwd>/test/_init.js` exporting a FUNCTION —
// `module.exports = (ctx) => ({ setup })` — called with `{ projectRoot }` and
// returning an object with an async `setup({ projectRoot })` that runs ONCE
// before any suite (e.g. to scaffold a fixture file the boot layer needs).
// There is no `cleanup` hook: tests clean up after themselves. Unlike the
// backend framework, there is no `accounts` field here — these frameworks have
// no auth/user system.
// ---------------------------------------------------------------------------

function loadInit(testDir, label) {
  const initPath = path.join(testDir, '_init.js');

  if (!jetpack.exists(initPath)) {
    return {};
  }

  try {
    const fn = require(initPath);

    if (typeof fn !== 'function') {
      console.log(chalk.red(`  ✗ ${label} test/_init.js must export a function: module.exports = (ctx) => ({ ... })`));
      return {};
    }

    const mod = fn({ projectRoot: process.cwd() });
    return mod && typeof mod === 'object' ? mod : {};
  } catch (e) {
    console.log(chalk.red(`  ✗ Failed to load ${label} test/_init.js: ${e.message}`));
    return {};
  }
}

async function runInitSetups() {
  const frameworkTestsDir = path.resolve(__dirname, '../../test');
  const projectTestsDir = path.join(process.cwd(), 'test');

  const hooks = [
    loadInit(frameworkTestsDir, 'framework'),
    loadInit(projectTestsDir, 'project'),
  ];

  const setups = hooks.filter((h) => typeof h.setup === 'function').map((h) => h.setup);

  for (const setup of setups) {
    process.stdout.write(chalk.gray('  Running test/_init.js setup... '));
    try {
      await setup({ projectRoot: process.cwd() });
      console.log(chalk.green('✓'));
    } catch (e) {
      console.log(chalk.red(`✗ (${e.message})`));
    }
  }
}

module.exports = { run, SkipError };
