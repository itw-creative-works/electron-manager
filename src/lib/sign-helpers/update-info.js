// Generate the Windows auto-updater feed file (`latest.yml`) + accompanying
// `.blockmap` for each signed installer.
//
// Why this exists: electron-builder generates `latest.yml` ONLY as part of its
// publish flow. Our pipeline signs Windows .exe out-of-band (separate self-hosted
// runner job, EV USB token, signtool — see commands/sign-windows.js), so by the
// time we have a signed binary, electron-builder is long gone. We have to write
// `latest.yml` ourselves against the signed exe; otherwise its sha512 wouldn't
// match the binary on update-server and electron-updater would reject the update.
//
// `latest.yml` is the public client-side contract that electron-updater reads
// from the GitHub release. Schema reference:
// node_modules/builder-util-runtime/out/updateInfo.d.ts (UpdateInfo + UpdateFileInfo).
//
// We also generate a `.blockmap` for each installer using app-builder-bin's
// `blockmap` subcommand. The blockmap enables delta updates — electron-updater
// downloads only changed chunks instead of the whole .exe on minor updates.
// Blockmap generation is best-effort: if app-builder-bin isn't resolvable, we
// warn and skip (auto-updater still works full-download style without it).
//
// Sister `latest-mac.yml` / `latest-linux.yml` are produced by electron-builder's
// own publish step on those jobs, where they're built+signed in one process and
// the yml lands naturally. Only Windows is split.

const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const jetpack = require('fs-jetpack');
const yaml    = require('js-yaml');
const { execute } = require('node-powertools');

// SHA-512 of a file → base64 (raw bytes encoded), matching electron-builder's wire format.
// electron-updater verifies updates by recomputing this and comparing — must be base64
// of the raw 64-byte digest, NOT hex, NOT base64 of the hex string.
function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

// Resolve the app-builder binary path via app-builder-bin. Returns null if the
// dep isn't installed (consumer hasn't run electron-builder build → its node_modules
// won't contain app-builder-bin). Caller should warn-and-skip rather than throw.
function resolveAppBuilderPath() {
  try {
    const { appBuilderPath } = require('app-builder-bin');
    if (jetpack.exists(appBuilderPath)) return appBuilderPath;
  } catch (e) {
    // app-builder-bin not installed — likely no electron-builder in this consumer.
  }
  return null;
}

// Generate <exe>.blockmap next to the signed exe via `app-builder blockmap`.
// Returns the blockmap path on success, null if app-builder-bin isn't available
// or generation failed (the latter is surfaced as a warning by the caller).
async function generateBlockmap({ exePath, logger }) {
  const builder = resolveAppBuilderPath();
  if (!builder) {
    if (logger) logger.warn('  app-builder-bin not resolvable — skipping blockmap (auto-updater will still work, just no delta updates).');
    return null;
  }

  const blockmapPath = `${exePath}.blockmap`;
  try {
    // gzip is electron-updater's expected format. -i input -o output.
    await execute(`"${builder}" blockmap --input "${exePath}" --output "${blockmapPath}" --compression gzip`, { log: false });
    return blockmapPath;
  } catch (e) {
    if (logger) logger.warn(`  Blockmap generation failed (skipping, non-fatal): ${e.message}`);
    return null;
  }
}

// Build the `latest.yml` content from a list of signed installers + their metadata.
// Schema mirrors what electron-builder produces for the windows nsis target. Fields
// kept in the same order electron-builder emits, for diff-friendliness if anyone
// inspects the yml by hand.
//
// `files` is the canonical list. `path` and top-level `sha512` are deprecated but
// kept for backward compat with old electron-updater clients.
function buildUpdateInfo({ version, releaseDate, files }) {
  if (!files.length) {
    throw new Error('writeUpdateInfo: no files supplied — nothing to describe.');
  }

  const primary = files[0];

  return {
    version,
    files: files.map((f) => {
      const entry = {
        url: f.url,
        sha512: f.sha512,
        size: f.size,
      };
      if (f.blockMapSize !== undefined) entry.blockMapSize = f.blockMapSize;
      return entry;
    }),
    path: primary.url,
    sha512: primary.sha512,
    releaseDate,
  };
}

// Main entry. Given a set of signed Windows installers, generate per-exe blockmaps
// (best-effort) and write a single `latest.yml` describing them all.
//
//   signedExes  : Array<{ filePath, urlName }> — absolute path + the URL-style name
//                 the file will have on the GH release (usually basename(filePath)).
//   outDir      : where to drop latest.yml + the blockmaps. Typically same dir as the
//                 signed exes; finalize-release uploads everything in this dir.
//   version     : package.json version (no leading 'v').
//   releaseDate : ISO 8601 string. Defaults to now() if omitted.
//
// Returns the path to the written latest.yml.
async function writeUpdateInfo({ signedExes, outDir, version, releaseDate, logger }) {
  if (!signedExes || signedExes.length === 0) {
    throw new Error('writeUpdateInfo: signedExes is empty.');
  }
  if (!version) {
    throw new Error('writeUpdateInfo: version is required.');
  }

  jetpack.dir(outDir);
  const finalReleaseDate = releaseDate || new Date().toISOString();

  const files = [];
  for (const { filePath, urlName } of signedExes) {
    const stat   = fs.statSync(filePath);
    const sha512 = await sha512Base64(filePath);
    const blockmapPath = await generateBlockmap({ exePath: filePath, logger });

    let blockMapSize;
    if (blockmapPath && jetpack.exists(blockmapPath)) {
      blockMapSize = fs.statSync(blockmapPath).size;
    }

    files.push({
      url:  urlName || path.basename(filePath),
      sha512,
      size: stat.size,
      ...(blockMapSize !== undefined ? { blockMapSize } : {}),
    });
  }

  const updateInfo = buildUpdateInfo({ version, releaseDate: finalReleaseDate, files });
  const ymlPath = path.join(outDir, 'latest.yml');

  // Use single-quoted strings for date (matches electron-builder output style).
  const ymlContent = yaml.dump(updateInfo, {
    lineWidth: -1,        // never wrap (auto-updater clients parse line-by-line)
    quotingType: "'",
    forceQuotes: false,
  });

  fs.writeFileSync(ymlPath, ymlContent, 'utf8');

  if (logger) {
    logger.log(`  ✓ Wrote latest.yml (${files.length} file${files.length === 1 ? '' : 's'}, ${blockmapBlurb(files)})`);
  }

  return ymlPath;
}

function blockmapBlurb(files) {
  const withBlockmap = files.filter((f) => f.blockMapSize !== undefined).length;
  if (withBlockmap === files.length) return 'all with blockmap';
  if (withBlockmap === 0)            return 'no blockmaps — delta updates disabled';
  return `${withBlockmap}/${files.length} with blockmap`;
}

module.exports = {
  writeUpdateInfo,
  // Exported for unit tests.
  _internals: {
    sha512Base64,
    buildUpdateInfo,
    generateBlockmap,
    resolveAppBuilderPath,
  },
};
