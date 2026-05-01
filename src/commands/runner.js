// `npx mgr runner <subcommand>` — Windows EV-token signing runner manager.
//
// Lives outside any consumer project (run from a globally-installed EM on the Windows box).
// `install` downloads actions/runner, registers as a Windows service, and kicks off the
// em-runner-watcher daemon. Watcher polls GH for orgs the user is admin in, auto-registers
// runners for any new org so the user never touches the Windows box after install.
//
// Subcommands:
//   install              Idempotent setup: install actions/runner + watcher service.
//                        Tears down any prior install first, so re-running is safe.
//   register-org <org>   Manually register the runner against a specific GH org.
//   start                Start the runner + watcher services.
//   stop                 Stop them.
//   status               Show service status, registered orgs, watcher state.
//   uninstall            Remove everything.
//   self-update          Force an immediate self-update of EM (npm i -g electron-manager@latest).
//
// All commands except `install` and `register-org` are no-ops on non-Windows platforms.

const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const jetpack  = require('fs-jetpack');

const Manager  = new (require('../build.js'));
const logger   = Manager.logger('runner');

const RUNNER_LABELS = ['self-hosted', 'windows', 'ev-token'];
// Runner files live inside the cwd (typically the EM clone on the runner box) under .gh-runners/.
// Override via EM_RUNNER_HOME if you want them somewhere else (e.g. a separate disk for size).
// Falls back to <cwd>/.gh-runners so everything's self-contained next to the EM project.
// Add /.gh-runners/ to your .gitignore — EM's own .gitignore already has it.
const RUNNER_HOME = process.env.EM_RUNNER_HOME || path.join(process.cwd(), '.gh-runners');
const ACTIONS_RUNNER_VERSION = '2.319.1';   // pinned; bump intentionally

module.exports = async function (options) {
  options = options || {};
  const sub = (options._ && options._[1]) || 'status';

  switch (sub) {
    case 'install':      return install(options);
    case 'register-org': return registerOrg(options);
    case 'start':        return startServices(options);
    case 'stop':          return stopServices(options);
    case 'status':       return statusServices(options);
    case 'uninstall':    return uninstall(options);
    case 'self-update':  return selfUpdate(options);
    default:
      logger.error(`Unknown subcommand: "${sub}". Try one of: install, register-org, start, stop, status, uninstall, self-update.`);
      throw new Error(`Unknown runner subcommand: ${sub}`);
  }
};

// ─── install ────────────────────────────────────────────────────────────────────
async function install(options) {
  ensureWindows();
  ensureGhToken();
  ensureWindowsAdmin();

  // Idempotent by replacement: always tear down any prior install before starting.
  if (jetpack.exists(RUNNER_HOME)) {
    logger.log(`Existing em-runner installation detected — uninstalling first for a clean re-install...`);
    try {
      await uninstall();
    } catch (e) {
      logger.warn(`Pre-install uninstall hit an error (continuing anyway): ${e.message}`);
    }
  }

  logger.log(`Installing em-runner under ${RUNNER_HOME}`);
  jetpack.dir(RUNNER_HOME);

  // 1. Download actions/runner ONCE into a template dir. Per-org dirs are cloned from this.
  // Each actions-runner directory can only register against one org (it stores config files
  // at the top of the dir), so multi-org = multi-directory + multi-service.
  const templateDir = path.join(RUNNER_HOME, '_template');
  await downloadActionsRunner(templateDir);

  // 2. Resolve target orgs: filter list from EM_RUNNER_ORGS if set, otherwise all admin orgs.
  const allAdminOrgs = await discoverAdminOrgs();
  if (allAdminOrgs.length === 0) {
    logger.warn('Your GH_TOKEN has no orgs you can admin.');
  }

  const filterRaw = process.env.EM_RUNNER_ORGS || '';
  const filter = filterRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  let orgs;
  if (filter.length > 0) {
    const filterSet = new Set(filter.map((o) => o.toLowerCase()));
    orgs = allAdminOrgs.filter((o) => filterSet.has(o.toLowerCase()));
    const unmatched = filter.filter((f) => !allAdminOrgs.find((a) => a.toLowerCase() === f.toLowerCase()));
    logger.log(`EM_RUNNER_ORGS filter applied: ${orgs.length} matched (out of ${allAdminOrgs.length} admin orgs)`);
    if (unmatched.length > 0) logger.warn(`EM_RUNNER_ORGS lists ${unmatched.length} org(s) you don't admin: ${unmatched.join(', ')}`);
  } else {
    orgs = allAdminOrgs;
    logger.log(`Detected ${orgs.length} admin org(s) (set EM_RUNNER_ORGS in .env to install against a subset): ${orgs.join(', ')}`);
  }

  // 3. For each org: copy the template dir, run config.cmd inside it, register as service.
  const succeeded = [];
  const failedByReason = new Map();
  for (const org of orgs) {
    try {
      await registerOrg({ ...options, _: ['runner', 'register-org', org], _templateDir: templateDir });
      succeeded.push(org);
    } catch (e) {
      const reason = e.message || String(e);
      if (!failedByReason.has(reason)) failedByReason.set(reason, []);
      failedByReason.get(reason).push(org);
    }
  }

  // 4. Install the em-runner-watcher service.
  await installWatcherService();

  // 5. Save install metadata.
  saveConfig({
    installedAt: new Date().toISOString(),
    actionsRunnerVersion: ACTIONS_RUNNER_VERSION,
    labels: RUNNER_LABELS,
    registeredOrgs: succeeded,
    filterUsed: filter.length > 0 ? filter : null,
  });

  // 6. Summarize.
  logger.log('');
  logger.log(`────── Install summary ──────`);
  logger.log(`Successfully registered: ${succeeded.length} / ${orgs.length} org(s)`);
  if (succeeded.length > 0) logger.log(`  ✓ ${succeeded.join(', ')}`);
  if (failedByReason.size > 0) {
    logger.log(`Failed: ${orgs.length - succeeded.length} org(s)`);
    for (const [reason, failedOrgs] of failedByReason) {
      logger.log(`  ✗ ${reason}`);
      logger.log(`    affected: ${failedOrgs.join(', ')}`);
    }
  }
  logger.log('');

  if (succeeded.length === 0 && orgs.length > 0) {
    logger.error(`Install failed: 0 of ${orgs.length} orgs registered. Fix the errors above, then run 'npx mgr runner install' again.`);
    process.exitCode = 1;
    return;
  }

  logger.log('Install complete. The watcher will auto-register new orgs as they become available.');
  logger.log(`Run 'npx mgr runner status' any time to check service health.`);
}

// ─── register-org ───────────────────────────────────────────────────────────────
async function registerOrg(options) {
  ensureWindows();
  ensureGhToken();

  const org = options._?.[2] || options.org;
  if (!org) throw new Error('Usage: npx mgr runner register-org <org-name>');

  const { getOctokit } = require('../utils/github.js');
  const octokit = getOctokit();

  // Fetch a runner registration token (1-hour expiry, used immediately).
  let regToken;
  try {
    const { data } = await octokit.rest.actions.createRegistrationTokenForOrg({ org });
    regToken = data.token;
  } catch (e) {
    if (e.status === 403) {
      throw new Error(`GH_TOKEN lacks admin:org scope for ${org}. Classic PATs need 'admin:org' (full) for runner registration. Re-issue at https://github.com/settings/tokens.`);
    }
    throw e;
  }

  // Per-org actions-runner directory. Each registration writes config files at the top of
  // its dir; sharing one dir across orgs would race + clobber. Cost: ~120 MB per org on disk.
  const orgRunnerDir = path.join(RUNNER_HOME, `actions-runner-${org.toLowerCase()}`);
  if (!jetpack.exists(path.join(orgRunnerDir, 'config.cmd'))) {
    const templateDir = options._templateDir || path.join(RUNNER_HOME, '_template');
    if (!jetpack.exists(path.join(templateDir, 'config.cmd'))) {
      throw new Error(`actions/runner template not found at ${templateDir}. Run 'npx mgr runner install' first.`);
    }
    logger.log(`  Cloning actions-runner template → actions-runner-${org.toLowerCase()}/`);
    jetpack.copy(templateDir, orgRunnerDir, { overwrite: true });
  }

  const configCmd = path.join(orgRunnerDir, 'config.cmd');
  const svcCmd    = path.join(orgRunnerDir, 'svc.cmd');
  const runnerName = `em-runner-${os.hostname().toLowerCase()}-${org.toLowerCase()}`.slice(0, 64);   // GH max 64 chars
  // Note: NOT passing --runasservice. That flag is silently ignored when --windowslogonaccount
  // and --windowslogonpassword aren't provided too, leaving the runner registered with GH but
  // with no Windows service to actually run it. We use the explicit two-step flow below
  // (config.cmd to register, then svc.cmd install + start) which is the supported path.
  const args = [
    '--unattended',
    '--url',    `https://github.com/${org}`,
    '--token',  regToken,
    '--name',   runnerName,
    '--labels', RUNNER_LABELS.join(','),
    '--replace',
  ];

  // Run via `cmd.exe /c` instead of `shell: true`. .cmd files can't be spawned directly
  // by Node's CreateProcess on Windows, so we need cmd.exe as the shell — but `shell: true`
  // triggers Node 24's DEP0190 deprecation warning when args are passed as an array.
  // Explicit `cmd.exe /c <script> <args>` is the supported, warning-free path.
  const { spawnSync } = require('child_process');
  logger.log(`Registering against ${org} (cwd: ${orgRunnerDir})…`);
  const r = spawnSync('cmd.exe', ['/c', configCmd, ...args], {
    cwd:      orgRunnerDir,
    stdio:    ['ignore', 'pipe', 'pipe'],   // capture so we can surface real errors
    encoding: 'utf8',
    timeout:  120000,                        // 2 min hard cap
  });

  if (r.error) {
    throw new Error(`Could not spawn config.cmd: ${r.error.message}`);
  }
  if (r.status !== 0) {
    const stdoutTail = (r.stdout || '').trim().split('\n').slice(-10).join('\n');
    const stderrTail = (r.stderr || '').trim().split('\n').slice(-10).join('\n');
    const detail = [
      stdoutTail && `stdout: ${stdoutTail}`,
      stderrTail && `stderr: ${stderrTail}`,
    ].filter(Boolean).join('\n');
    throw new Error(`config.cmd exited ${r.status === null ? 'null (killed)' : r.status} for ${org}.\n${detail || '(no output captured)'}`);
  }

  // Install + start the Windows service that actually RUNS the runner agent. config.cmd
  // only registers the runner with GitHub; without this step the runner shows online in
  // GH's UI for ~30s then goes offline and jobs queue forever. svc.cmd is the bundled
  // helper from actions/runner that wraps `sc.exe create` with the right binary path.
  const svcInstall = spawnSync('cmd.exe', ['/c', svcCmd, 'install'], {
    cwd:      orgRunnerDir,
    stdio:    ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout:  60000,
  });
  if (svcInstall.status !== 0) {
    const tail = ((svcInstall.stdout || '') + (svcInstall.stderr || '')).trim().split('\n').slice(-8).join('\n');
    throw new Error(`svc.cmd install failed for ${org} (exit ${svcInstall.status}):\n${tail}`);
  }

  const svcStart = spawnSync('cmd.exe', ['/c', svcCmd, 'start'], {
    cwd:      orgRunnerDir,
    stdio:    ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout:  60000,
  });
  if (svcStart.status !== 0) {
    const tail = ((svcStart.stdout || '') + (svcStart.stderr || '')).trim().split('\n').slice(-8).join('\n');
    // Don't fail hard — the service is installed, user can start it manually if start failed.
    logger.warn(`svc.cmd start failed for ${org} (exit ${svcStart.status}): ${tail}`);
  }

  // Track in our config.
  const cfg = readConfig();
  cfg.registeredOrgs = Array.from(new Set([...(cfg.registeredOrgs || []), org]));
  saveConfig(cfg);

  logger.log(`✓ Registered + service installed for ${org}`);
}

// ─── start / stop / status ──────────────────────────────────────────────────────
async function startServices() {
  ensureWindows();
  const services = listActionsRunnerServices();
  if (services.length === 0) {
    logger.warn('No actions.runner.* services installed. Run `npx mgr runner install` first.');
  }
  for (const name of services) {
    const r = scControl('start', name);
    logger.log(`${r.ok ? '✓' : '✗'} start ${name}${r.ok ? '' : ` — ${r.message}`}`);
  }
  const watcher = scControl('start', WATCHER_SERVICE_NAME);
  logger.log(`${watcher.ok ? '✓' : '✗'} start ${WATCHER_SERVICE_NAME}${watcher.ok ? '' : ` — ${watcher.message}`}`);
}

async function stopServices() {
  ensureWindows();
  const services = listActionsRunnerServices();
  for (const name of services) {
    const r = scControl('stop', name);
    logger.log(`${r.ok ? '✓' : '✗'} stop ${name}${r.ok ? '' : ` — ${r.message}`}`);
  }
  const watcher = scControl('stop', WATCHER_SERVICE_NAME);
  logger.log(`${watcher.ok ? '✓' : '✗'} stop ${WATCHER_SERVICE_NAME}${watcher.ok ? '' : ` — ${watcher.message}`}`);
}

async function statusServices() {
  ensureWindows();
  const cfg = readConfig();
  logger.log(`em-runner home: ${RUNNER_HOME}`);
  logger.log(`Installed: ${cfg.installedAt || '(not yet)'}`);
  logger.log(`Labels: ${(cfg.labels || RUNNER_LABELS).join(', ')}`);
  logger.log(`Registered orgs: ${(cfg.registeredOrgs || []).join(', ') || '(none)'}`);
  logger.log('');

  // Per-org runner services.
  const services = listActionsRunnerServices();
  if (services.length === 0) {
    logger.warn('No actions.runner.* services installed.');
    logger.warn('Run `npx mgr runner install` to create them — registration alone is not enough.');
  } else {
    logger.log(`Runner services (${services.length}):`);
    for (const name of services) {
      const state = scState(name);
      const symbol = state === 'RUNNING' ? '✓' : state === 'STOPPED' ? '·' : '?';
      logger.log(`  ${symbol} ${name} — ${state}`);
    }
  }

  // Watcher service.
  const watcherState = scState(WATCHER_SERVICE_NAME);
  const watcherSymbol = watcherState === 'RUNNING' ? '✓' : watcherState === 'STOPPED' ? '·' : '?';
  logger.log('');
  logger.log(`Watcher service:`);
  logger.log(`  ${watcherSymbol} ${WATCHER_SERVICE_NAME} — ${watcherState}`);
}

// ─── uninstall ──────────────────────────────────────────────────────────────────
async function uninstall() {
  ensureWindows();
  ensureWindowsAdmin();

  // Stop + delete em-runner-watcher service. node-windows knows its own service
  // metadata (script, name, etc.) — let it do the removal cleanly. This handles
  // the lock-on-files issue better than raw `sc delete`.
  await uninstallWatcherService();

  // Stop + delete each actions.runner.* service. We discover them via `sc query`
  // since each service is named per-org.
  await uninstallActionsRunnerServices();

  // Deregister each org-side runner if we have a token and a working config.cmd.
  const runnerDir = path.join(RUNNER_HOME, 'actions-runner');
  const configCmd = path.join(runnerDir, 'config.cmd');
  if (jetpack.exists(configCmd)) {
    const ghToken = process.env.GH_TOKEN;
    if (ghToken) {
      const { getOctokit } = require('../utils/github.js');
      const octokit = getOctokit();
      const cfg = readConfig();
      for (const org of cfg.registeredOrgs || []) {
        try {
          const { data } = await octokit.rest.actions.createRemoveTokenForOrg({ org });
          const { spawnSync } = require('child_process');
          spawnSync(configCmd, ['remove', '--token', data.token], { cwd: runnerDir, stdio: 'inherit' });
        } catch (e) {
          logger.warn(`Could not deregister from ${org}: ${e.message}`);
        }
      }
    }
  }

  // Now safe to remove disk state. Retry a few times if files are still locked
  // (services release file handles asynchronously after stop).
  await removeRunnerHomeWithRetry();
  logger.log('Uninstalled em-runner.');
}

async function uninstallWatcherService() {
  // Quick check: does the service exist? Avoid noisy 1060 errors on a clean uninstall.
  const exists = await scQueryExists(WATCHER_SERVICE_NAME);
  if (!exists) return;

  // Use node-windows' own uninstall — it handles both "stop" and "delete" plus the
  // daemon dir cleanup that raw `sc delete` doesn't touch.
  let Service;
  try {
    Service = require('node-windows').Service;
  } catch (e) {
    // No node-windows here? Fall back to raw sc.
    await runScCommand('stop',   WATCHER_SERVICE_NAME);
    await runScCommand('delete', WATCHER_SERVICE_NAME);
    return;
  }

  const watcherDir = path.join(RUNNER_HOME, 'watcher');
  const svc = new Service({
    name:        WATCHER_SERVICE_NAME,
    description: 'electron-manager runner watcher',
    script:      path.join(watcherDir, 'watcher.js'),
  });

  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    svc.on('uninstall', finish);
    svc.on('alreadyuninstalled', finish);
    svc.on('error', (e) => {
      logger.warn(`watcher service uninstall warning: ${e.message}`);
      finish();
    });
    try {
      svc.uninstall();
    } catch (e) {
      logger.warn(`watcher service uninstall threw: ${e.message}`);
      finish();
    }
    // Hard timeout — don't hang forever if events don't fire.
    setTimeout(finish, 15000);
  });
}

async function uninstallActionsRunnerServices() {
  const { spawnSync } = require('child_process');
  // sc query state= all returns all services; grep for "actions.runner.".
  const r = spawnSync('sc', ['query', 'state=', 'all'], { encoding: 'utf8' });
  if (r.status !== 0) return;
  const names = (r.stdout || '').match(/SERVICE_NAME:\s*(actions\.runner\.\S+)/g) || [];
  for (const n of names) {
    const name = n.replace(/SERVICE_NAME:\s*/, '').trim();
    logger.log(`Removing leftover service ${name}…`);
    spawnSync('sc', ['stop',   name], { stdio: 'inherit' });
    spawnSync('sc', ['delete', name], { stdio: 'inherit' });
  }
}

async function scQueryExists(serviceName) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('sc', ['query', serviceName], { encoding: 'utf8' });
  return r.status === 0;
}

async function removeRunnerHomeWithRetry() {
  // Services release file handles asynchronously — give them a few seconds.
  for (let i = 0; i < 5; i++) {
    try {
      jetpack.remove(RUNNER_HOME);
      return;
    } catch (e) {
      if (i === 4) {
        logger.warn(`Could not fully remove ${RUNNER_HOME} after 5 attempts: ${e.message}`);
        logger.warn('Some files may be locked by other processes. Reboot Windows and re-run install if this persists.');
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ─── self-update ────────────────────────────────────────────────────────────────
async function selfUpdate() {
  const { execute } = require('node-powertools');
  logger.log('Updating electron-manager to latest…');
  try {
    const out = await execute('npm i -g electron-manager@latest');
    logger.log(out);
    logger.log('✓ electron-manager updated.');
  } catch (e) {
    logger.warn(`Self-update failed: ${e.message}`);
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────────

const WATCHER_SERVICE_NAME = 'em-runner-watcher';

function ensureWindows() {
  if (process.platform !== 'win32' && !process.env.EM_RUNNER_FORCE) {
    throw new Error('This command only runs on Windows. Set EM_RUNNER_FORCE=1 to override (testing only).');
  }
}

function ensureGhToken() {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN env var required. Classic PAT needs scopes: repo + workflow + admin:org. Set it before running runner commands.');
  }
}

// Service install/start/stop on Windows requires admin. Without it, `sc` commands silently
// fail with status 1060 ("service not found") which sends us down weird debugging paths.
// Detect early and exit with a clear message.
function ensureWindowsAdmin() {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');
  // `net session` requires admin and exits 0 if elevated, non-zero otherwise. Faster than spawning powershell.
  const r = spawnSync('net', ['session'], { stdio: 'ignore' });
  if (r.status !== 0) {
    throw new Error('This command needs an elevated cmd.exe (Run as Administrator). Service install/uninstall and `sc` commands fail silently without admin rights.');
  }
}

async function downloadActionsRunner(runnerDir) {
  const url = `https://github.com/actions/runner/releases/download/v${ACTIONS_RUNNER_VERSION}/actions-runner-win-x64-${ACTIONS_RUNNER_VERSION}.zip`;
  const zipPath = path.join(RUNNER_HOME, 'actions-runner.zip');
  jetpack.dir(runnerDir);
  logger.log(`Downloading actions/runner v${ACTIONS_RUNNER_VERSION}…`);

  // curl ships on Windows 10+ and macOS. -L follows GitHub's redirect to the S3 download URL,
  // -f fails on HTTP errors (so we don't write an HTML error page as "the zip"), -o writes
  // to disk directly (no in-memory buffering, no truncation issues with large files).
  const { spawnSync } = require('child_process');
  const dl = spawnSync('curl', ['-fL', '-o', zipPath, url], { stdio: 'inherit' });
  if (dl.status !== 0) {
    throw new Error(`Failed to download actions-runner.zip (curl exit ${dl.status}). Check network or curl.exe availability.`);
  }

  // Sanity-check size before extracting — actions/runner zip is ~150 MB. Anything under 1 MB
  // is almost certainly an error page that slipped through.
  const stat = fs.statSync(zipPath);
  if (stat.size < 1024 * 1024) {
    const head = fs.readFileSync(zipPath, 'utf8').slice(0, 200);
    throw new Error(`Downloaded actions-runner.zip is only ${stat.size} bytes — likely an error page. First 200 bytes: ${head}`);
  }
  logger.log(`Downloaded ${(stat.size / 1024 / 1024).toFixed(1)} MB → extracting…`);

  // Extract via tar (BSD tar ships with Windows 10+ and macOS — handles zip natively).
  const t = spawnSync('tar', ['-xf', zipPath, '-C', runnerDir], { stdio: 'inherit' });
  if (t.status !== 0) {
    throw new Error(`Failed to extract actions-runner.zip (tar exit ${t.status}). On Windows ensure tar.exe is on PATH (it is by default on Windows 10+).`);
  }
  jetpack.remove(zipPath);
  logger.log(`Extracted actions/runner → ${runnerDir}`);
}

async function discoverAdminOrgs() {
  const { getOctokit } = require('../utils/github.js');
  const octokit = getOctokit();
  if (!octokit) return [];
  const orgs = [];
  try {
    const { data } = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 });
    for (const org of data) {
      try {
        // membership endpoint shows our role.
        const { data: m } = await octokit.rest.orgs.getMembershipForAuthenticatedUser({ org: org.login });
        if (m.role === 'admin') orgs.push(org.login);
      } catch (e) { /* skip if can't read */ }
    }
  } catch (e) {
    logger.warn(`Could not list orgs: ${e.message}`);
  }
  return orgs;
}

async function installWatcherService() {
  const watcherDir  = path.join(RUNNER_HOME, 'watcher');
  jetpack.dir(watcherDir);

  // Copy our own watcher.js into the watcher dir so it's stable across `npm i -g electron-manager` upgrades.
  // Each tick, the watcher re-resolves the latest EM and runs it — gives self-update for free.
  const sourceWatcher = path.join(__dirname, '..', 'runner', 'watcher.js');
  jetpack.copy(sourceWatcher, path.join(watcherDir, 'watcher.js'), { overwrite: true });

  // node-windows is the canonical "install Node script as Windows service" lib. Lazy-loaded.
  let Service;
  try {
    Service = require('node-windows').Service;
  } catch (e) {
    throw new Error('node-windows missing. Run `npm i -g node-windows` on the Windows box, then re-run `npx mgr runner install`.');
  }

  // Bake RUNNER_HOME into the service env so the watcher resolves the same paths the
  // install used, regardless of what its cwd ends up being once Windows starts the service.
  const svc = new Service({
    name:        WATCHER_SERVICE_NAME,
    description: 'electron-manager runner watcher (auto-registers new GitHub orgs to the EV-token runner)',
    script:      path.join(watcherDir, 'watcher.js'),
    nodeOptions: [],
    workingDirectory: watcherDir,
    env: [
      { name: 'GH_TOKEN',       value: process.env.GH_TOKEN },
      { name: 'EM_RUNNER_HOME', value: RUNNER_HOME },
      ...(process.env.EM_RUNNER_ORGS ? [{ name: 'EM_RUNNER_ORGS', value: process.env.EM_RUNNER_ORGS }] : []),
    ],
  });

  return new Promise((resolve, reject) => {
    svc.on('install',     () => { logger.log(`Installed Windows service: ${WATCHER_SERVICE_NAME}`); svc.start(); });
    svc.on('alreadyinstalled', () => { logger.log(`Service ${WATCHER_SERVICE_NAME} already installed`); resolve(); });
    svc.on('start',       () => { logger.log(`Started ${WATCHER_SERVICE_NAME}`); resolve(); });
    svc.on('error',       (e) => reject(e));
    svc.install();
  });
}

// Enumerate all `actions.runner.*` services on this machine (one per registered org).
// Uses `sc query state= all` (note the space — that's the documented form) to get every
// service including stopped ones, then filters by SERVICE_NAME prefix.
function listActionsRunnerServices() {
  if (process.platform !== 'win32') return [];
  const { spawnSync } = require('child_process');
  const r = spawnSync('sc', ['query', 'state=', 'all'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const out = r.stdout || '';
  const names = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^SERVICE_NAME:\s*(actions\.runner\..+)$/.exec(line.trim());
    if (m) names.push(m[1]);
  }
  return names.sort();
}

// Run `sc <action> <name>`. Returns { ok, message }. Doesn't print — caller decides format.
// Used by start/stop. `query` is a separate path because we want to parse the state.
function scControl(action, name) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('sc', [action, name], { encoding: 'utf8' });
  // sc exit codes are weird:
  //   0      — success (started/stopped/queried)
  //   1056   — service already running (start)
  //   1062   — service not started (stop on already-stopped)
  //   1060   — service not found
  // Treat 0/1056/1062 as success.
  const ok = r.status === 0 || r.status === 1056 || r.status === 1062;
  const message = (r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ').trim() || `exit ${r.status}`;
  return { ok, message, exitCode: r.status };
}

// Parse the current STATE from `sc query <name>`. Returns 'RUNNING' | 'STOPPED' | 'NOT_INSTALLED' | 'UNKNOWN'.
function scState(name) {
  if (process.platform !== 'win32') return 'UNKNOWN';
  const { spawnSync } = require('child_process');
  const r = spawnSync('sc', ['query', name], { encoding: 'utf8' });
  if (r.status === 1060) return 'NOT_INSTALLED';
  if (r.status !== 0) return 'UNKNOWN';
  const out = r.stdout || '';
  const m = /STATE\s*:\s*\d+\s+(\w+)/.exec(out);
  return m ? m[1].toUpperCase() : 'UNKNOWN';
}

function readConfig() {
  const file = path.join(RUNNER_HOME, 'config.json');
  if (!jetpack.exists(file)) return {};
  return jetpack.read(file, 'json') || {};
}

function saveConfig(data) {
  const file = path.join(RUNNER_HOME, 'config.json');
  const cur  = readConfig();
  jetpack.write(file, { ...cur, ...data });
}

// Exports for testing.
module.exports.RUNNER_LABELS = RUNNER_LABELS;
module.exports.ACTIONS_RUNNER_VERSION = ACTIONS_RUNNER_VERSION;
