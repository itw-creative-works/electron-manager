// `npx mgr runner <subcommand>` — Windows EV-token signing runner manager.
//
// v1.2.36+: install runs entirely at user privilege (RUNNER_HOME is in
// %LOCALAPPDATA%, no admin prompts, no UAC), and at end of install the
// runner foregrounds in the calling terminal so its output is streamed
// where the user invoked the command. Auto-restart at next logon is wired
// up via a .cmd file in the user's Startup folder.
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
// Runner files live under %LOCALAPPDATA%\em-runner — a per-user path that
// doesn't need admin to read/write. v1.2.16-v1.2.35 used C:\actions-runners
// (root C:) which forced UAC elevation for every install/uninstall + spawned
// the runner in a separate elevated cmd window. With per-user storage we drop
// elevation entirely: install, register-org, start, and uninstall all run in
// the user's normal terminal, the runner foregrounds in that same terminal,
// and Ctrl+C stops it cleanly. Set EM_RUNNER_HOME to override.
function defaultRunnerHome() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'em-runner');
  }
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
  // No more ensureWindowsAdmin: RUNNER_HOME is per-user (%LOCALAPPDATA%\em-runner),
  // config.cmd registers without --runasservice (so no SCM access), and the
  // Startup folder shortcut goes in the user's profile. Net: install runs in
  // the calling terminal at normal user privilege.

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

  // 4. The em-runner-watcher service is intentionally NOT installed in v1.2.35+.
  // The watcher's job was to auto-register new admin orgs by shelling
  // `mgr runner register-org <org>` on a 1-minute tick — but it runs as
  // NT AUTHORITY\NETWORK SERVICE in Session 0, which means:
  //   - its detached `run.cmd` spawns inherit Session 0 (no cert visibility)
  //   - the Startup folder shortcuts it writes go to NETWORK SERVICE's
  //     profile, not the user's — so they never trigger at user logon
  // Both make it actively harmful to the v1.2.35 design. Adding new orgs is
  // now a manual `mgr runner install` away. uninstall() still tears down any
  // leftover watcher service from older installs.

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

  logger.log('Install complete. Auto-restart at next logon is wired up via the Startup folder shortcut.');

  // 7. Hand off to the runner: take over the calling terminal (`stdio: inherit`
  // streams the listener's output here, Ctrl+C stops it). For non-interactive
  // contexts (CI, scripts, schtasks-launched) we do NOT block — the Startup
  // folder shortcut will spawn the runner at the next interactive logon.
  // Single-org foreground for now: if multiple orgs registered, we foreground
  // the first and rely on the Startup shortcuts to bring the rest up at next
  // logon. (For our current use case there's only one org per host.)
  if (process.stdin.isTTY && succeeded.length > 0) {
    const firstOrg     = succeeded[0];
    const orgRunnerDir = path.join(RUNNER_HOME, `actions-runner-${firstOrg.toLowerCase()}`);
    const runCmd       = path.join(orgRunnerDir, 'run.cmd');
    if (succeeded.length > 1) {
      logger.log(`Note: ${succeeded.length} orgs registered; foregrounding ${firstOrg} now. Other runner(s) will auto-start at next logon.`);
    }
    logger.log('');
    logger.log(`Starting runner for ${firstOrg} in this terminal — press Ctrl+C to stop.`);
    logger.log('');
    const { spawnSync } = require('child_process');
    spawnSync('cmd.exe', ['/c', runCmd], {
      cwd: process.env.WINDIR || 'C:\\Windows',
      stdio: 'inherit',
    });
  } else {
    logger.log(`Run 'npx mgr runner start' to bring the runner online now, or log out + back in.`);
  }
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

  // Write the .cmd shortcut in the user's Startup folder so Explorer auto-runs
  // it at every interactive logon (Session 1). No Task Scheduler, no admin
  // needed for the trigger. The runner name is intentionally the same as
  // older versions used for the Logon Task — keeps debugging hooks
  // consistent across upgrades.
  //
  // We do NOT spawn the runner here. install() (when invoked interactively)
  // foregrounds run.cmd in the calling terminal AFTER the registration loop
  // completes, so the user sees its output streaming in their own shell.
  // For non-interactive invocations (e.g. someone calling register-org
  // directly from a script) the runner stays dormant until the next logon
  // fires the Startup shortcut, or until `mgr runner start` is invoked.
  const runnerNameForShortcut = runnerTaskName(org);
  writeRunnerStartupShortcut({ runnerName: runnerNameForShortcut, runnerDir: orgRunnerDir });

  // Track in our config.
  const cfg = readConfig();
  cfg.registeredOrgs = Array.from(new Set([...(cfg.registeredOrgs || []), org]));
  saveConfig(cfg);

  logger.log(`✓ Registered runner '${runnerNameForShortcut}' for ${org} (auto-starts at logon via Startup folder)`);
}

// ─── start / stop / status ──────────────────────────────────────────────────────
async function startServices() {
  ensureWindows();
  const shortcuts = listRunnerStartupShortcuts();
  if (shortcuts.length === 0) {
    logger.warn('No em-runner-* Startup shortcuts installed. Run `npx mgr runner install` first.');
    return;
  }
  // Map the first shortcut name back to its runner dir. The shortcut naming
  // convention is em-runner-<host>-<org>; the org dir is actions-runner-<org>.
  // Hostname can contain dashes (e.g. desktop-ifl07vg), so we strip a known
  // host prefix rather than assume the host segment is dash-free.
  const runnerName = shortcuts[0];
  const hostPrefix = `em-runner-${os.hostname().toLowerCase()}-`;
  let orgName = null;
  if (runnerName.toLowerCase().startsWith(hostPrefix)) {
    orgName = runnerName.slice(hostPrefix.length);
  }
  const runnerDir = orgName ? path.join(RUNNER_HOME, `actions-runner-${orgName.toLowerCase()}`) : null;
  if (!runnerDir || !jetpack.exists(runnerDir)) {
    logger.warn(`✗ Could not resolve runner dir from shortcut name ${runnerName}`);
    return;
  }
  if (shortcuts.length > 1) {
    logger.log(`Note: ${shortcuts.length} runners registered; foregrounding ${runnerName} now. Others auto-start at next logon via their Startup shortcuts.`);
  }
  const runCmd = path.join(runnerDir, 'run.cmd');
  if (process.stdin.isTTY) {
    // Foreground: take over the calling terminal so the user sees the listener
    // output and can Ctrl+C to stop. Same UX as `npm start` etc.
    logger.log(`Starting runner ${runnerName} in this terminal — press Ctrl+C to stop.`);
    logger.log('');
    const { spawnSync } = require('child_process');
    spawnSync('cmd.exe', ['/c', runCmd], {
      cwd: process.env.WINDIR || 'C:\\Windows',
      stdio: 'inherit',
    });
  } else {
    // Non-TTY (script / scheduled task / piped invocation): detach so the
    // caller doesn't block forever.
    const r = spawnRunnerDetached(runnerDir);
    logger.log(`${r.ok ? '✓' : '✗'} start ${runnerName}${r.ok ? ` (PID=${r.pid})` : ` — ${r.message}`}`);
  }
}

async function stopServices() {
  ensureWindows();
  // Stopping = killing all Runner.Listener.exe processes whose path lives
  // under RUNNER_HOME. /T also kills any Runner.Worker.exe children mid-job.
  // Startup shortcuts are left in place so a logout/login still re-spawns;
  // for a permanent stop, run `mgr runner uninstall`.
  const procs = listRunnerListenerProcessesUnder(RUNNER_HOME);
  if (procs.length === 0) {
    logger.log('No Runner.Listener.exe processes under RUNNER_HOME — already stopped.');
  } else {
    const { spawnSync } = require('child_process');
    for (const { pid, execPath } of procs) {
      const k = spawnSync('taskkill', ['/F', '/PID', String(pid), '/T'], { encoding: 'utf8' });
      if (k.status === 0) {
        logger.log(`  ✓ Killed PID ${pid} (${execPath})`);
      } else {
        logger.warn(`  ✗ taskkill ${pid} (exit ${k.status}): ${(k.stderr || '').trim().slice(0, 200)}`);
      }
    }
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

  // Per-org Startup shortcuts (auto-start at every logon).
  const shortcuts = listRunnerStartupShortcuts();
  if (shortcuts.length === 0) {
    logger.warn('No em-runner-* Startup shortcuts installed.');
    logger.warn('Run `npx mgr runner install` to create them — registration alone is not enough.');
  } else {
    logger.log(`Runner Startup shortcuts (${shortcuts.length}):`);
    for (const name of shortcuts) {
      logger.log(`  · ${name}.cmd → ${runnerStartupFile(name)}`);
    }
  }

  // Currently-running Runner.Listener.exe processes under RUNNER_HOME.
  logger.log('');
  const procs = listRunnerListenerProcessesUnder(RUNNER_HOME);
  if (procs.length === 0) {
    logger.warn('No Runner.Listener.exe processes are running under RUNNER_HOME.');
    logger.warn('Run `npx mgr runner start` to spawn them, or log out and back in.');
  } else {
    logger.log(`Running runners (${procs.length}):`);
    for (const { pid, sessionId, execPath } of procs) {
      const symbol = sessionId === 0 ? '⚠' : '✓';
      const pathStr = execPath || '(path unavailable — likely NETWORK SERVICE zombie from older watcher)';
      logger.log(`  ${symbol} PID=${pid} session=${sessionId} ${pathStr}`);
    }
    if (procs.some((p) => p.sessionId === 0)) {
      logger.warn('  ⚠ Runner in Session 0 cannot see CurrentUser\\My cert store. Kill it (`mgr runner stop`) and re-spawn from Session 1.');
    }
  }

  // Surface leftover legacy services so users can clean them up.
  const legacyServices = listActionsRunnerServices();
  if (legacyServices.length > 0) {
    logger.log('');
    logger.warn(`Legacy actions.runner.* services detected (${legacyServices.length}). Run 'npx mgr runner uninstall' to remove them.`);
    for (const name of legacyServices) logger.log(`  · ${name}`);
  }

  // Surface a leftover watcher service if one is still installed from older
  // EM versions — v1.2.35+ doesn't install it, but upgraders may have one.
  const watcherState = scState(WATCHER_SERVICE_NAME);
  if (watcherState !== 'NOT_INSTALLED') {
    logger.log('');
    logger.warn(`Legacy watcher service detected: ${WATCHER_SERVICE_NAME} (${watcherState}). v1.2.35+ doesn't use it. Run 'npx mgr runner uninstall' to remove.`);
  }
}

// ─── uninstall ──────────────────────────────────────────────────────────────────
async function uninstall(options) {
  ensureWindows();
  // No more ensureWindowsAdmin. Per-user RUNNER_HOME removal, killing your own
  // Runner.Listener.exe processes, and deleting Startup-folder shortcuts all
  // work without admin. Legacy cleanup paths (watcher service, Logon Tasks)
  // still need admin to delete fully — when not admin we attempt them anyway
  // and simply log warnings on failure rather than blocking the uninstall.

  // Stop + delete em-runner-watcher service. node-windows knows its own service
  // metadata (script, name, etc.) — let it do the removal cleanly. This handles
  // the lock-on-files issue better than raw `sc delete`.
  await uninstallWatcherService();

  // Delete each em-runner-<host>-<org>.cmd file in the user's Startup folder
  // so the runner doesn't auto-spawn at next logon.
  const shortcuts = listRunnerStartupShortcuts();
  for (const runnerName of shortcuts) {
    const removed = removeRunnerStartupShortcut(runnerName);
    if (removed) logger.log(`  ✓ Removed Startup shortcut: ${runnerName}.cmd`);
  }

  // Idempotent legacy cleanup: any em-runner-* Scheduled Tasks left over from
  // v1.2.16–v1.2.34 (which used Logon Tasks) still need to be removed so they
  // don't keep spawning Session 0 zombies after upgrade.
  await uninstallLegacyLogonTasks();

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

  // Kill any Runner.Listener.exe processes whose path lives under RUNNER_HOME
  // BEFORE we try to remove the directory. These are usually leftovers from the
  // legacy "double-click run.cmd" workflow (foreground runners not registered as
  // a Scheduled Task or service) — uninstall otherwise has no way to know about
  // them, and their open file handles inside the runner dirs will fail
  // jetpack.remove with EPERM. Also catches Runner.Listener instances spawned by
  // a currently-running Logon Task that `schtasks /End` (above) may have raced.
  killRunnerListenerProcessesUnderHome();

  // Now safe to remove disk state. Retry a few times if files are still locked
  // (services release file handles asynchronously after stop).
  await removeRunnerHomeWithRetry();
  logger.log('Uninstalled em-runner.');
}

async function uninstallWatcherService() {
  // Quick check: does the service exist? Avoid noisy 1060 errors on a clean uninstall.
  const exists = await scQueryExists(WATCHER_SERVICE_NAME);
  if (!exists) return;

  const { spawnSync } = require('child_process');

  // CRITICAL: clear the failure-action config FIRST. node-windows configures
  // the watcher with restart-on-failure, so a plain `sc stop` triggers SCM
  // to immediately respawn it, defeating the uninstall. We blank the restart
  // policy first, THEN stop, THEN kill any stragglers, THEN delete.
  // (We used to use node-windows' own svc.uninstall(), but it left the
  // service running in v1.2.34, kept spawning rogue Runner.Listener.exe in
  // Session 0, and the recursive uninstall called from install() then hit
  // EPERM trying to remove RUNNER_HOME.)
  spawnSync('sc', ['failure', WATCHER_SERVICE_NAME, 'reset=', '0', 'actions='], { stdio: 'ignore' });
  spawnSync('sc', ['stop', WATCHER_SERVICE_NAME], { stdio: 'ignore' });

  // The watcher's wrapper executable is `emrunnerwatcher.exe` (node-windows
  // names the daemon after the service). Force-kill any process by that
  // name + any node.exe child whose CommandLine references watcher.js, in
  // case SCM's stop didn't fully take.
  spawnSync('taskkill', ['/F', '/IM', 'emrunnerwatcher.exe', '/T'], { stdio: 'ignore' });
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*watcher.js*' } | ForEach-Object { $_.ProcessId }`,
  ], { encoding: 'utf8' });
  if (r.status === 0) {
    for (const line of (r.stdout || '').split(/\r?\n/)) {
      const pid = line.trim();
      if (/^\d+$/.test(pid)) {
        spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { stdio: 'ignore' });
      }
    }
  }

  // Now safe to delete the service definition.
  spawnSync('sc', ['delete', WATCHER_SERVICE_NAME], { stdio: 'ignore' });
  logger.log(`  ✓ Removed legacy watcher service: ${WATCHER_SERVICE_NAME}`);
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
        // Try to name the offending process. Sysinternals handle.exe (if on PATH)
        // gives us the holder. Otherwise we tell the user how to install it for
        // next time, so failures here don't keep being "files may be locked" with
        // no actionable info.
        identifyHandleHolders(RUNNER_HOME);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Find Runner.Listener.exe instances and force-kill them with `taskkill /F /T`
// (the /T also kills Runner.Worker.exe children from in-flight jobs).
// Critical for uninstall — without this, jetpack.remove(RUNNER_HOME) fails
// with EPERM whenever a Runner.Listener has open file handles in the dir.
//
// Path filter: when Get-CimInstance can read the process's ExecutablePath, we
// skip anything OUTSIDE RUNNER_HOME so unrelated runner installs aren't
// touched. When ExecutablePath comes back empty — which happens for processes
// owned by NETWORK SERVICE / LocalSystem even from an elevated query, since
// those tokens don't grant ProcessVmRead by default — we kill anyway. Those
// path-unavailable instances are almost always zombies left by the v1.2.16-
// v1.2.34 watcher service (which spawned register-org subprocesses as
// NETWORK SERVICE), and during uninstall we want them gone.
function killRunnerListenerProcessesUnderHome() {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');

  // Get-CimInstance is the modern wmic replacement. ProcessId | ExecutablePath
  // gives us both fields in one shot, separated by '|' for easy parsing.
  const r = spawnSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`,
  ], { encoding: 'utf8' });
  if (r.status !== 0) return;

  const targets = [];
  for (const rawLine of (r.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf('|');
    if (idx < 0) continue;
    const pid = line.slice(0, idx);
    const execPath = line.slice(idx + 1);
    if (!/^\d+$/.test(pid)) continue;
    if (!execPath) {
      // Path unavailable (typically NETWORK SERVICE / LocalSystem-owned).
      // Still a Runner.Listener.exe by WMI filter, kill it during uninstall.
      targets.push({ pid, execPath: '(path unavailable — likely NETWORK SERVICE-owned)' });
      continue;
    }
    if (execPath.toLowerCase().startsWith(RUNNER_HOME.toLowerCase())) {
      targets.push({ pid, execPath });
    }
  }

  if (targets.length === 0) return;

  logger.log(`Killing ${targets.length} Runner.Listener.exe process(es) before disk cleanup…`);
  for (const { pid, execPath } of targets) {
    const k = spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { encoding: 'utf8' });
    if (k.status === 0) {
      logger.log(`  ✓ Killed PID ${pid} ${execPath}`);
    } else {
      logger.warn(`  ✗ taskkill ${pid} failed (exit ${k.status}): ${(k.stderr || '').trim().slice(0, 200)}`);
    }
  }
}

// Identify the processes currently holding handles inside `targetPath` via
// Sysinternals handle.exe. Used as a diagnostic when removeRunnerHomeWithRetry
// gives up — turns "files may be locked" into "PID 1234 (Runner.Listener.exe)
// is holding C:\actions-runners\actions-runner-foo\bin\Runner.Listener.exe".
// handle.exe isn't bundled with Windows; if it isn't on PATH we surface a tip
// instead so the next failure has a path to actionable info.
function identifyHandleHolders(targetPath) {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');

  const probe = spawnSync('where', ['handle.exe'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (probe.status !== 0) {
    logger.warn(`Tip: install Sysinternals handle.exe (https://learn.microsoft.com/sysinternals/downloads/handle) and add it to PATH so future failures here can name the offending process.`);
    logger.warn(`Some files may be locked. Reboot Windows and re-run install if this persists.`);
    return;
  }

  // -accepteula bypasses the one-time EULA prompt that handle.exe shows on
  // first run; -nobanner suppresses the version banner so the output is
  // straight to per-handle lines.
  const r = spawnSync('handle.exe', ['-accepteula', '-nobanner', targetPath], { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  if (out) {
    logger.warn(`Processes holding handles under ${targetPath}:`);
    for (const line of out.split(/\r?\n/).slice(0, 30)) logger.warn(`  ${line}`);
  } else {
    logger.warn(`handle.exe ran but reported no holders for ${targetPath}. The lock may be at the directory level (e.g. another shell's cwd is set inside it) — try closing all cmd windows and re-running.`);
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
// Detect early; auto-elevate via UAC if running interactively and not already admin.
function ensureWindowsAdmin(options) {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');
  // `net session` requires admin and exits 0 if elevated, non-zero otherwise. Faster than spawning powershell.
  const r = spawnSync('net', ['session'], { stdio: 'ignore' });
  if (r.status === 0) return;

  const optsBlock = options || {};
  const autoElevate = process.stdin.isTTY
    && !optsBlock['no-auto-elevate']
    && !process.env.EM_RUNNER_NO_AUTO_ELEVATE;

  if (!autoElevate) {
    throw new Error('This command needs an elevated cmd.exe (Run as Administrator). Service install/uninstall and `sc` commands fail silently without admin rights.');
  }

  relaunchElevated();
  // relaunchElevated() exits this process — control never returns past this point.
}

// Re-launch the original `npx mgr ...` invocation in a new elevated cmd.exe window via
// PowerShell's Start-Process -Verb RunAs (triggers UAC prompt). The new window:
//   - inherits this process's env (including PATH so `npx` works)
//   - has cwd set to the current cwd (UAC defaults to system32 otherwise)
//   - uses `cmd /k` so the window stays open after the command finishes (the user can
//     read the output and close it manually)
function relaunchElevated() {
  const { spawnSync } = require('child_process');
  const cwd = process.cwd();

  // Reconstruct the original argv. process.argv[0] is the node binary, [1] is the
  // entry script (bin/electron-manager), the rest are user args. We re-invoke via
  // `npx mgr ...` so the elevated cmd doesn't need to know about node-version
  // managers (nvm-windows etc.) — npx handles resolution.
  const userArgs = process.argv.slice(2);   // strip node + entry
  // Quote any arg that contains a space.
  const quoted = userArgs.map((a) => /\s/.test(a) ? `"${a}"` : a).join(' ');
  const cmdLine = `cd /d "${cwd}" && npx mgr ${quoted}`;

  // PowerShell Start-Process -Verb RunAs is the documented way to trigger UAC.
  // -ArgumentList passes args; -WorkingDirectory sets the new process's cwd.
  // We invoke a NEW cmd.exe with /k so it stays open. The /k arg's value is our
  // command line.
  const psArgs = [
    '-NoProfile',
    '-Command',
    `Start-Process cmd.exe -Verb RunAs -ArgumentList '/k', '${cmdLine.replace(/'/g, "''")}'`,
  ];

  process.stdout.write('\nThis command requires admin. Requesting elevation — accept the UAC prompt.\n');
  process.stdout.write('A new elevated cmd window will open with the install output.\n');
  process.stdout.write(`(Cmd: ${cmdLine})\n\n`);

  const r = spawnSync('powershell', psArgs, { stdio: 'inherit' });
  if (r.status !== 0) {
    process.stderr.write('Failed to request elevation. Open an elevated cmd manually and re-run.\n');
    process.exit(1);
  }

  // Done in this process — the elevated window is doing the real work.
  process.exit(0);
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

  // Extract via PowerShell's Expand-Archive instead of `tar`. On Windows the
  // System32 tar.exe (bsdtar) handles `C:\...` paths fine, but if the user's
  // PATH front-loads Git for Windows' tar (GNU tar), it interprets `C:\...`
  // as `host:path` and fails with "Cannot connect to C: resolve failed".
  // Expand-Archive is built into PowerShell 5.1+ on every supported Windows
  // and has none of those quirks.
  if (process.platform === 'win32') {
    const ps = spawnSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${runnerDir}' -Force`,
    ], { stdio: 'inherit' });
    if (ps.status !== 0) {
      throw new Error(`Failed to extract actions-runner.zip via PowerShell Expand-Archive (exit ${ps.status}).`);
    }
  } else {
    const t = spawnSync('tar', ['-xf', zipPath, '-C', runnerDir], { stdio: 'inherit' });
    if (t.status !== 0) {
      throw new Error(`Failed to extract actions-runner.zip (tar exit ${t.status}).`);
    }
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
// ─── Startup folder runner management (replaces Logon Tasks) ──────────────
//
// v1.2.35+ registers the per-org runner as a .cmd file in the user's Startup
// folder instead of as a Scheduled Task. Reason: Task Scheduler runs ONLOGON
// tasks in its own (Session 0) context regardless of the /IT flag, leaving
// the runner blind to the user's CurrentUser\My cert store and unable to host
// the SafeNet Token Logon PIN dialog. Files in the Startup folder are
// auto-run by Explorer at every interactive logon (Session 1), no Task
// Scheduler middleman, no admin needed for the auto-start trigger.
//
// File layout:
//   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\<runnerName>.cmd
//
// Content:
//   @echo off
//   start "" /min "C:\actions-runners\actions-runner-<org>\run.cmd"
//
// `start "" /min` launches run.cmd in a minimized window and returns
// immediately, so subsequent startup items aren't blocked. The empty `""` is
// start.exe's title parameter — required when the next argument is quoted,
// otherwise start interprets the quoted path as a console title.

const STARTUP_DIR = process.platform === 'win32'
  ? path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
    )
  : null;

function runnerStartupFile(runnerName) {
  if (!STARTUP_DIR) return null;
  return path.join(STARTUP_DIR, `${runnerName}.cmd`);
}

function writeRunnerStartupShortcut({ runnerName, runnerDir }) {
  if (process.platform !== 'win32') return;
  const runCmd = path.join(runnerDir, 'run.cmd');
  if (!jetpack.exists(runCmd)) {
    throw new Error(`Cannot write Startup shortcut — run.cmd not found at ${runCmd}.`);
  }
  jetpack.dir(STARTUP_DIR);
  const file = runnerStartupFile(runnerName);
  // We DO use run.cmd (so its self-update relaunch loop fires when
  // Runner.Listener exits with code 3 = update needed). The trick: the
  // wrapper cmd.exe must run with cwd OUTSIDE RUNNER_HOME, otherwise it
  // holds the runner dir as cwd for the lifetime of the listener and every
  // subsequent uninstall hits EPERM. We `cd /d %WINDIR%` first so the
  // launched cmd.exe inherits %WINDIR% as cwd. Runner.Listener uses its
  // binary location (not cwd) to find .runner / .credentials, so this is
  // safe — verified against actions/runner v2.319.x.
  const body = [
    '@echo off',
    `cd /d "%WINDIR%"`,
    `start "" /min "${runCmd}"`,
    '',
  ].join('\r\n');
  jetpack.write(file, body);
  logger.log(`  ✓ Startup shortcut: ${file}`);
}

function removeRunnerStartupShortcut(runnerName) {
  if (process.platform !== 'win32') return false;
  const file = runnerStartupFile(runnerName);
  if (jetpack.exists(file)) {
    jetpack.remove(file);
    return true;
  }
  return false;
}

// Names of all `em-runner-*` shortcuts in the Startup folder (sans `.cmd`).
function listRunnerStartupShortcuts() {
  if (process.platform !== 'win32') return [];
  if (!jetpack.exists(STARTUP_DIR)) return [];
  return (jetpack.list(STARTUP_DIR) || [])
    .filter((name) => /^em-runner-.+\.cmd$/i.test(name))
    .map((name) => name.replace(/\.cmd$/i, ''))
    .sort();
}

// Spawn Runner.Listener.exe as a fully detached background process. We exec
// the listener directly (NOT via run.cmd) because run.cmd is a cmd.exe batch
// wrapper that blocks for the lifetime of the listener with cwd = runnerDir;
// a long-lived cmd.exe holding cwd inside RUNNER_HOME blocks every later
// uninstall with EPERM. Bypassing run.cmd loses its self-update relaunch
// path, but `mgr runner install` refreshing the runner binary is the
// preferred update mechanism in EM anyway.
//
// Detached + windowsHide + ignored stdio = no console window flashes during
// install and the listener survives the install command's exit. UAC-
// elevated parents still spawn into Session 1 because UAC only changes the
// token, not the session — confirmed empirically.
function spawnRunnerDetached(runnerDir) {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'not-windows', pid: null };
  }
  const runCmd = path.join(runnerDir, 'run.cmd');
  if (!jetpack.exists(runCmd)) {
    return { ok: false, message: `run.cmd not found at ${runCmd}`, pid: null };
  }
  const { spawn } = require('child_process');
  try {
    // cwd is intentionally OUTSIDE RUNNER_HOME (we use %WINDIR%): the cmd.exe
    // wrapper that runs run.cmd holds its cwd for the lifetime of the listener,
    // and a long-lived cmd.exe with cwd inside the runner dir blocks every
    // subsequent uninstall with EPERM. Runner.Listener.exe uses its binary
    // location (not cwd) to find config, so this is safe.
    const child = spawn('cmd.exe', ['/c', runCmd], {
      cwd: process.env.WINDIR || 'C:\\Windows',
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (e) {
    return { ok: false, message: e.message, pid: null };
  }
}

// Enumerate Runner.Listener.exe processes whose ExecutablePath lives under
// `targetDir`. Used by status (visibility) and stop (kill targets). Returns
// [{ pid, sessionId, execPath }, ...]. Path-unavailable processes (NETWORK
// SERVICE-owned zombies) are surfaced too with execPath = null so callers
// can decide what to do with them — status warns, stop kills.
function listRunnerListenerProcessesUnder(targetDir) {
  if (process.platform !== 'win32') return [];
  const { spawnSync } = require('child_process');
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.SessionId)|$($_.ExecutablePath)" }`,
  ], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const out = [];
  for (const rawLine of (r.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length !== 3) continue;
    const [pid, sessionId, execPath] = parts;
    if (!/^\d+$/.test(pid)) continue;
    if (!execPath) {
      // Path unavailable — almost certainly a NETWORK SERVICE-owned zombie.
      // Surface it so status can call it out and stop can kill it.
      out.push({ pid: parseInt(pid, 10), sessionId: parseInt(sessionId, 10), execPath: null });
      continue;
    }
    if (execPath.toLowerCase().startsWith(String(targetDir).toLowerCase())) {
      out.push({ pid: parseInt(pid, 10), sessionId: parseInt(sessionId, 10), execPath });
    }
  }
  return out;
}

// Idempotent cleanup of any em-runner-* Scheduled Tasks left over from
// v1.2.16–v1.2.34, which registered runners as Logon Tasks. v1.2.35+ moved
// to Startup folder shortcuts; this runs during uninstall so upgraders'
// leftover tasks get pruned without manual schtasks juggling.
async function uninstallLegacyLogonTasks() {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');
  const r = spawnSync('schtasks', ['/Query', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  if (r.status !== 0) return;
  const tasks = [];
  for (const rawLine of (r.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^"([^"]+)"/.exec(line);
    if (!m) continue;
    const tn = m[1].replace(/^\\/, '');
    if (/^em-runner-/i.test(tn)) tasks.push(tn);
  }
  if (tasks.length === 0) return;
  for (const name of tasks) {
    logger.log(`Removing legacy Logon Task ${name}…`);
    spawnSync('schtasks', ['/End',    '/TN', name],          { stdio: 'ignore' });
    const d = spawnSync('schtasks', ['/Delete', '/TN', name, '/F'], { encoding: 'utf8' });
    if (d.status !== 0) {
      logger.warn(`  schtasks /Delete failed for ${name} (exit ${d.status}): ${(d.stderr || '').trim().slice(0, 200)}`);
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

  // List the registered orgs (and per-org runner tasks + state) so the user can see
  // exactly which orgs the monitor will pick up signing events from.
  //
  // We trust EM_RUNNER_ORGS over config.registeredOrgs when set, because installs
  // that predated the filter often left a stale full-org list in config.json.
  const cfg = readConfig();
  let orgs = cfg.registeredOrgs || [];
  const filterRaw = process.env.EM_RUNNER_ORGS || '';
  const filter = filterRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (filter.length > 0) {
    const filterSet = new Set(filter.map((o) => o.toLowerCase()));
    orgs = orgs.filter((o) => filterSet.has(o.toLowerCase()));
    if (orgs.length === 0) orgs = filter;   // EM_RUNNER_ORGS set but no matches in config — show the filter directly
  }

  if (orgs.length === 0) {
    logger.log('(no orgs registered yet — run `npx mgr runner install` first)');
  } else {
    logger.log(`Monitoring signing requests across ${orgs.length} org(s):`);
    // Build the expected task name for each org via the same helper that creates them
    // (don't reverse-parse — host can contain dashes and so can the org, so splitting
    // is ambiguous). Then look each one up directly.
    const allTasks = new Set(listEmRunnerTasks());
    for (const org of orgs) {
      const expectedTask = runnerTaskName(org);
      if (allTasks.has(expectedTask)) {
        const state = taskState(expectedTask);
        const symbol = state === 'RUNNING' ? '✓' : state === 'READY' ? '·' : '?';
        logger.log(`  ${symbol} ${org} (task: ${expectedTask} — ${state})`);
      } else {
        logger.log(`  · ${org} (no Logon Task — runner may be offline)`);
      }
    }
  }

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
      // Org/repo callout: prefer GH-provided env, fall back to parsing the workspace path
      // (C:\actions-runners\actions-runner-<org>\_work\<repo>\<repo>) when running outside
      // a GH Actions context (e.g. local smoke tests).
      let org  = evt.github_owner || null;
      let repo = evt.github_repo  || null;
      if (!org && evt.runner_workspace) {
        const m = /actions-runner-([^\\/]+)[\\/]_work[\\/]([^\\/]+)/i.exec(evt.runner_workspace);
        if (m) { org = m[1]; repo = repo || m[2]; }
      }
      if (org || repo) {
        const label = [org, repo].filter(Boolean).join('/');
        process.stdout.write(' ' + c('yellow', label));
      }
      if (evt.github_workflow) process.stdout.write(c('gray', ` workflow=${evt.github_workflow}`));
      if (evt.github_run_id)   process.stdout.write(c('gray', ` run=${evt.github_run_id}`));
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
