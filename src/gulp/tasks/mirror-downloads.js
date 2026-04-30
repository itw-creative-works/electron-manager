// Mirror-to-download-server: re-upload the just-released artifacts to a stable tag
// (default 'installer') with versionless asset names. Marketing sites can then link to a
// fixed URL that always serves the latest binary.
//
// Source: each just-built artifact in `release/`.
// Target: <downloads.owner>/<downloads.repo> @ tag=<downloads.tag>, asset name = stable form
//         (e.g. MyApp-1.0.1-arm64.dmg → MyApp-mac-arm64.dmg).
//
// The target release is created if missing, target tag's existing assets with the same name
// are replaced (clobber). Skipped silently if config.downloads.enabled === false or the
// downloads repo can't be resolved.

const path    = require('path');
const fs      = require('fs');
const jetpack = require('fs-jetpack');
const Manager = new (require('../../build.js'));

const logger = Manager.logger('mirror-downloads');

module.exports = function mirrorDownloads(done) {
  Promise.resolve().then(async () => {
    const config = Manager.getConfig() || {};
    if (config?.downloads?.enabled === false) {
      logger.log('downloads.enabled=false — skipping mirror.');
      return;
    }

    const projectRoot = process.cwd();
    const releaseDir  = path.join(projectRoot, 'release');
    if (!jetpack.exists(releaseDir)) {
      logger.warn(`No release/ directory at ${releaseDir} — nothing to mirror.`);
      return;
    }

    if (!process.env.GH_TOKEN) {
      logger.warn('GH_TOKEN not set — cannot mirror to download-server.');
      return;
    }

    const { discoverRepo, getOctokit } = require('../../utils/github.js');
    const octokit = getOctokit();
    if (!octokit) {
      logger.warn('No octokit (no GH_TOKEN?) — skipping mirror.');
      return;
    }

    let appOwner;
    try {
      const discovered = await discoverRepo(projectRoot);
      appOwner = discovered.owner;
    } catch (e) {
      logger.warn(`Could not discover app owner: ${e.message}`);
      return;
    }

    const owner = config?.downloads?.owner || appOwner;
    const repo  = config?.downloads?.repo  || 'download-server';
    const tag   = config?.downloads?.tag   || 'installer';

    const productName = config?.app?.productName || (Manager.getPackage('project') || {}).name || 'app';

    const artifacts = jetpack.list(releaseDir) || [];
    const eligible  = artifacts.filter(isUploadable);
    if (eligible.length === 0) {
      logger.warn(`No uploadable artifacts in ${releaseDir}.`);
      return;
    }

    // Ensure release exists at <tag>
    let releaseId;
    try {
      const { data } = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag });
      releaseId = data.id;
    } catch (err) {
      if (err.status !== 404) throw err;
      const { data } = await octokit.rest.repos.createRelease({
        owner, repo,
        tag_name: tag,
        name: tag,
        body: `Latest installers (auto-mirrored by electron-manager). Stable filenames — direct links never change across versions.`,
        draft: false,
        prerelease: false,
      });
      releaseId = data.id;
      logger.log(`Created release ${owner}/${repo} @ ${tag}`);
    }

    // Existing assets on this release
    const { data: existingAssets } = await octokit.rest.repos.listReleaseAssets({ owner, repo, release_id: releaseId, per_page: 100 });
    const existingByName = new Map(existingAssets.map((a) => [a.name, a]));

    let uploaded = 0;
    for (const filename of eligible) {
      const srcPath  = path.join(releaseDir, filename);
      const stable   = stableName(filename, productName);
      if (!stable) continue;

      // Delete existing asset with the same stable name (we're replacing).
      const old = existingByName.get(stable);
      if (old) {
        await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: old.id });
      }

      const data = fs.readFileSync(srcPath);
      await octokit.rest.repos.uploadReleaseAsset({
        owner, repo, release_id: releaseId,
        name: stable,
        data,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': data.length,
        },
      });
      logger.log(`✓ ${stable} (${(data.length / 1024 / 1024).toFixed(1)}MB) ← ${filename}`);
      uploaded += 1;
    }

    logger.log(`Mirrored ${uploaded} artifact(s) to ${owner}/${repo} @ ${tag}`);
  }).then(() => done(), done);
};

// Skip blockmaps and yml feeds — they're auto-update artifacts, not user-facing installers.
function isUploadable(filename) {
  if (!filename) return false;
  if (filename.endsWith('.blockmap')) return false;
  if (filename.endsWith('.yml')) return false;
  // Skip directories
  if (!filename.includes('.')) return false;
  return true;
}

// Map a versioned electron-builder artifact name to a stable, versionless one.
// Examples:
//   MyApp-1.0.1.dmg                  → MyApp-mac-x64.dmg     (default mac arch is x64 if unspecified)
//   MyApp-1.0.1-arm64.dmg            → MyApp-mac-arm64.dmg
//   MyApp-1.0.1-mac.zip              → MyApp-mac-x64.zip
//   MyApp-1.0.1-arm64-mac.zip        → MyApp-mac-arm64.zip
//   MyApp-Setup-1.0.1.exe            → MyApp-win-x64.exe
//   MyApp-1.0.1.AppImage             → MyApp-linux-x64.AppImage
//   MyApp-1.0.1-arm64.AppImage       → MyApp-linux-arm64.AppImage
//   MyApp-1.0.1.deb                  → MyApp-linux-x64.deb
function stableName(filename, productName) {
  const product = sanitizeForFilename(productName);
  const lower   = filename.toLowerCase();
  const ext     = path.extname(filename).slice(1).toLowerCase();

  // Determine platform from extension only — extension is the source of truth.
  let platform;
  if (ext === 'dmg' || ext === 'pkg') {
    platform = 'mac';
  } else if (ext === 'zip' && (lower.includes('mac.zip') || lower.includes('-mac.zip'))) {
    platform = 'mac';
  } else if (ext === 'exe' || ext === 'appx' || ext === 'msi') {
    platform = 'win';
  } else if (ext === 'appimage' || ext === 'deb' || ext === 'rpm' || ext === 'snap') {
    platform = 'linux';
  } else {
    return null;
  }

  // Determine arch.
  let arch = 'x64';
  if (lower.includes('arm64')) arch = 'arm64';
  else if (lower.includes('ia32') || lower.includes('-x86')) arch = 'ia32';

  // Normalize zip/dmg/etc to lowercase ext.
  return `${product}-${platform}-${arch}.${ext}`;
}

function sanitizeForFilename(name) {
  return String(name || 'app').replace(/[^A-Za-z0-9._-]+/g, '');
}

// Exported for tests.
module.exports.stableName = stableName;
module.exports.isUploadable = isUploadable;
