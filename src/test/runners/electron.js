// Electron-runner — spawns electron with the main-process harness, parses JSON-line stream,
// renders BEM-style output to console. Returns aggregate counts.

const path = require('path');
const { spawn } = require('child_process');
const chalk = require('chalk').default;

function runElectronTests({ harnessEntry, suiteFiles, rendererSuiteFiles, filter, projectRoot }) {
  rendererSuiteFiles = rendererSuiteFiles || [];
  return new Promise((resolve, reject) => {
    let electronBin;
    try {
      electronBin = require(path.join(projectRoot, 'node_modules', 'electron'));
    } catch (e) {
      const msg = `    ○ main + renderer tests skipped (electron not installed in ${projectRoot})`;
      console.log(chalk.yellow(msg));
      const skipCount = (suiteFiles || []).length + rendererSuiteFiles.length;
      return resolve({ passed: 0, failed: 0, skipped: skipCount });
    }

    // Pass the harness DIRECTORY (not the entry file) as the app.
    // The harness dir has its own package.json with main: main-entry.js, which Electron uses.
    // This avoids Electron picking up the consumer's package.json main field.
    const harnessDir = path.dirname(harnessEntry);
    const args = [
      harnessDir,
      '--',
      '--suites',          JSON.stringify(suiteFiles || []),
      '--renderer-suites', JSON.stringify(rendererSuiteFiles),
    ];
    if (filter) {
      args.push('--filter', filter);
    }

    // Strip ELECTRON_RUN_AS_NODE — if set, Electron behaves as Node and our main-process tests can't run.
    const childEnv = Object.assign({}, process.env, {
      EM_TEST_MODE:    '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      NODE_OPTIONS:    '',
    });
    delete childEnv.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronBin, args, {
      cwd: projectRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let counts = { passed: 0, failed: 0, skipped: 0 };
    let currentSuite = null;

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('__EM_TEST__')) {
          handleEvent(JSON.parse(line.slice('__EM_TEST__'.length)));
        } else if (line.trim().length > 0) {
          // Pass-through other electron stdout (logger lines from EM init, etc.)
          // Indent so they don't disrupt the layout.
          process.stdout.write(chalk.gray(`      ${line}\n`));
        }
      }
    });

    // Always consume stderr (otherwise the pipe fills and the child blocks).
    // Default: silent. Set EM_TEST_DEBUG=1 to see what electron is logging.
    child.stderr.on('data', (chunk) => {
      if (process.env.EM_TEST_DEBUG) {
        const text = chunk.toString();
        process.stderr.write(chalk.gray(`[stderr] ${text}`));
      }
    });

    child.on('exit', (code, signal) => {
      if (process.env.EM_TEST_DEBUG) {
        console.log(chalk.gray(`[harness exit code=${code} signal=${signal}]`));
      }
    });

    function handleEvent(evt) {
      if (evt.event === 'suite-start') {
        currentSuite = evt.name;
        console.log(chalk.cyan(`    ⤷ ${evt.name}`));
      } else if (evt.event === 'result') {
        const indent = evt.suite ? '      ' : '    ';
        if (evt.passed) {
          console.log(chalk.green(`${indent}✓ ${evt.name}`) + chalk.gray(` (${evt.duration}ms)`));
          counts.passed += 1;
        } else {
          console.log(chalk.red(`${indent}✗ ${evt.name}`) + chalk.gray(` (${evt.duration}ms)`));
          if (evt.error) console.log(chalk.red(`${indent}  ${evt.error}`));
          counts.failed += 1;
        }
      } else if (evt.event === 'skip') {
        const indent = evt.name && evt.name.includes(' → ') ? '      ' : '    ';
        const count = evt.count || 1;
        console.log(chalk.yellow(`${indent}○ ${evt.name}`) + chalk.gray(` (skipped: ${evt.reason})`));
        counts.skipped += count;
      } else if (evt.event === 'suite-stopped') {
        console.log(chalk.yellow(`        Skipping ${evt.remaining} remaining test(s) in suite`));
      } else if (evt.event === 'cleanup-warn') {
        console.log(chalk.yellow(`        ⚠ Cleanup warning (${evt.name}): ${evt.message}`));
      } else if (evt.event === 'fatal') {
        console.log(chalk.red(`    ✗ Harness fatal: ${evt.message}`));
        if (evt.stack) console.log(chalk.gray(`      ${evt.stack.split('\n').slice(0, 3).join('\n      ')}`));
        counts.failed += 1;
      }
    }

    child.on('error', (err) => reject(err));
    child.on('exit', (_code) => resolve(counts));
  });
}

module.exports = { runElectronTests };
