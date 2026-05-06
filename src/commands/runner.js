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
//   set-credentials      Save Windows account credentials for the runner service.
//                        Encrypted via DPAPI, only the current user can decrypt.
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

// Per-org runner is registered as a Scheduled Task (not a Windows Service) named
// `em-runner-<host>-<org>`. Tasks run in the user's INTERACTIVE session (Session 1)
// at logon, which is the only context that can both (a) read the user's
// CurrentUser\My cert store where SafeNet/eToken EV certs live and (b) host the
// SafeNet "Token Logon" PIN dialog so automately can type into it. Windows
// services run in Session 0 (no desktop) and fail at both. Task name is the same
// as the GH-side runner name so debugging stays sane.
function runnerTaskName(org) {
  return `em-runner-${os.hostname().toLowerCase()}-${org.toLowerCase()}`.slice(0, 64);
}
// Runner files default to C:\actions-runners on Windows so the runner service (running
// as NT AUTHORITY\NETWORK SERVICE) can read them without icacls gymnastics. User-profile
// paths (C:\Users\<user>\...) deny NETWORK SERVICE by default, and actions/runner walks
// the FULL path hierarchy at startup checking traversal — denying anywhere kills it.
// Override via EM_RUNNER_HOME if you want them somewhere else.
function defaultRunnerHome() {
  if (process.platform === 'win32') return 'C:\\actions-runners';
  return path.join(process.cwd(), '.gh-runners');
}
const RUNNER_HOME = process.env.EM_RUNNER_HOME || defaultRunnerHome();
const ACTIONS_RUNNER_VERSION = '2.319.1';   // pinned; bump intentionally

module.exports = async function (options) {
  options = options || {};
  const sub = (options._ && options._[1]) || 'status';

  switch (sub) {
    case 'install':         return install(options);
    case 'register-org':    return registerOrg(options);
    case 'start':           return startServices(options);
    case 'stop':            return stopServices(options);
    case 'status':          return statusServices(options);
    case 'uninstall':       return uninstall(options);
    case 'set-credentials': return setCredentials(options);
    case 'self-update':     return selfUpdate(options);
    case 'monitor':         return monitor(options);
    default:
      logger.error(`Unknown subcommand: "${sub}". Try one of: install, register-org, start, stop, status, uninstall, self-update, monitor.`);
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

  // 3a. Fetch logon credentials ONCE (env > DPAPI file > prompt). Reused across all
  //     orgs below so the user isn't prompted N times. Used to specify which user's
  //     interactive session each Logon Task runs in. Defaults to the current user
  //     when nothing is configured.
  const logonCreds = await getLogonCredentials();
  if (logonCreds) {
    logger.log(`Logon Tasks will run as ${logonCreds.account} (creds source: ${logonCreds.source}).`);
  } else {
    logger.log(`Logon Tasks will run as ${os.userInfo().username} (current user — no creds configured).`);
  }

  // 3b. For each org: copy the template dir, run config.cmd inside it, register as service.
  const succeeded = [];
  const failedByReason = new Map();
  for (const org of orgs) {
    try {
      await registerOrg({ ...options, _: ['runner', 'register-org', org], _templateDir: templateDir, logonCreds });
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

// ─── set-credentials ────────────────────────────────────────────────────────────
async function setCredentials(options) {
  ensureWindows();
  const creds = await promptForLogonCredentials();
  saveLogonCredentials(creds);
  logger.log(`✓ Credentials saved (encrypted via DPAPI) for ${creds.account}.`);
  logger.log('Re-run `npx mgr runner install` to apply them to the runner services.');
}

// ─── register-org ───────────────────────────────────────────────────────────────
async function registerOrg(options) {
  ensureWindows();
  ensureGhToken();

  const org = options._?.[2] || options.org;
  if (!org) throw new Error('Usage: npx mgr runner register-org <org-name>');

  const { getOctokit } = require('../utils/github.js');
  const octokit = getOctokit();

  // Delete any existing runners on the org side that match our naming convention for
  // THIS host. Without this, re-running install accumulates orphaned runners (one per
  // failed/aborted install, one per host rename, etc.) which causes actions/runner to
  // auto-suffix the new runner's name (e.g. `-2872`) and breaks our ability to predict
  // service names. Match prefix is `em-runner-<host>-<org>` so we never touch user-
  // created runners or runners from other hosts.
  //
  // We do this BEFORE fetching the registration token because the token is one-shot
  // and we want it fresh right before config.cmd uses it.
  const hostPrefix    = `em-runner-${os.hostname().toLowerCase()}-${org.toLowerCase()}`;
  try {
    const { data: existing } = await octokit.rest.actions.listSelfHostedRunnersForOrg({ org, per_page: 100 });
    const ours = (existing.runners || []).filter((r) => (r.name || '').toLowerCase().startsWith(hostPrefix));
    for (const r of ours) {
      try {
        await octokit.rest.actions.deleteSelfHostedRunnerFromOrg({ org, runner_id: r.id });
        logger.log(`  Deleted stale runner ${r.name} (id=${r.id}) on ${org}`);
      } catch (e) {
        logger.warn(`  Failed to delete stale runner ${r.name} (id=${r.id}): ${e.message}`);
      }
    }
  } catch (e) {
    // 403 here means GH_TOKEN can list but not delete — surface it but continue. Worst
    // case: actions/runner auto-suffixes and the user gets a working but ugly-named runner.
    logger.warn(`  Could not list/delete existing runners for ${org}: ${e.message}`);
  }

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
  //
  // Always nuke + re-clone from _template. Otherwise stale config (.runner, .credentials,
  // _diag/) from a prior failed/partial run sticks around — and on the next install,
  // config.cmd refuses with "Cannot configure the runner because it is already configured."
  // Reusing the dir was an attempt at idempotency that broke re-install. Fresh dir per
  // install is the only reliably-clean state.
  const orgRunnerDir = path.join(RUNNER_HOME, `actions-runner-${org.toLowerCase()}`);
  const templateDir  = options._templateDir || path.join(RUNNER_HOME, '_template');
  if (!jetpack.exists(path.join(templateDir, 'config.cmd'))) {
    throw new Error(`actions/runner template not found at ${templateDir}. Run 'npx mgr runner install' first.`);
  }
  if (jetpack.exists(orgRunnerDir)) {
    logger.log(`  Removing stale actions-runner-${org.toLowerCase()}/ before re-clone…`);
    jetpack.remove(orgRunnerDir);
  }
  logger.log(`  Cloning actions-runner template → actions-runner-${org.toLowerCase()}/`);
  jetpack.copy(templateDir, orgRunnerDir, { overwrite: true });

  const configCmd = path.join(orgRunnerDir, 'config.cmd');
  const runnerName = runnerTaskName(org);   // same name on GH side + Task Scheduler side

  // config.cmd registers the runner against GH and writes .runner / .credentials
  // into the per-org dir. We do NOT pass --runasservice anymore — service-mode
  // runners run in Session 0 (no desktop, no access to the user's CurrentUser\My
  // cert store) and signtool can't see EV certs there. Instead we create a
  // Scheduled Task below that runs run.cmd in the user's interactive session
  // when they log on. See runnerTaskName() for context.
  const args = [
    '--unattended',
    '--url',          `https://github.com/${org}`,
    '--token',        regToken,
    '--name',         runnerName,
    '--labels',       RUNNER_LABELS.join(','),
    '--replace',
  ];

  // Logon credentials are still supported (env / DPAPI file / interactive prompt)
  // and used to specify which user's session the Logon Task runs in. Defaults to
  // the current invoking user — same behavior most consumers expect.
  const logonCreds = options.logonCreds !== undefined
    ? options.logonCreds
    : await getLogonCredentials();
  const taskAccount = (logonCreds && logonCreds.account) || os.userInfo().username;
  if (logonCreds) {
    logger.log(`  Logon Task will run as ${logonCreds.account} (creds source: ${logonCreds.source})`);
  } else {
    logger.log(`  Logon Task will run as ${taskAccount} (current user — no creds configured)`);
  }

  // Run via `cmd.exe /c` instead of `shell: true`. .cmd files can't be spawned directly
  // by Node's CreateProcess on Windows, so we need cmd.exe as the shell — but `shell: true`
  // triggers Node 24's DEP0190 deprecation warning when args are passed as an array.
  // Explicit `cmd.exe /c <script> <args>` is the supported, warning-free path.
  //
  // stdio: 'inherit' — config.cmd's --runasservice service-install path silently
  // SKIPS service creation when stdout/stderr are piped (Node captures them and the
  // child sees no console). With inherit, the runner's banner + progress + service
  // install messages stream directly to the user's terminal and the install actually
  // happens. Discovered the hard way after several "registered but no service" rounds.
  const { spawnSync } = require('child_process');
  logger.log(`Registering against ${org} (cwd: ${orgRunnerDir})…`);
  const r = spawnSync('cmd.exe', ['/c', configCmd, ...args], {
    cwd:      orgRunnerDir,
    stdio:    'inherit',
    timeout:  180000,                        // 3 min — config.cmd does network + service install
  });

  if (r.error) {
    throw new Error(`Could not spawn config.cmd: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(`config.cmd exited ${r.status === null ? 'null (killed)' : r.status} for ${org}. See output above.`);
  }

  // Verify config.cmd actually wrote the registration files. Without these the
  // runner can't authenticate with GH at run time.
  if (!jetpack.exists(path.join(orgRunnerDir, '.runner')) || !jetpack.exists(path.join(orgRunnerDir, '.credentials'))) {
    throw new Error(`config.cmd succeeded but .runner / .credentials are missing in ${orgRunnerDir}. The runner is not configured.`);
  }

  // Create the Scheduled Task that runs `run.cmd` in the user's interactive session
  // at logon. /SC ONLOGON + /RU <user> binds the task to that user's logon session
  // (Session 1+, with desktop access) — exactly what's needed for signtool to see
  // the EV cert and for automately to type the SafeNet PIN. /RL HIGHEST runs with
  // the user's elevated token (matches what an "Run as administrator" cmd would
  // get) which is needed for some npm/electron-builder operations.
  const taskName = runnerTaskName(org);
  createRunnerLogonTask({
    taskName,
    runnerDir: orgRunnerDir,
    account:   taskAccount,
    password:  (logonCreds && logonCreds.password) || null,
  });

  // Fire the task immediately so the runner is online RIGHT NOW. Without this,
  // ONLOGON tasks stay in "Ready, not Running" state until the user logs out
  // and back in — which means every fresh `mgr runner install` leaves the
  // runner offline on GH for hours. schtasks /Run uses the same elevation we
  // already verified via ensureWindowsAdmin() in the install() entry point, so
  // no extra prompts. We log a warning (not throw) on failure: registration is
  // still valid; the user can recover with `schtasks /Run /TN <name>` or by
  // logging out and back in.
  const startResult = runTask(taskName);
  if (startResult.ok) {
    logger.log(`  ✓ Started Logon Task: ${taskName}`);
  } else {
    logger.warn(`  ✗ Could not start Logon Task ${taskName} (exit ${startResult.exitCode}): ${startResult.message}`);
    logger.warn(`    Run 'schtasks /Run /TN ${taskName}' manually from an elevated cmd, or log out and back in.`);
  }

  // Track in our config.
  const cfg = readConfig();
  cfg.registeredOrgs = Array.from(new Set([...(cfg.registeredOrgs || []), org]));
  saveConfig(cfg);

  logger.log(`✓ Registered runner + Logon Task '${taskName}' created and started for ${org}`);
}

// ─── start / stop / status ──────────────────────────────────────────────────────
async function startServices() {
  ensureWindows();
  const tasks = listEmRunnerTasks();
  if (tasks.length === 0) {
    logger.warn('No em-runner-* Logon Tasks installed. Run `npx mgr runner install` first.');
  }
  for (const name of tasks) {
    const r = runTask(name);
    logger.log(`${r.ok ? '✓' : '✗'} start ${name}${r.ok ? '' : ` — ${r.message}`}`);
  }
  // Watcher remains a service for now (it lives in Session 0 and just orchestrates
  // org registration; it doesn't sign anything itself).
  const watcher = scControl('start', WATCHER_SERVICE_NAME);
  if (watcher.exitCode !== 1060) {
    logger.log(`${watcher.ok ? '✓' : '✗'} start ${WATCHER_SERVICE_NAME}${watcher.ok ? '' : ` — ${watcher.message}`}`);
  }
}

async function stopServices() {
  ensureWindows();
  const tasks = listEmRunnerTasks();
  for (const name of tasks) {
    const r = endTask(name);
    logger.log(`${r.ok ? '✓' : '✗'} stop ${name}${r.ok ? '' : ` — ${r.message}`}`);
  }
  const watcher = scControl('stop', WATCHER_SERVICE_NAME);
  if (watcher.exitCode !== 1060) {
    logger.log(`${watcher.ok ? '✓' : '✗'} stop ${WATCHER_SERVICE_NAME}${watcher.ok ? '' : ` — ${watcher.message}`}`);
  }
}

async function statusServices() {
  ensureWindows();
  const cfg = readConfig();
  logger.log(`em-runner home: ${RUNNER_HOME}`);
  logger.log(`Installed: ${cfg.installedAt || '(not yet)'}`);
  logger.log(`Labels: ${(cfg.labels || RUNNER_LABELS).join(', ')}`);
  logger.log(`Registered orgs: ${(cfg.registeredOrgs || []).join(', ') || '(none)'}`);
  logger.log('');

  // Per-org runner Logon Tasks.
  const tasks = listEmRunnerTasks();
  if (tasks.length === 0) {
    logger.warn('No em-runner-* Logon Tasks installed.');
    logger.warn('Run `npx mgr runner install` to create them — registration alone is not enough.');
  } else {
    logger.log(`Runner Logon Tasks (${tasks.length}):`);
    for (const name of tasks) {
      const state = taskState(name);
      const symbol = state === 'RUNNING' ? '✓' : state === 'READY' ? '·' : '?';
      logger.log(`  ${symbol} ${name} — ${state}`);
    }
  }

  // Surface any leftover legacy services so users can clean them up.
  const legacy = listActionsRunnerServices();
  if (legacy.length > 0) {
    logger.log('');
    logger.warn(`Legacy actions.runner.* services detected (${legacy.length}). These are leftovers from the old service-mode runner and should be removed via 'npx mgr runner uninstall'.`);
    for (const name of legacy) logger.log(`  · ${name}`);
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

  // End + delete each em-runner-<host>-<org> Logon Task.
  await uninstallActionsRunnerTasks();

  // Stop + delete any leftover legacy actions.runner.* services from old EM
  // versions that registered runners as Windows services. Idempotent — no-op
  // if there are none.
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

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Logon Task management (replaces service mode for runner job execution) ────
//
// Each per-org runner is registered as a Scheduled Task triggered "At log on of
// <user>" with "Run with highest privileges". The task is a thin wrapper that
// cd's to the runner dir and execs run.cmd. Tasks run in the user's interactive
// session (Session 1+), where:
//   - signtool can read the user's CurrentUser\My cert store
//   - SafeNet's Token Logon PIN dialog can render on the desktop
//   - automately can find that dialog and type the PIN
//
// Trade-off: the user must be logged in on the Windows host for the runner to
// pick up jobs. With Windows auto-logon enabled (one-time setup), this is a
// non-issue on a dedicated build box.

// Create (or replace) a Logon Task for a runner.
//   /SC ONLOGON       — fire when the named user logs on
//   /RU <account>     — run as that user (their session is the one that triggers)
//   /RP <password>    — only required when account != current invoking user
//   /RL HIGHEST       — run with the user's elevated token (matches admin cmd)
//   /F                — force overwrite if a task with this name already exists
//   /TR "..."         — the action to run; we wrap run.cmd so cwd is set correctly
function createRunnerLogonTask({ taskName, runnerDir, account, password }) {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');

  const runCmd = path.join(runnerDir, 'run.cmd');
  if (!jetpack.exists(runCmd)) {
    throw new Error(`Cannot create Logon Task — run.cmd not found at ${runCmd}.`);
  }

  // /TR is the action to execute. We exec run.cmd directly (no `cmd /c` wrapper,
  // no `cd /d` — actions/runner's run.cmd uses %~dp0 to find its own helpers, so
  // cwd doesn't matter). Wrapping in `cmd /c "...&&..."` was the obvious thing
  // to try first, but schtasks's /TR parser eats the `&&` even when fully
  // quoted, so we keep it simple. The path is double-quoted to handle spaces.
  const tr = `"${runCmd}"`;

  // /IT is critical: marks the task as INTERACTIVE, meaning it binds to the
  // /RU user's existing logged-on interactive session at run time instead of
  // creating a fresh non-interactive batch logon for them. Without /IT, the
  // task spawns in a separate non-interactive session that has its own (empty)
  // view of the user's cert store — signtool then fails with "No certificates
  // were found that met all the given criteria" even though the same cert is
  // visible in the user's actual desktop session. /IT also ensures the
  // SafeNet eToken Token Logon dialog, when triggered, renders on the user's
  // visible desktop where automately can find and type into it.
  // Cost: the task only runs while the user is logged on. With Windows
  // auto-logon configured (one-time), this is a non-issue on a dedicated box.
  //
  // /RL HIGHEST is intentionally omitted: signtool, npm install, electron-builder,
  // and automately keystroke injection don't require elevated tokens, and /RL
  // HIGHEST is what triggers schtasks's "Access is denied" without explicit
  // admin elevation at install time. ensureWindowsAdmin() still requires admin
  // to create ONLOGON tasks at all (Windows policy), but we don't escalate
  // beyond that.
  const args = [
    '/Create',
    '/TN', taskName,
    '/SC', 'ONLOGON',
    '/RU', account,
    '/IT',
    '/TR', tr,
    '/F',
  ];
  // Password is only needed if the task's RU differs from the invoking user, OR
  // if you want the task to be runnable when no one is interactively logged in
  // (which we don't — ONLOGON inherently requires a logon event). Pass it when
  // we have it for safety, omit otherwise.
  if (password) {
    args.push('/RP', password);
  }

  const r = spawnSync('schtasks', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim().slice(0, 500);
    throw new Error(`schtasks /Create failed (exit ${r.status}) for ${taskName}: ${msg}`);
  }
  logger.log(`  ✓ Logon Task created: ${taskName} (RU=${account}, runs run.cmd in ${runnerDir})`);
}

// Run a task immediately (don't wait for the next logon trigger). Useful for
// `mgr runner start` and for the initial install so the user doesn't have to
// log out + log back in before jobs are picked up.
function runTask(taskName) {
  if (process.platform !== 'win32') return { ok: false, message: 'not-windows' };
  const { spawnSync } = require('child_process');
  const r = spawnSync('schtasks', ['/Run', '/TN', taskName], { encoding: 'utf8' });
  return {
    ok: r.status === 0,
    message: (r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ').trim() || `exit ${r.status}`,
    exitCode: r.status,
  };
}

// End a running task instance. Used by `mgr runner stop`. Note: this terminates
// the current run; if the user logs out + back in, the task fires again per its
// ONLOGON trigger. To prevent that, the task itself must be deleted (uninstall).
function endTask(taskName) {
  if (process.platform !== 'win32') return { ok: false, message: 'not-windows' };
  const { spawnSync } = require('child_process');
  const r = spawnSync('schtasks', ['/End', '/TN', taskName], { encoding: 'utf8' });
  return {
    ok: r.status === 0,
    message: (r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ').trim() || `exit ${r.status}`,
    exitCode: r.status,
  };
}

// Returns 'RUNNING' | 'READY' | 'NOT_INSTALLED' | 'UNKNOWN'.
// schtasks /Query /TN <name> /FO LIST prints "Status:  Running" or "Ready" etc.
function taskState(taskName) {
  if (process.platform !== 'win32') return 'UNKNOWN';
  const { spawnSync } = require('child_process');
  const r = spawnSync('schtasks', ['/Query', '/TN', taskName, '/FO', 'LIST'], { encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = (r.stderr || '').toLowerCase();
    if (msg.includes('cannot find') || msg.includes('does not exist')) return 'NOT_INSTALLED';
    return 'UNKNOWN';
  }
  const out = r.stdout || '';
  const m = /^Status:\s*(\w+)/m.exec(out);
  return m ? m[1].toUpperCase() : 'UNKNOWN';
}

// Enumerate all em-runner-* Logon Tasks. Uses schtasks /Query /FO CSV /NH which
// gives us TaskName,Next Run Time,Status — we just need the first column.
function listEmRunnerTasks() {
  if (process.platform !== 'win32') return [];
  const { spawnSync } = require('child_process');
  const r = spawnSync('schtasks', ['/Query', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const names = new Set();
  for (const rawLine of (r.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // CSV first field — strip leading quote, take up to next quote.
    const m = /^"([^"]+)"/.exec(line);
    if (!m) continue;
    // schtasks output prefixes task path with "\" if at root: e.g. \em-runner-...
    const tn = m[1].replace(/^\\/, '');
    if (/^em-runner-/i.test(tn)) names.add(tn);
  }
  return [...names].sort();
}

async function uninstallActionsRunnerTasks() {
  const tasks = listEmRunnerTasks();
  if (tasks.length === 0) return;
  const { spawnSync } = require('child_process');
  for (const name of tasks) {
    logger.log(`Removing Logon Task ${name}…`);
    spawnSync('schtasks', ['/End',    '/TN', name],          { stdio: 'ignore' }); // best-effort end
    const r = spawnSync('schtasks', ['/Delete', '/TN', name, '/F'], { encoding: 'utf8' });
    if (r.status !== 0) {
      logger.warn(`  schtasks /Delete failed for ${name} (exit ${r.status}): ${(r.stderr || '').trim().slice(0, 200)}`);
    } else {
      logger.log(`  ✓ Deleted ${name}`);
    }
  }
}

// ─── runner service logon credentials ───────────────────────────────────────
//
// The runner service runs as NT AUTHORITY\NETWORK SERVICE by default, but that
// account has its own (empty) Windows cert store, so signtool can't see EV-
// token certs imported under the user's CurrentUser\My. Solution: install the
// service to run AS the user instead. config.cmd accepts:
//   --windowslogonaccount <user> --windowslogonpassword <pass>
//
// To avoid making the user re-enter their password every install, EM stores
// the password encrypted via Windows DPAPI (only the current user can decrypt
// it; even another admin on the same box can't). Stored at
// %APPDATA%\electron-manager\runner-logon.json
//
// Three ways to supply credentials, in priority order:
//   1. WIN_RUNNER_LOGON_ACCOUNT + WIN_RUNNER_LOGON_PASSWORD env vars (CI/.env)
//   2. The DPAPI-encrypted file at %APPDATA%\electron-manager\runner-logon.json
//   3. Interactive prompt (only when neither of the above exist + stdin is a TTY)
//
// If we end up with nothing, fall back to NETWORK SERVICE (current behavior).

const LOGON_FILE = process.platform === 'win32'
  ? path.join(process.env.APPDATA || os.homedir(), 'electron-manager', 'runner-logon.json')
  : path.join(os.homedir(), '.electron-manager', 'runner-logon.json');

async function getLogonCredentials() {
  // 1. Env vars take precedence (CI / .env-driven automation).
  const envAcct = process.env.WIN_RUNNER_LOGON_ACCOUNT;
  const envPass = process.env.WIN_RUNNER_LOGON_PASSWORD;
  if (envAcct && envPass) {
    return { account: envAcct, password: envPass, source: 'env' };
  }

  // 2. DPAPI-encrypted file from a prior `set-credentials` or `install` run.
  if (jetpack.exists(LOGON_FILE)) {
    try {
      const decrypted = readEncryptedLogonFile();
      if (decrypted && decrypted.account && decrypted.password) {
        return { ...decrypted, source: 'dpapi' };
      }
    } catch (e) {
      logger.warn(`Could not read saved logon credentials: ${e.message}`);
    }
  }

  // 3. Interactive prompt (only if stdin is a real TTY — never in CI / piped contexts).
  if (process.stdin.isTTY) {
    const creds = await promptForLogonCredentials();
    saveLogonCredentials(creds);
    return { ...creds, source: 'prompt' };
  }

  return null;
}

async function promptForLogonCredentials() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  logger.log('');
  logger.log('Runner service logon credentials needed (so signtool can access your CurrentUser cert store).');
  logger.log(`Use your Windows username (e.g. ${os.userInfo().username} or DOMAIN\\${os.userInfo().username}).`);

  const account = (await ask(`Account [${os.userInfo().username}]: `)).trim() || os.userInfo().username;

  // Hide password input by manually managing readline output.
  process.stdout.write('Password: ');
  rl.history = rl.history || [];
  const password = await new Promise((resolve) => {
    let buf = '';
    const onData = (ch) => {
      const code = ch.toString();
      if (code === '\r' || code === '\n' || code === '\r\n') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        resolve(buf);
      } else if (code === '') { // Ctrl+C
        process.stdin.setRawMode(false);
        process.exit(130);
      } else if (code === '' || code === '\b') { // backspace
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        buf += code;
        process.stdout.write('*');
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });

  rl.close();
  return { account, password };
}

function saveLogonCredentials({ account, password }) {
  jetpack.dir(path.dirname(LOGON_FILE));
  const encryptedPassword = dpapiProtect(password);
  jetpack.write(LOGON_FILE, {
    account,
    encryptedPassword,
    savedAt: new Date().toISOString(),
  });
}

function readEncryptedLogonFile() {
  const data = jetpack.read(LOGON_FILE, 'json');
  if (!data || !data.account || !data.encryptedPassword) return null;
  return { account: data.account, password: dpapiUnprotect(data.encryptedPassword) };
}

// DPAPI via PowerShell. ConvertFrom-SecureString without -Key uses the current
// user's DPAPI scope by default — encrypted blob can only be decrypted by the
// same user on the same machine.
function dpapiProtect(plaintext) {
  if (process.platform !== 'win32') return Buffer.from(plaintext, 'utf8').toString('base64');
  const { spawnSync } = require('child_process');
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$s = ConvertTo-SecureString -String $env:EM_DPAPI_INPUT -AsPlainText -Force; ConvertFrom-SecureString -SecureString $s`,
  ], {
    encoding: 'utf8',
    env: { ...process.env, EM_DPAPI_INPUT: plaintext },
  });
  if (r.status !== 0) {
    throw new Error(`DPAPI encrypt failed: ${(r.stderr || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

function dpapiUnprotect(encryptedBlob) {
  if (process.platform !== 'win32') return Buffer.from(encryptedBlob, 'base64').toString('utf8');
  const { spawnSync } = require('child_process');
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$s = ConvertTo-SecureString -String $env:EM_DPAPI_INPUT; [System.Net.NetworkCredential]::new('', $s).Password`,
  ], {
    encoding: 'utf8',
    env: { ...process.env, EM_DPAPI_INPUT: encryptedBlob },
  });
  if (r.status !== 0) {
    throw new Error(`DPAPI decrypt failed: ${(r.stderr || '').trim()}`);
  }
  return (r.stdout || '').replace(/\r?\n$/, '');
}

// Grant NT AUTHORITY\NETWORK SERVICE read+execute on `targetDir` recursively.
// The runner service runs as NETWORK SERVICE; it walks its install path's full
// hierarchy at startup and crashes if any ancestor denies traversal. By installing
// to C:\actions-runners by default (RUNNER_HOME), we avoid all the user-profile
// issues — but we still grant explicit RX on the runner dir for safety/idempotency
// (in case something downstream removes inherited perms).
function grantNetworkServiceAccess(targetDir) {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');
  const r = spawnSync('icacls', [targetDir, '/grant', 'NT AUTHORITY\\NETWORK SERVICE:(OI)(CI)(RX)', '/T', '/C', '/Q'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    logger.warn(`  icacls on ${targetDir} exited ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
  }
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

// ─── monitor ────────────────────────────────────────────────────────────────────
//
// `npx mgr runner monitor` — pretty-prints the JSONL signing event log in real time.
//
// Reads the same path `sign-windows` writes to:
//   1. EM_SIGN_LOG env var (override) — wins if set
//   2. <RUNNER_TOOLSDIRECTORY>/em-signing.log — when on the GH Actions runner box
//   3. <process.cwd()>/em-signing.log — fallback
//
// Designed to run from a regular PowerShell / cmd / Windows Terminal session on the
// signing box. Reads the file, prints existing events first (so you see context if
// signing already started), then watches for new lines via fs.watchFile + offset
// tracking. No fancy deps.
async function monitor(options) {
  options = options || {};
  const signEvents = require('../lib/sign-helpers/sign-events.js');
  const file = options.file || signEvents.getLogPath();
  const followOnly = !!options['follow-only'];

  logger.log(`Watching: ${file}`);
  logger.log('(monitoring ALL signing requests across every org/repo on this machine)');
  if (!fs.existsSync(file)) {
    // Make sure the parent dir exists so events written before monitor sees the file
    // don't fail (sign-events.js handles its own write errors, but pre-creating the dir
    // avoids a confusing "waiting forever" UX when EM_RUNNER_HOME hasn't been used yet).
    try {
      jetpack.dir(path.dirname(file));
    } catch (_) { /* best-effort */ }
    logger.log('(file does not exist yet — waiting for first sign event...)');
  }

  // Track byte offset so we only print new lines on each poll. Initialize to either
  // 0 (replay everything) or the file's current size (--follow-only — only show new
  // events).
  let pos = followOnly && fs.existsSync(file)
    ? fs.statSync(file).size
    : 0;

  let inFlight = false;
  let buffer = '';

  function pump() {
    if (inFlight) return;
    if (!fs.existsSync(file)) return;
    inFlight = true;
    const stream = fs.createReadStream(file, { start: pos });
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) renderLine(line);
        pos += Buffer.byteLength(line, 'utf8') + 1;
      }
    });
    stream.on('end', () => { inFlight = false; });
    stream.on('error', (e) => {
      inFlight = false;
      logger.warn(`monitor read failed: ${e.message}`);
    });
  }

  pump();

  // Watch for size changes. fs.watchFile polls (default 5s) which is fine here —
  // we don't need sub-second latency on a sign-monitor.
  fs.watchFile(file, { interval: 500 }, (curr, prev) => {
    // File rotated / truncated — reset.
    if (curr.size < pos) {
      pos = 0;
      buffer = '';
      logger.log('(log truncated — replaying from start)');
    }
    if (curr.size > pos) pump();
  });

  // Keep alive forever.
  await new Promise(() => {});
}

function renderLine(jsonLine) {
  let evt;
  try {
    evt = JSON.parse(jsonLine);
  } catch (_) {
    process.stdout.write(`[??] ${jsonLine}\n`);
    return;
  }

  const ts = (evt.ts || '').replace('T', ' ').replace('Z', '');
  const dur = typeof evt.duration_ms === 'number' ? ` (${formatDuration(evt.duration_ms)})` : '';
  const fmt = logger.format || {};
  const c = (col, str) => (fmt[col] ? fmt[col](str) : str);

  switch (evt.event) {
    case 'job-start':
      process.stdout.write(`\n${c('cyan', '━'.repeat(60))}\n`);
      process.stdout.write(`${c('cyan', `[${ts}] JOB START`)}`);
      if (evt.github_run_id)   process.stdout.write(c('gray', ` run=${evt.github_run_id}`));
      if (evt.github_workflow) process.stdout.write(c('gray', ` workflow=${evt.github_workflow}`));
      if (evt.runner_workspace) process.stdout.write(c('gray', ` workspace=${evt.runner_workspace}`));
      process.stdout.write('\n');
      break;
    case 'job-end':
      const ok = evt.ok ? c('green', 'OK') : c('red', 'FAILED');
      process.stdout.write(`${c('cyan', `[${ts}] JOB END ${ok}${dur}`)}\n`);
      if (evt.error) process.stdout.write(`  ${c('red', evt.error)}\n`);
      process.stdout.write(`${c('cyan', '━'.repeat(60))}\n`);
      break;
    case 'sign-start':
      process.stdout.write(`[${ts}] ${c('yellow', '→')} sign ${c('white', evt.file)}`);
      if (typeof evt.bytes === 'number') process.stdout.write(c('gray', ` (${formatBytes(evt.bytes)})`));
      process.stdout.write(c('gray', ` mode=${evt.mode}`));
      process.stdout.write('\n');
      break;
    case 'sign-done':
      process.stdout.write(`[${ts}] ${c('green', '✓')} signed ${c('white', evt.file)}${c('gray', dur)}\n`);
      break;
    case 'sign-fail':
      process.stdout.write(`[${ts}] ${c('red', '✗')} FAILED ${c('white', evt.file)} ${c('gray', `(phase:${evt.phase}${dur})`)}\n`);
      if (evt.error) process.stdout.write(`  ${c('red', evt.error)}\n`);
      break;
    default:
      process.stdout.write(`[${ts}] ${evt.event} ${JSON.stringify(evt)}\n`);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

// Exports for testing.
module.exports.RUNNER_LABELS = RUNNER_LABELS;
module.exports.ACTIONS_RUNNER_VERSION = ACTIONS_RUNNER_VERSION;
