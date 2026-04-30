// scripts/sync-nvmrc.js — auto-sync the project's .nvmrc to match the Node version that the
// installed electron version bundles. Runs as `postinstall`.
//
// Works for both EM itself AND any consumer that wires this script into their postinstall.
// Resolves the project root via:
//   1. INIT_CWD (npm sets this to the directory `npm install` was invoked from) — present when
//      this is the consumer's postinstall.
//   2. Falls back to walking up from this script (catches EM's own postinstall path).
//
// Why: when electron is bumped (peer dep change, fresh install, etc.), the project's .nvmrc
// stays in sync with no manual step. Same logic as `npx mgr setup`'s ensureNvmrc().
//
// Failure modes are silent (postinstall must never break `npm i`):
//   - no electron in node_modules → skip
//   - releases.electronjs.org unreachable → skip
//   - any error → warn, exit 0

const fs   = require('fs');
const path = require('path');

(async function main() {
  try {
    const repoRoot = resolveProjectRoot();
    if (!repoRoot) return;

    const electronPkgPath = path.join(repoRoot, 'node_modules', 'electron', 'package.json');

    if (!fs.existsSync(electronPkgPath)) {
      // Electron not installed yet (e.g. this is the postinstall fired by EM's own `npm install`
      // but electron itself is a peerDep). Nothing to do.
      return;
    }

    const electronPkg = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8'));
    const electronVersion = electronPkg.version;
    if (!electronVersion) return;

    // Inline the logic from src/utils/electron-node-version.js so this script doesn't depend on
    // the dist/ build (postinstall runs before EM has been built).
    const electronMajor = electronVersion.split('.')[0];
    const releases = await fetchReleases();
    if (!releases) return;

    const match = releases.find((r) => r.version === `${electronMajor}.0.0`);
    if (!match || !match.node) return;

    const nodeMajor = String(match.node).split('.')[0];
    const desired   = `v${nodeMajor}/*`;
    const nvmrcPath = path.join(repoRoot, '.nvmrc');
    const existing  = fs.existsSync(nvmrcPath) ? fs.readFileSync(nvmrcPath, 'utf8').trim() : null;

    if (existing === desired) return;   // already in sync

    fs.writeFileSync(nvmrcPath, `${desired}\n`);
    console.log(`[em:sync-nvmrc] .nvmrc ${existing ? `${existing} → ${desired}` : `created ${desired}`} (electron ${electronVersion} ships Node ${match.node})`);
  } catch (e) {
    console.warn(`[em:sync-nvmrc] skipped: ${e.message}`);
  }
})();

// Find the project root for this postinstall run. INIT_CWD is npm's canonical signal — the
// directory the user ran `npm install` from. Falls back to two-levels-up from this script
// (which works when this script is run from <project>/node_modules/electron-manager/scripts/).
function resolveProjectRoot() {
  if (process.env.INIT_CWD && fs.existsSync(path.join(process.env.INIT_CWD, 'package.json'))) {
    return process.env.INIT_CWD;
  }
  // Walk up from this script: scripts/ → EM root, OR scripts/ → electron-manager → node_modules → consumer root.
  // Try the latter first (consumer install scenario).
  const consumerCandidate = path.resolve(__dirname, '..', '..', '..');
  if (fs.existsSync(path.join(consumerCandidate, 'package.json'))
      && consumerCandidate.includes(`${path.sep}node_modules${path.sep}`) === false) {
    return consumerCandidate;
  }
  // EM-itself scenario: scripts/ → EM root.
  const emCandidate = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(emCandidate, 'package.json'))) {
    return emCandidate;
  }
  return null;
}

function fetchReleases() {
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.request('https://releases.electronjs.org/releases.json', {
      method: 'GET',
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
      });
    });
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}
