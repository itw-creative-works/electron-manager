// em-runner-watcher: long-running daemon installed as a Windows service by `npx mgr runner bootstrap`.
//
// Responsibilities:
//   1. Self-update: on each tick, run `npm i -g electron-manager@latest`. Always uses the freshest CLI.
//   2. Discover orgs: query GH API for orgs the GH_TOKEN has admin on. For each new org not yet in
//      our local registry, shell out to `mgr runner register-org <org>` to register the runner there.
//   3. Health log: write a heartbeat line to %PROGRAMDATA%\em-runner\watcher.log every poll.
//
// The watcher is fully self-contained — it doesn't `require()` anything from the EM source tree
// because that tree might be in the middle of a `npm i -g` update. It only uses Node builtins
// + a single shell-out to `mgr` (which IS the up-to-date EM after self-update).

const path        = require('path');
const fs          = require('fs');
const os          = require('os');
const { spawn, spawnSync } = require('child_process');
const https       = require('https');

const POLL_INTERVAL_MS = parseInt(process.env.EM_RUNNER_POLL_INTERVAL || '60000', 10);
const RUNNER_HOME      = path.join(os.homedir(), '.em-runner');
const LOG_FILE         = path.join(RUNNER_HOME, 'watcher.log');
const CONFIG_FILE      = path.join(RUNNER_HOME, 'config.json');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFile(LOG_FILE, line, () => {});
  process.stdout.write(line);
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function ghApi(pathPart) {
  return new Promise((resolve, reject) => {
    const token = process.env.GH_TOKEN;
    if (!token) return reject(new Error('GH_TOKEN missing'));
    const opts = {
      hostname: 'api.github.com',
      path: pathPart,
      method: 'GET',
      headers: {
        'User-Agent':    'em-runner-watcher',
        'Accept':        'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
      },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`GH API ${pathPart} → ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function selfUpdate() {
  return new Promise((resolve) => {
    const child = spawn('npm', ['i', '-g', 'electron-manager@latest'], {
      shell: true,
      stdio: 'ignore',
    });
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; child.kill(); resolve(false); } }, 120000);
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(t); resolve(code === 0); } });
    child.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(false); } });
  });
}

async function discoverAdminOrgs() {
  // /user/orgs returns the orgs the user is a member of. /user/memberships/orgs/<org> tells us the role.
  const orgs = await ghApi('/user/orgs?per_page=100');
  const admins = [];
  for (const org of orgs) {
    try {
      const m = await ghApi(`/user/memberships/orgs/${org.login}`);
      if (m.role === 'admin') admins.push(org.login);
    } catch (e) { /* skip */ }
  }
  return admins;
}

async function tick() {
  try {
    const cfg = readConfig();
    const known = new Set(cfg.registeredOrgs || []);

    // 1. Self-update. Best-effort.
    const updated = await selfUpdate();
    log(`tick: self-update ${updated ? 'ok' : 'skipped/failed'}`);

    // 2. Find admin orgs and register any new ones.
    const admins = await discoverAdminOrgs();
    log(`tick: admin orgs = [${admins.join(', ')}]; known = [${[...known].join(', ')}]`);
    for (const org of admins) {
      if (known.has(org)) continue;
      log(`tick: registering new org ${org}`);
      const r = spawnSync('mgr', ['runner', 'register-org', org], {
        shell: true,
        stdio: 'inherit',
        env: { ...process.env },
      });
      if (r.status === 0) {
        log(`tick: ✓ registered ${org}`);
      } else {
        log(`tick: ✗ register ${org} exited ${r.status}`);
      }
    }
  } catch (e) {
    log(`tick: error ${e.message}`);
  }
}

(async function main() {
  log(`em-runner-watcher starting (poll=${POLL_INTERVAL_MS}ms, home=${RUNNER_HOME})`);
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
})();
