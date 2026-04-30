// `npx mgr runner <subcommand>` — Windows EV-token signing runner manager.
//
// Lives outside any consumer project (run from a globally-installed EM on the Windows box).
// One-time bootstrap downloads actions/runner, registers as Windows service, kicks off the
// em-runner-watcher daemon. Watcher polls GH for orgs the user is admin in, auto-registers
// runners for any new org so the user never touches the Windows box after bootstrap.
//
// Subcommands:
//   bootstrap            One-time setup: install actions/runner + watcher service.
//   register-org <org>   Manually register the runner against a specific GH org.
//   start                Start the runner + watcher services.
//   stop                 Stop them.
//   status               Show service status, registered orgs, watcher state.
//   uninstall            Remove everything.
//   self-update          Force an immediate self-update of EM (npm i -g electron-manager@latest).
//
// All commands except `bootstrap` and `register-org` are no-ops on non-Windows platforms.

const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const jetpack  = require('fs-jetpack');

const Manager  = new (require('../build.js'));
const logger   = Manager.logger('runner');

const RUNNER_LABELS = ['self-hosted', 'windows', 'ev-token'];
const RUNNER_HOME   = path.join(os.homedir(), '.em-runner');
const ACTIONS_RUNNER_VERSION = '2.319.1';   // pinned; bump intentionally

module.exports = async function (options) {
  options = options || {};
  const sub = (options._ && options._[1]) || 'status';

  switch (sub) {
    case 'bootstrap':    return bootstrap(options);
    case 'register-org': return registerOrg(options);
    case 'start':        return startServices(options);
    case 'stop':          return stopServices(options);
    case 'status':       return statusServices(options);
    case 'uninstall':    return uninstall(options);
    case 'self-update':  return selfUpdate(options);
    default:
      logger.error(`Unknown subcommand: "${sub}". Try one of: bootstrap, register-org, start, stop, status, uninstall, self-update.`);
      throw new Error(`Unknown runner subcommand: ${sub}`);
  }
};

// ─── bootstrap ──────────────────────────────────────────────────────────────────
async function bootstrap(options) {
  ensureWindows();
  ensureGhToken();

  logger.log(`Bootstrapping em-runner under ${RUNNER_HOME}`);
  jetpack.dir(RUNNER_HOME);

  // 1. Download actions/runner if not present.
  const runnerDir = path.join(RUNNER_HOME, 'actions-runner');
  if (!jetpack.exists(path.join(runnerDir, 'config.cmd'))) {
    await downloadActionsRunner(runnerDir);
  } else {
    logger.log(`actions/runner already installed at ${runnerDir}`);
  }

  // 2. Discover orgs the GH_TOKEN has admin on.
  const orgs = await discoverAdminOrgs();
  if (orgs.length === 0) {
    logger.warn('Your GH_TOKEN has no orgs you can admin. The watcher will register orgs as you gain access.');
  } else {
    logger.log(`Detected ${orgs.length} admin org(s): ${orgs.join(', ')}`);
  }

  // 3. Register against each org (idempotent — skips if already registered with our labels).
  for (const org of orgs) {
    try {
      await registerOrg({ ...options, _: ['runner', 'register-org', org] });
    } catch (e) {
      logger.warn(`register-org ${org} failed: ${e.message}`);
    }
  }

  // 4. Install the em-runner-watcher service.
  await installWatcherService();

  // 5. Save bootstrap metadata so other commands know we've been set up.
  saveConfig({
    bootstrappedAt: new Date().toISOString(),
    actionsRunnerVersion: ACTIONS_RUNNER_VERSION,
    labels: RUNNER_LABELS,
  });

  logger.log('Bootstrap complete. The watcher will auto-register new orgs as they become available.');
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
      throw new Error(`GH_TOKEN lacks admin:org scope for ${org}. Re-issue the token at https://github.com/settings/tokens with admin:org checked.`);
    }
    throw e;
  }

  // Run actions/runner config.cmd to register against this org.
  const runnerDir = path.join(RUNNER_HOME, 'actions-runner');
  const configCmd = path.join(runnerDir, 'config.cmd');
  if (!jetpack.exists(configCmd)) {
    throw new Error(`actions/runner not installed yet. Run 'npx mgr runner bootstrap' first.`);
  }

  const { spawnSync } = require('child_process');
  const args = [
    '--unattended',
    '--url',    `https://github.com/${org}`,
    '--token',  regToken,
    '--name',   `em-runner-${os.hostname().toLowerCase()}-${org}`,
    '--labels', RUNNER_LABELS.join(','),
    '--runasservice',
    '--replace',
  ];
  logger.log(`Registering against ${org}…`);
  const r = spawnSync(configCmd, args, { cwd: runnerDir, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`config.cmd exited ${r.status} while registering ${org}`);

  // Track in our config.
  const cfg = readConfig();
  cfg.registeredOrgs = Array.from(new Set([...(cfg.registeredOrgs || []), org]));
  saveConfig(cfg);

  logger.log(`✓ Registered runner against ${org}`);
}

// ─── start / stop / status ──────────────────────────────────────────────────────
async function startServices() {
  ensureWindows();
  await runScCommand('start', actionsRunnerServiceName());
  await runScCommand('start', WATCHER_SERVICE_NAME);
}

async function stopServices() {
  ensureWindows();
  await runScCommand('stop', actionsRunnerServiceName());
  await runScCommand('stop', WATCHER_SERVICE_NAME);
}

async function statusServices() {
  ensureWindows();
  const cfg = readConfig();
  logger.log(`em-runner home: ${RUNNER_HOME}`);
  logger.log(`Bootstrapped: ${cfg.bootstrappedAt || '(not yet)'}`);
  logger.log(`Labels: ${(cfg.labels || RUNNER_LABELS).join(', ')}`);
  logger.log(`Registered orgs: ${(cfg.registeredOrgs || []).join(', ') || '(none)'}`);
  logger.log('');
  logger.log('Service states:');
  await runScCommand('query', actionsRunnerServiceName());
  await runScCommand('query', WATCHER_SERVICE_NAME);
}

// ─── uninstall ──────────────────────────────────────────────────────────────────
async function uninstall() {
  ensureWindows();
  await runScCommand('stop',   WATCHER_SERVICE_NAME);
  await runScCommand('delete', WATCHER_SERVICE_NAME);

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

  jetpack.remove(RUNNER_HOME);
  logger.log('Uninstalled em-runner.');
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

function actionsRunnerServiceName() {
  // actions/runner installs as `actions.runner.<owner>.<runner-name>` per registration.
  // For status we just match the prefix; sc query supports wildcards via `sc query type= service`
  // but we'll just return the canonical prefix and let runScCommand do its best.
  return 'actions.runner';
}

function ensureWindows() {
  if (process.platform !== 'win32' && !process.env.EM_RUNNER_FORCE) {
    throw new Error('This command only runs on Windows. Set EM_RUNNER_FORCE=1 to override (testing only).');
  }
}

function ensureGhToken() {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN env var required. Set it (with admin:org scope) before running runner commands.');
  }
}

async function downloadActionsRunner(runnerDir) {
  const wonderfulFetch = require('wonderful-fetch');
  const url = `https://github.com/actions/runner/releases/download/v${ACTIONS_RUNNER_VERSION}/actions-runner-win-x64-${ACTIONS_RUNNER_VERSION}.zip`;
  const zipPath = path.join(RUNNER_HOME, 'actions-runner.zip');
  jetpack.dir(runnerDir);
  logger.log(`Downloading actions/runner v${ACTIONS_RUNNER_VERSION}…`);
  const res = await wonderfulFetch(url, { response: 'buffer', tries: 3 });
  fs.writeFileSync(zipPath, Buffer.isBuffer(res) ? res : Buffer.from(res));

  // Extract via PowerShell (built-in on Windows).
  const { spawnSync } = require('child_process');
  const ps = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${runnerDir}" -Force`,
  ], { stdio: 'inherit' });
  if (ps.status !== 0) throw new Error(`Failed to extract actions-runner.zip (PowerShell exit ${ps.status})`);
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
    throw new Error('node-windows missing. Run `npm i -g node-windows` on the Windows box, then re-run bootstrap.');
  }

  const svc = new Service({
    name:        WATCHER_SERVICE_NAME,
    description: 'electron-manager runner watcher (auto-registers new GitHub orgs to the EV-token runner)',
    script:      path.join(watcherDir, 'watcher.js'),
    nodeOptions: [],
    workingDirectory: watcherDir,
    env: [{ name: 'GH_TOKEN', value: process.env.GH_TOKEN }],
  });

  return new Promise((resolve, reject) => {
    svc.on('install',     () => { logger.log(`Installed Windows service: ${WATCHER_SERVICE_NAME}`); svc.start(); });
    svc.on('alreadyinstalled', () => { logger.log(`Service ${WATCHER_SERVICE_NAME} already installed`); resolve(); });
    svc.on('start',       () => { logger.log(`Started ${WATCHER_SERVICE_NAME}`); resolve(); });
    svc.on('error',       (e) => reject(e));
    svc.install();
  });
}

async function runScCommand(action, name) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const child = spawn('sc', [action, name], { stdio: 'inherit' });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
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
