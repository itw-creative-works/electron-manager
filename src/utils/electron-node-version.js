// Resolve the Node.js version that Electron's bundled runtime ships with, by querying the
// official electron releases feed. Returns the major version (e.g. "24") so we can write
// `.nvmrc` and `engines.node` from it.
//
// Same pattern as legacy EM's `process_checkNodeVersion` — fetch releases.electronjs.org once
// per setup, find the entry matching the consumer's installed electron version, return its
// `node` field's major.

const wonderfulFetch  = require('wonderful-fetch');
const wonderfulVersion = require('wonderful-version');

const RELEASES_URL = 'https://releases.electronjs.org/releases.json';

let cachedReleases = null;

async function fetchReleases() {
  if (cachedReleases) return cachedReleases;
  const data = await wonderfulFetch(RELEASES_URL, { response: 'json', tries: 3 });
  cachedReleases = Array.isArray(data) ? data : [];
  return cachedReleases;
}

// Resolve the Node major for a given electron version (e.g. '41.0.0' or '^41.0.0' → '24').
// Returns null on miss / network failure — caller should fall back gracefully.
async function resolveNodeMajorForElectron(electronVersion) {
  if (!electronVersion) return null;
  const electronMajor = wonderfulVersion.major(electronVersion);
  if (!electronMajor) return null;

  let releases;
  try {
    releases = await fetchReleases();
  } catch (e) {
    return null;
  }

  // Find the *.0.0 release for this electron major (matches legacy EM's behavior — the .0.0 of
  // each major is the canonical Node version for the line; later patch/minor electrons may bump
  // Node within the line but the major-Node mapping is stable).
  const match = releases.find((r) => r.version === `${electronMajor}.0.0`);
  if (!match || !match.node) return null;
  return wonderfulVersion.major(match.node);
}

module.exports = {
  resolveNodeMajorForElectron,
  fetchReleases,
};
