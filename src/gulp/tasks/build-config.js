// Materialize the consumer's `electron-builder.yml` into `dist/electron-builder.yml`
// with mode-dependent fields injected (e.g. LSUIElement=true for tray-only).
//
// We never mutate the consumer's source file. The output file is what
// `electron-builder` actually reads (the package task points at it explicitly).

const path    = require('path');
const jetpack = require('fs-jetpack');
const Manager = new (require('../../build.js'));

const logger = Manager.logger('build-config');

module.exports = function buildConfig(done) {
  Promise.resolve().then(async () => {
    const projectRoot = process.cwd();
    const srcPath  = path.join(projectRoot, 'electron-builder.yml');
    const distPath = path.join(projectRoot, 'dist', 'electron-builder.yml');

    if (!jetpack.exists(srcPath)) {
      logger.warn(`No electron-builder.yml in ${projectRoot} — skipping build-config.`);
      return;
    }

    const config = Manager.getConfig() || {};
    const startupMode = config?.startup?.mode || 'normal';

    // Read the source as text so we can preserve comments and ordering.
    let yml = jetpack.read(srcPath);

    // Mode-dependent injections.
    if (startupMode === 'tray-only') {
      yml = injectMacExtendInfo(yml, { LSUIElement: true });
      logger.log('startup.mode=tray-only → injected mac.extendInfo.LSUIElement=true');
    }

    // Inject `publish` block from `releases` config knob.
    // Owner falls back to the app repo's owner so consumers usually only set `repo`.
    if (config?.releases?.enabled !== false) {
      const releases = config?.releases || {};
      let releaseOwner = releases.owner;
      if (!releaseOwner) {
        try {
          const { discoverRepo } = require('../../utils/github.js');
          const discovered = await discoverRepo(projectRoot);
          releaseOwner = discovered.owner;
        } catch (e) {
          logger.warn(`Could not discover repo owner; leaving publish block to electron-builder defaults. (${e.message})`);
        }
      }
      const releaseRepo = releases.repo || 'update-server';
      if (releaseOwner) {
        yml = injectPublish(yml, { provider: 'github', owner: releaseOwner, repo: releaseRepo });
        logger.log(`releases → publish block: github ${releaseOwner}/${releaseRepo}`);
      }
    }

    // Inject `afterSign` to point at EM's built-in notarize hook (resolved by Node from the
    // installed electron-manager package, NOT from the consumer's hooks/ dir). The consumer's
    // hooks/notarize/post.js is never the entrypoint — it's an optional extension point that
    // EM's real notarize calls into after notarization completes.
    const emNotarizePath = require.resolve('electron-manager/hooks/notarize');
    yml = injectAfterSign(yml, emNotarizePath);
    logger.log(`afterSign → ${emNotarizePath}`);

    jetpack.write(distPath, yml);
    logger.log(`wrote ${distPath} (mode=${startupMode})`);
  }).then(() => done(), done);
};

// Inject keys under `mac.extendInfo` in a YAML string. Idempotent — re-running with the
// same keys yields the same output. We do a minimal text edit rather than a YAML round-trip
// to preserve the consumer's formatting/comments.
function injectMacExtendInfo(yml, keys) {
  const lines = yml.split('\n');
  const macIdx = findTopLevelKey(lines, 'mac');

  if (macIdx === -1) {
    // No `mac:` block — append a complete one.
    const block = ['', 'mac:', '  extendInfo:'];
    Object.keys(keys).forEach((k) => block.push(`    ${k}: ${formatValue(keys[k])}`));
    return yml + block.join('\n') + '\n';
  }

  // Find or create `extendInfo:` inside the mac block.
  const macBlockEnd = findBlockEnd(lines, macIdx);
  let extendInfoIdx = -1;
  for (let i = macIdx + 1; i < macBlockEnd; i += 1) {
    if (/^\s{2}extendInfo\s*:/.test(lines[i])) {
      extendInfoIdx = i;
      break;
    }
  }

  if (extendInfoIdx === -1) {
    // Insert at the top of the mac block.
    const insert = ['  extendInfo:'];
    Object.keys(keys).forEach((k) => insert.push(`    ${k}: ${formatValue(keys[k])}`));
    lines.splice(macIdx + 1, 0, ...insert);
    return lines.join('\n');
  }

  // Merge keys into the existing extendInfo block.
  const extendInfoEnd = findBlockEnd(lines, extendInfoIdx);
  Object.keys(keys).forEach((k) => {
    const re = new RegExp(`^\\s{4}${k}\\s*:`);
    let exists = false;
    for (let i = extendInfoIdx + 1; i < extendInfoEnd; i += 1) {
      if (re.test(lines[i])) {
        lines[i] = `    ${k}: ${formatValue(keys[k])}`;
        exists = true;
        break;
      }
    }
    if (!exists) {
      lines.splice(extendInfoIdx + 1, 0, `    ${k}: ${formatValue(keys[k])}`);
    }
  });

  return lines.join('\n');
}

function findTopLevelKey(lines, key) {
  const re = new RegExp(`^${key}\\s*:`);
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

// Returns the index AFTER the last line of the block starting at startIdx.
function findBlockEnd(lines, startIdx) {
  const startIndent = lines[startIdx].match(/^(\s*)/)[1].length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    const indent = lines[i].match(/^(\s*)/)[1].length;
    if (indent <= startIndent) return i;
  }
  return lines.length;
}

function formatValue(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number')  return String(v);
  // Quote strings that contain anything spicy, otherwise plain.
  if (typeof v === 'string') {
    return /[:#"'\n]/.test(v) ? JSON.stringify(v) : v;
  }
  return JSON.stringify(v);
}

// Replace (or append) the top-level `publish:` block in a YAML string with our { provider, owner, repo }.
// We always overwrite — the consumer's source yml may have had a placeholder publish block that
// we'll respect-but-replace from config.releases.
function injectPublish(yml, publish) {
  const lines = yml.split('\n');
  const pubIdx = findTopLevelKey(lines, 'publish');

  const block = [
    'publish:',
    `  provider: ${publish.provider}`,
    `  owner: ${publish.owner}`,
    `  repo: ${publish.repo}`,
    `  releaseType: ${publish.releaseType || 'release'}`,
  ];

  if (pubIdx === -1) {
    // No existing publish block — append.
    let out = yml;
    if (!out.endsWith('\n')) out += '\n';
    out += '\n' + block.join('\n') + '\n';
    return out;
  }

  // Replace the existing block (handles both inline `publish:` and indented children).
  const blockEnd = findBlockEnd(lines, pubIdx);
  lines.splice(pubIdx, blockEnd - pubIdx, ...block);
  return lines.join('\n');
}

// Replace (or append) the top-level `afterSign:` line in a YAML string. We always overwrite —
// EM's notarize is the source of truth; consumer's hooks/notarize/post.js is an extension
// point that EM's notarize itself invokes.
function injectAfterSign(yml, hookPath) {
  const lines = yml.split('\n');
  const idx = findTopLevelKey(lines, 'afterSign');
  // YAML strings get JSON-stringified to handle absolute paths with special chars.
  const newLine = `afterSign: ${JSON.stringify(hookPath)}`;

  if (idx === -1) {
    let out = yml;
    if (!out.endsWith('\n')) out += '\n';
    out += '\n' + newLine + '\n';
    return out;
  }

  lines[idx] = newLine;
  return lines.join('\n');
}

// Exported for tests.
module.exports.injectMacExtendInfo = injectMacExtendInfo;
module.exports.injectPublish = injectPublish;
module.exports.injectAfterSign = injectAfterSign;
