// Shared GitHub helpers used by setup, push-secrets, and the release pipeline.
//
// Repo discovery: parse the consumer's package.json `repository.url` first, then fall back to
// `git remote get-url origin`. Returns `{ owner, repo }` or throws.
//
// Octokit factory: returns an authenticated client when GH_TOKEN is set. Returns null otherwise so
// callers can choose to no-op or bail with a friendly message.
//
// Repo ensure: idempotently create a repo under <owner> if it doesn't exist. Used by setup to
// auto-provision update-server / download-server.

const path    = require('path');
const jetpack = require('fs-jetpack');

async function discoverRepo(projectRoot) {
  const pkg = jetpack.read(path.join(projectRoot, 'package.json'), 'json') || {};
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;

  if (url) {
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (m) {
      return { owner: m[1], repo: m[2] };
    }
  }

  try {
    const { execute } = require('node-powertools');
    const remote = await execute('git config --get remote.origin.url', { log: false });
    const m = String(remote || '').match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (m) return { owner: m[1], repo: m[2] };
  } catch (e) { /* ignore */ }

  throw new Error('Could not determine GitHub owner/repo. Set package.json `repository.url` or git remote origin.');
}

function getOctokit() {
  const token = process.env.GH_TOKEN;
  if (!token) return null;
  const { Octokit } = require('@octokit/rest');
  return new Octokit({ auth: token });
}

// Idempotent: returns true if the repo exists (created or already there), false on failure.
// Honors the `owner` distinction between user vs. org — the API endpoints differ.
async function ensureRepo(octokit, owner, repo, opts = {}) {
  const description = opts.description || '';
  const isPrivate = opts.private === true;

  try {
    await octokit.rest.repos.get({ owner, repo });
    return { created: false, exists: true };
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  // Need to create. Check if owner is the authenticated user or an org.
  let isOrg = false;
  try {
    const { data: me } = await octokit.rest.users.getAuthenticated();
    isOrg = me.login.toLowerCase() !== owner.toLowerCase();
  } catch (e) {
    isOrg = true;
  }

  const params = {
    name: repo,
    description,
    private: isPrivate,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    auto_init: true,
  };

  if (isOrg) {
    await octokit.rest.repos.createInOrg({ org: owner, ...params });
  } else {
    await octokit.rest.repos.createForAuthenticatedUser(params);
  }

  return { created: true, exists: true };
}

module.exports = {
  discoverRepo,
  getOctokit,
  ensureRepo,
};
