// finalize-release — wraps up a release after the matrix builds finish.
//
// Two modes (one command, --flag selects):
//   --signed-dir <path>   Upload signed Windows artifacts to the update-server release
//                         (created earlier by mac/linux's electron-builder --publish), then
//                         mirror the same files to the download-server installer tag with
//                         stable filenames. Used by the windows-sign CI job.
//   --publish             Flip the update-server release from draft → published so
//                         electron-updater can read its feed. Used by the finalize CI job.
//
// Reads config/electron-manager.json to discover update-server (releases.repo) and
// download-server (downloads.repo / downloads.tag). Owner falls back to the consumer's
// own GitHub owner if not set in config.
//
// Idempotent: each mode is safe to re-run. Uploads use clobber, publish uses GH's
// "set draft=false" which is a no-op if already published.

const path    = require('path');
const fs      = require('fs');
const jetpack = require('fs-jetpack');

const { discoverRepo, getOctokit } = require('../utils/github.js');
const Manager = new (require('../build.js'));

const logger = Manager.logger('finalize-release');

const STABLE = require('../gulp/tasks/mirror-downloads.js');

module.exports = async function finalizeRelease(options = {}) {
  const argv = options._ || [];
  // Parse flags from yargs-style options (yargs camelCases --signed-dir → signedDir).
  const signedDir = options.signedDir || options['signed-dir'];
  const doPublish = options.publish === true;

  if (!signedDir && !doPublish) {
    throw new Error('finalize-release: pass --signed-dir <path> or --publish');
  }

  const projectRoot = process.cwd();
  const config      = Manager.getConfig() || {};
  const pkgVersion  = (Manager.getPackage('project') || {}).version;

  if (!pkgVersion) {
    throw new Error('finalize-release: package.json version not found');
  }

  if (!process.env.GH_TOKEN) {
    throw new Error('finalize-release: GH_TOKEN not set in env');
  }

  const octokit = getOctokit();
  if (!octokit) {
    throw new Error('finalize-release: failed to create octokit (missing GH_TOKEN?)');
  }

  let appOwner;
  try {
    const discovered = await discoverRepo(projectRoot);
    appOwner = discovered.owner;
  } catch (e) {
    throw new Error(`finalize-release: could not discover GitHub owner: ${e.message}`);
  }

  // Update-server (the auto-updater feed source).
  const releasesOwner = config?.releases?.owner || appOwner;
  const releasesRepo  = config?.releases?.repo  || 'update-server';
  const releaseTag    = `v${pkgVersion}`;

  if (signedDir) {
    await uploadSignedWindows({
      octokit, owner: releasesOwner, repo: releasesRepo, tag: releaseTag,
      signedDir: path.resolve(projectRoot, signedDir),
      config, projectRoot,
    });
  }

  if (doPublish) {
    await publishUpdateServerRelease({
      octokit, owner: releasesOwner, repo: releasesRepo, tag: releaseTag,
    });
  }
};

async function uploadSignedWindows({ octokit, owner, repo, tag, signedDir, config, projectRoot }) {
  if (!jetpack.exists(signedDir)) {
    logger.warn(`No signed dir at ${signedDir} — nothing to upload.`);
    return;
  }

  const files = (jetpack.list(signedDir) || []).filter((f) => {
    if (!f.includes('.')) return false;
    if (f.endsWith('.blockmap')) return false;
    if (f.endsWith('.yml')) return false;
    return true;
  });

  if (files.length === 0) {
    logger.warn(`No signed files in ${signedDir}.`);
    return;
  }

  // Find the update-server release by tag. Mac/linux's electron-builder publish
  // step should have created it already.
  let release;
  try {
    const { data } = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag });
    release = data;
  } catch (err) {
    if (err.status === 404) {
      throw new Error(`Update-server release ${tag} not found at ${owner}/${repo}. Did mac/linux build/publish succeed?`);
    }
    throw err;
  }

  logger.log(`Uploading ${files.length} signed file(s) to ${owner}/${repo}@${tag} (release id ${release.id})...`);

  // Replace any existing assets with the same name.
  const { data: existing } = await octokit.rest.repos.listReleaseAssets({
    owner, repo, release_id: release.id, per_page: 100,
  });
  const existingByName = new Map(existing.map((a) => [a.name, a]));

  for (const filename of files) {
    const src = path.join(signedDir, filename);
    const data = fs.readFileSync(src);

    const old = existingByName.get(filename);
    if (old) {
      await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: old.id });
    }

    await octokit.rest.repos.uploadReleaseAsset({
      owner, repo, release_id: release.id,
      name: filename,
      data,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': data.length,
      },
    });

    logger.log(`  ✓ ${filename} (${(data.length / 1024 / 1024).toFixed(1)}MB) → ${owner}/${repo}@${tag}`);
  }

  // Also upload the latest.yml / .blockmap auto-updater metadata if present.
  const meta = (jetpack.list(signedDir) || []).filter((f) => f.endsWith('.yml') || f.endsWith('.blockmap'));
  for (const filename of meta) {
    const src  = path.join(signedDir, filename);
    const data = fs.readFileSync(src);
    const old  = existingByName.get(filename);
    if (old) {
      await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: old.id });
    }
    await octokit.rest.repos.uploadReleaseAsset({
      owner, repo, release_id: release.id,
      name: filename,
      data,
      headers: { 'content-type': 'application/octet-stream', 'content-length': data.length },
    });
    logger.log(`  ✓ ${filename} (auto-updater feed) → ${owner}/${repo}@${tag}`);
  }

  // Now mirror the same signed files to download-server with stable names.
  if (config?.downloads?.enabled === false) {
    logger.log('downloads.enabled=false — skipping download-server mirror.');
    return;
  }

  const downloadsOwner = config?.downloads?.owner || owner;
  const downloadsRepo  = config?.downloads?.repo  || 'download-server';
  const downloadsTag   = config?.downloads?.tag   || 'installer';
  const productName    = config?.app?.productName || (Manager.getPackage('project') || {}).name || 'app';

  // Get-or-create the installer release.
  let installerId;
  try {
    const { data } = await octokit.rest.repos.getReleaseByTag({ owner: downloadsOwner, repo: downloadsRepo, tag: downloadsTag });
    installerId = data.id;
  } catch (err) {
    if (err.status !== 404) throw err;
    const { data } = await octokit.rest.repos.createRelease({
      owner: downloadsOwner, repo: downloadsRepo,
      tag_name: downloadsTag, name: downloadsTag,
      body: `Latest installers (auto-mirrored by electron-manager).`,
      draft: false, prerelease: false,
    });
    installerId = data.id;
    logger.log(`Created ${downloadsOwner}/${downloadsRepo}@${downloadsTag}.`);
  }

  const { data: installerAssets } = await octokit.rest.repos.listReleaseAssets({
    owner: downloadsOwner, repo: downloadsRepo, release_id: installerId, per_page: 100,
  });
  const installerByName = new Map(installerAssets.map((a) => [a.name, a]));

  let mirrored = 0;
  for (const filename of files) {
    const stable = STABLE.stableName(filename, productName);
    if (!stable) continue;

    const src  = path.join(signedDir, filename);
    const data = fs.readFileSync(src);

    const old = installerByName.get(stable);
    if (old) {
      await octokit.rest.repos.deleteReleaseAsset({ owner: downloadsOwner, repo: downloadsRepo, asset_id: old.id });
    }

    await octokit.rest.repos.uploadReleaseAsset({
      owner: downloadsOwner, repo: downloadsRepo, release_id: installerId,
      name: stable,
      data,
      headers: { 'content-type': 'application/octet-stream', 'content-length': data.length },
    });

    logger.log(`  ✓ ${stable} (${(data.length / 1024 / 1024).toFixed(1)}MB) ← ${filename} → ${downloadsOwner}/${downloadsRepo}@${downloadsTag}`);
    mirrored += 1;
  }

  logger.log(`Mirrored ${mirrored} signed Windows artifact(s) to ${downloadsOwner}/${downloadsRepo}@${downloadsTag}`);
}

async function publishUpdateServerRelease({ octokit, owner, repo, tag }) {
  let release;
  try {
    const { data } = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag });
    release = data;
  } catch (err) {
    if (err.status === 404) {
      throw new Error(`Release ${tag} not found at ${owner}/${repo}. Did the build/publish job succeed?`);
    }
    throw err;
  }

  if (!release.draft && !release.prerelease) {
    logger.log(`✓ ${owner}/${repo}@${tag} already published (draft=false, prerelease=false).`);
  } else {
    await octokit.rest.repos.updateRelease({
      owner, repo, release_id: release.id,
      draft: false,
      prerelease: false,
    });
    logger.log(`✓ Flipped ${owner}/${repo}@${tag} to published (was draft=${release.draft}, prerelease=${release.prerelease}).`);
  }

  // Sanity check — ensure the auto-updater feeds are present so electron-updater works.
  const { data: assets } = await octokit.rest.repos.listReleaseAssets({
    owner, repo, release_id: release.id, per_page: 100,
  });
  const names = assets.map((a) => a.name);

  const expected = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
  const missing  = expected.filter((feed) => !names.includes(feed));

  if (missing.length > 0) {
    logger.warn(`Auto-updater feeds missing from ${owner}/${repo}@${tag}: ${missing.join(', ')}`);
    logger.warn('  electron-updater will fail for these platforms until the feed yml is uploaded.');
  } else {
    logger.log(`✓ All auto-updater feeds present (${expected.join(', ')}).`);
  }

  logger.log(`Release URL: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
}
