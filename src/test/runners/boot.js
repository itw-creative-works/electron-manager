// Boot-runner — spawns electron with the consumer's actual built main bundle, runs
// inspect functions against the live manager, then quits cleanly.
//
// Differences from runners/electron.js:
//   - electron.js spawns electron with `harness/main-entry.js` and tests EM lib code in isolation.
//   - boot.js spawns electron with the consumer's `dist/main.bundle.js` (the real production
//     boot path), then injects `harness/boot-entry.js` via --require to drive inspection.
//
// Why both? `main` layer tests cover individual lib behavior fast. `boot` layer covers
// integration — does the consumer's actual main.js boot end-to-end with their config + scaffolds?
// Replaces shell-level `npm start && sleep && kill` smoke tests with deterministic, signal-driven
// pass/fail.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const chalk = require('chalk').default;

async function runBootTests({ tests, projectRoot, emDistRoot }) {
  if (tests.length === 0) {
    return { passed: 0, failed: 0, skipped: 0 };
  }

  // EM_TEST_BOOT_PROJECT — boot a different project root than the CWD. Auto-set to the
  // bundled fixture when EM self-tests (see commands/test.js); set it explicitly to boot a
  // real consumer (e.g. deployment-playground-desktop) without cd-ing into it. Mirrors
  // BXM's BXM_TEST_BOOT_PROJECT / UJM's UJ_TEST_BOOT_PROJECT.
  const effectiveRoot = process.env.EM_TEST_BOOT_PROJECT
    ? path.resolve(process.env.EM_TEST_BOOT_PROJECT)
    : projectRoot;

  // The bundled fixture ships as SOURCE only (no node_modules). Symlink the two deps the
  // build + boot path resolves by EXPLICIT path: electron-manager (the gulpfile path +
  // webpack's `require('electron-manager/main')`) and electron (the runner's binary lookup
  // + the spawned bundle's `require('electron')`). Everything else (gulp, electron-store,
  // etc.) resolves through the upward node_modules walk because the fixture lives inside the
  // EM repo. No-op for a real consumer that already has its own node_modules.
  ensureFixtureDeps(effectiveRoot, path.resolve(emDistRoot, '..'));

  // Locate electron.
  let electronBin;
  try {
    electronBin = require(path.join(effectiveRoot, 'node_modules', 'electron'));
  } catch (e) {
    const msg = `    ○ boot tests skipped (electron not installed in ${effectiveRoot})`;
    console.log(chalk.yellow(msg));
    return { passed: 0, failed: 0, skipped: tests.length };
  }

  // Always rebuild before boot tests. Boot tests run against the consumer's actual
  // production main bundle (`dist/main.bundle.js`); if it's stale, tests pass against
  // outdated code. Always-build is ~10s slower than a staleness check, but a staleness
  // heuristic (mtime comparison) can be defeated by editor backdating, git restores, or
  // file copies — and a silently-stale test is worse than a slow one.
  // Set EM_TEST_SKIP_BUILD=1 to opt out (CI scenarios where build ran in a separate step).
  const bundlePath = path.join(effectiveRoot, 'dist', 'main.bundle.js');
  if (process.env.EM_TEST_SKIP_BUILD !== '1') {
    console.log(chalk.gray(`      Building bundle for boot tests...`));
    const buildResult = runGulpBuild(effectiveRoot);
    if (buildResult !== 0) {
      console.log(chalk.red(`    ✗ Boot tests aborted — gulp build failed (exit ${buildResult}).`));
      return { passed: 0, failed: tests.length, skipped: 0 };
    }
  } else if (!fs.existsSync(bundlePath)) {
    console.log(chalk.yellow(`    ○ boot tests skipped (no bundle at ${bundlePath}, EM_TEST_SKIP_BUILD=1 set)`));
    return { passed: 0, failed: 0, skipped: tests.length };
  }

  // Write the spec file. Each test's `inspect` function body is extracted as a string
  // and shipped to the harness for reconstitution. Same trick as runners/electron.js
  // uses for renderer suites.
  const spec = {
    projectRoot: effectiveRoot,
    emDistRoot,
    tests: tests.map((t) => ({
      description:    t.description,
      timeout:        t.timeout,
      inspectSource:  extractFnBody(t.inspect),
    })),
  };

  const specFile = path.join(os.tmpdir(), `em-boot-spec-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec));

  const bootEntry = path.join(emDistRoot, 'test', 'harness', 'boot-entry.js');

  // Tell the consumer's main.js to publish the manager + run the boot harness.
  // Three env vars are picked up by EM's main.js after init completes:
  //   EM_TEST_BOOT          — gate; "1" turns on harness loading
  //   EM_TEST_BOOT_HARNESS  — absolute path to harness module (resolved here so it works
  //                           even though main.js is webpacked into the consumer bundle)
  //   EM_TEST_BOOT_SPEC     — JSON file with the test definitions
  // Argv would be cleaner but Electron rejects unknown CLI flags.
  const childEnv = Object.assign({}, process.env, {
    EM_TEST_MODE:                  'true',   // canonical signal — manager.isTesting() picks it up
    EM_TEST_BOOT:                  '1',      // boot-runner-specific dispatch marker (main.js reads this to load the harness instead of doing normal init)
    EM_TEST_BOOT_HARNESS:          bootEntry,
    EM_TEST_BOOT_SPEC:             specFile,
    // Tray on macOS pops a real menubar icon; suppress to keep the test invisible.
    EM_TEST_HEADLESS:              '1',
    // Suppress dev-mode dock-bounce / startup item changes during the test.
    NODE_ENV:                      process.env.NODE_ENV || 'test',
  });
  // ELECTRON_RUN_AS_NODE is already stripped by bin/mgr at the CLI boundary, so the child
  // env is clean — no extra delete here.

  // Args passed to electron:
  //   effectiveRoot — load the consumer project (package.json#main = dist/main.bundle.js).
  //
  // We don't use `--require <bootEntry>` because Electron rejects unknown CLI flags. Instead,
  // EM's main.js detects EM_TEST_BOOT and `require()`s the boot harness itself after init.
  const args = [effectiveRoot];

  return new Promise((resolve) => {
    const child = spawn(electronBin, args, {
      cwd: effectiveRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let counts = { passed: 0, failed: 0, skipped: 0 };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('__EM_TEST__')) {
          handleEvent(JSON.parse(line.slice('__EM_TEST__'.length)));
        } else if (process.env.EM_TEST_DEBUG && line.trim().length > 0) {
          process.stdout.write(chalk.gray(`      ${line}\n`));
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      if (process.env.EM_TEST_DEBUG) {
        process.stderr.write(chalk.gray(`[boot:stderr] ${chunk.toString()}`));
      }
    });

    function handleEvent(evt) {
      if (evt.event === 'result') {
        if (evt.passed) {
          console.log(chalk.green(`      ✓ ${evt.name}`) + chalk.gray(` (${evt.duration}ms)`));
          counts.passed += 1;
        } else {
          console.log(chalk.red(`      ✗ ${evt.name}`) + chalk.gray(` (${evt.duration}ms)`));
          if (evt.error) console.log(chalk.red(`        ${evt.error}`));
          counts.failed += 1;
        }
      } else if (evt.event === 'fatal') {
        console.log(chalk.red(`    ✗ Boot harness fatal: ${evt.message}`));
        if (evt.stack) console.log(chalk.gray(`      ${evt.stack.split('\n').slice(0, 3).join('\n      ')}`));
        counts.failed += 1;
      }
    }

    child.on('error', (err) => {
      console.log(chalk.red(`    ✗ Failed to spawn boot harness: ${err.message}`));
      counts.failed += 1;
      cleanup();
      resolve(counts);
    });

    child.on('exit', () => {
      cleanup();
      resolve(counts);
    });

    function cleanup() {
      try { fs.unlinkSync(specFile); } catch (_) { /* ignore */ }
    }
  });
}

// Extract the body of a function as a string. Same impl style as main-entry.js's
// extractFnBody — handles arrow fns, async fns, and regular fns.
function extractFnBody(fn) {
  const src = String(fn);
  // Try arrow: `(args) => { ... }` or `args => expr`
  let m = src.match(/^\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*$/);
  if (m) return m[1];
  m = src.match(/^\s*(?:async\s+)?\([^)]*\)\s*=>\s*([\s\S]*?)\s*$/);
  if (m) return `return ${m[1]};`;
  // Regular fn: `function (args) { ... }` or `function name(args) { ... }`
  m = src.match(/^\s*(?:async\s+)?function[^(]*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (m) return m[1];
  // Method shorthand: `inspect(args) { ... }`
  m = src.match(/^[^(]*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (m) return m[1];
  throw new Error(`Could not extract body from function: ${src.slice(0, 80)}...`);
}

// Shell out to the same gulp pipeline `npm run build` uses. This produces a fresh
// dist/main.bundle.js (+ preload + renderer bundles) using the consumer's current source.
// Output is streamed inline so the user sees progress for the ~10s build cost.
function runGulpBuild(projectRoot) {
  const gulpfile = path.join(projectRoot, 'node_modules', 'electron-manager', 'dist', 'gulp', 'main.js');
  const result = spawnSync('npx', ['gulp', '--cwd', projectRoot, '--gulpfile', gulpfile, 'build'], {
    cwd:   projectRoot,
    env:   Object.assign({}, process.env, { EM_BUILD_MODE: 'true' }),
    stdio: 'inherit',
  });
  return result.status == null ? 1 : result.status;
}

// Symlink the deps the bundled fixture's build + boot path resolves by EXPLICIT path
// (not the upward node_modules walk):
//   - electron-manager → the EM repo root, so `<root>/node_modules/electron-manager/dist/gulp/main.js`
//     (the gulpfile path) resolves AND webpack's `require('electron-manager/main')` resolves.
//   - electron → EM's own electron, so the runner's `require('<root>/node_modules/electron')`
//     binary lookup + the spawned bundle's `require('electron')` resolve.
// Creates only what's MISSING — a no-op for a real consumer (EM_TEST_BOOT_PROJECT pointed at
// an installed app already has both). Runtime-only + gitignored; never committed.
function ensureFixtureDeps(effectiveRoot, emRoot) {
  const nodeModules = path.join(effectiveRoot, 'node_modules');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const links = [
    ['electron-manager', emRoot],
    ['electron',         path.join(emRoot, 'node_modules', 'electron')],
  ];

  for (const [name, target] of links) {
    const linkPath = path.join(nodeModules, name);
    if (fs.existsSync(linkPath)) continue;   // real consumer already has it, or a prior run linked it
    if (!fs.existsSync(target))  continue;   // can't link what isn't there

    try {
      fs.mkdirSync(nodeModules, { recursive: true });
      fs.symlinkSync(target, linkPath, linkType);
    } catch (e) {
      // Best-effort — if it mattered, the gulp build / electron lookup below surfaces a
      // far clearer error than anything we'd throw here.
      if (process.env.EM_TEST_DEBUG) {
        console.log(chalk.gray(`      [boot] could not link ${name}: ${e.message}`));
      }
    }
  }
}

module.exports = { runBootTests };
