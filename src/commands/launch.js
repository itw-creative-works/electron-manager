// `npx mgr launch [app-path] [--args ...]` — open a packaged Electron app with a clean
// environment (specifically: ELECTRON_RUN_AS_NODE stripped from inherited env).
//
// Why this exists:
//   When EM is running inside a host process that has ELECTRON_RUN_AS_NODE=1 set
//   (e.g., VS Code's Claude Code extension, which lives in a `node.mojom.NodeService`
//   utility process), every shell EM spawns inherits that variable. Launching a
//   packaged Electron app from such a shell — via `open .../MyApp.app` or by running
//   the binary directly — propagates the variable to the app, which Electron then
//   honors by running as plain Node: no `app` API, no BrowserWindow, no window. The
//   app exits cleanly with code 0 and no error. Total invisible silent failure.
//
//   `bin/electron-manager` and `src/gulp/main.js` already strip ELECTRON_RUN_AS_NODE
//   at the boundary so anything launched THROUGH mgr or gulp is fine. But the manual
//   smoke-test flow (`open -n release/mac-arm64/MyApp.app`) bypasses both. This
//   command is the manual-launch equivalent of those boundary strips.
//
// Usage:
//   npx mgr launch                                                # auto-find a .app/.exe under release/<host-platform>-<host-arch>/
//   npx mgr launch ./release/mac-arm64/MyApp.app                  # explicit path
//   npx mgr launch /Applications/MyApp.app                        # an installed .app
//
// Forwarding argv to the app (for hidden-mode tests, custom flags, etc.):
//   npx mgr launch --args="--em-launched-at-login"                # single flag (quoted to keep yargs from eating it)
//   npx mgr launch --args="--foo=bar --baz"                       # multiple, space-separated inside the quotes
//
// Aliases: `npx mgr open`, `npx mgr --launch`.

const path     = require('path');
const fs       = require('fs');
const jetpack  = require('fs-jetpack');
const { spawn } = require('child_process');

const Manager = new (require('../build.js'));
const logger  = Manager.logger('launch');

module.exports = async function (options) {
  options = options || {};
  options._ = options._ || [];

  // Positional app path (after the `launch` subcommand). e.g. `mgr launch ./foo.app`
  // → options._ = ['launch', './foo.app']. Resolution order:
  //   1. Explicit positional argument
  //   2. Auto-discover under release/<platform>-<arch>/ (output of `mgr package:quick`)
  //   3. Error
  let appPath = options._[1] ? path.resolve(process.cwd(), options._[1]) : null;
  if (!appPath) {
    appPath = autoDiscoverApp();
    if (!appPath) {
      throw new Error(`No app path supplied and could not auto-discover a packaged app. Tried release/<platform>-<arch>/. Pass an explicit path: \`npx mgr launch ./release/...\``);
    }
    logger.log(`auto-discovered: ${path.relative(process.cwd(), appPath)}`);
  }

  if (!jetpack.exists(appPath)) {
    throw new Error(`App not found: ${appPath}`);
  }

  // Strip ELECTRON_RUN_AS_NODE from the env we hand to the child. (The CLI entry already
  // strips it from this process — we strip again at spawn time as defense-in-depth in case
  // some intermediate code re-set it.)
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  // Forward extra argv to the app via `--args`. yargs splits the rest of argv into
  // options._ when no flag matches; everything after the app path goes through.
  const extraArgs = options._.slice(2);
  // Also accept --args as an explicit array/string.
  if (typeof options.args === 'string') extraArgs.push(...options.args.split(/\s+/).filter(Boolean));
  else if (Array.isArray(options.args)) extraArgs.push(...options.args);

  const platform = process.platform;
  let cmd;
  let args;
  let logHint;

  if (platform === 'darwin' && appPath.endsWith('.app')) {
    // macOS .app — use `open -n` (new instance, LaunchServices-aware so dock-click
    // routes to this instance for activate events). Pass extra argv via --args.
    cmd = 'open';
    args = ['-n', appPath, ...(extraArgs.length ? ['--args', ...extraArgs] : [])];
    logHint = `open -n ${shellEscape(appPath)}${extraArgs.length ? ' --args ' + extraArgs.map(shellEscape).join(' ') : ''}`;
  } else {
    // Direct binary launch — Windows .exe, Linux binary, or running the .app's MacOS
    // binary directly (rare, used to bypass LaunchServices for diagnosis).
    cmd = appPath;
    if (platform === 'darwin' && appPath.endsWith('.app')) {
      cmd = path.join(appPath, 'Contents', 'MacOS', path.basename(appPath, '.app'));
    }
    args = extraArgs;
    logHint = `${shellEscape(cmd)}${args.length ? ' ' + args.map(shellEscape).join(' ') : ''}`;
  }

  logger.log(`launching with clean env (ELECTRON_RUN_AS_NODE stripped)...`);
  logger.log(`  ${logHint}`);

  // Detached so the launched app outlives the mgr process. Inherit stdio so any
  // immediate-exit error (e.g. a crash in main.bundle.js) shows up in the user's
  // terminal — defeats the whole "silent exit" symptom we're trying to make easy
  // to debug.
  const child = spawn(cmd, args, {
    env:      childEnv,
    detached: true,
    stdio:    'inherit',
  });
  child.unref();

  // Give the child ~500ms to print any immediate failure before we return.
  await new Promise((resolve) => setTimeout(resolve, 500));

  logger.log('launched.');
};

// Auto-discover a packaged app under release/<platform>-<arch>/ — matches the output
// directory of `mgr package:quick` for the host platform/arch.
function autoDiscoverApp() {
  const projectRoot = process.cwd();
  const platform    = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
  const arch        = process.arch;
  const releaseDir  = path.join(projectRoot, 'release', `${platform}-${arch}`);

  if (!jetpack.exists(releaseDir)) return null;

  // mac: look for *.app
  if (platform === 'mac') {
    const apps = jetpack.find(releaseDir, { matching: '*.app', recursive: false, files: false, directories: true });
    if (apps.length > 0) return apps[0];
  }
  // win: look for *.exe at the root (electron-builder --dir output is `win-unpacked/<App>.exe`)
  if (platform === 'win') {
    const exes = jetpack.find(releaseDir, { matching: '*.exe', recursive: false, files: true });
    if (exes.length > 0) return exes[0];
  }
  // linux: look for the binary (no extension) inside linux-unpacked/
  if (platform === 'linux') {
    const dirs = jetpack.list(releaseDir) || [];
    for (const d of dirs) {
      const full = path.join(releaseDir, d);
      if (jetpack.exists(full) === 'dir') return full;
    }
  }

  return null;
}

// Minimal shell-escape for log readability. Not used for actual exec (spawn args bypass shell).
function shellEscape(s) {
  if (!/[\s'"\\$]/.test(s)) return s;
  return `"${s.replace(/(["\\$])/g, '\\$1')}"`;
}
