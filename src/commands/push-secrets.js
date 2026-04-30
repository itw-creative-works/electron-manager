// Push secrets from local .env to GitHub Actions repo secrets.
//
// Reads .env at the repo root, encrypts each value with the repo's libsodium public key,
// pushes via Octokit. For env vars whose value is a path to an existing file (e.g.
// CSC_LINK=build/certs/dev-id.p12), the secret value is the base64-encoded file contents
// — the workflow then decodes back to a temp file at job start.
//
// Usage:
//   npx mgr push-secrets                       # push all keys from .env Default section
//   npx mgr push-secrets --only=GH_TOKEN,CSC_LINK
//   npx mgr push-secrets --skip-empty=false    # also push empty values (not recommended)

const path = require('path');
const fs = require('fs');
const jetpack = require('fs-jetpack');

const Manager = new (require('../build.js'));
const logger = Manager.logger('push-secrets');
const { discoverRepo } = require('../utils/github.js');

const DEFAULT_MARKER = '# ========== Default Values ==========';
const CUSTOM_MARKER  = '# ========== Custom Values ==========';

module.exports = async function (options) {
  options = options || {};
  const projectRoot = process.cwd();

  // 1. Load .env (raw read so we can split into Default/Custom sections).
  const envPath = path.join(projectRoot, '.env');
  if (!jetpack.exists(envPath)) {
    throw new Error(`.env not found at ${envPath}. Create one based on .env.example.`);
  }
  // Also load via dotenv into process.env so the GH_TOKEN we use to push is available.
  require('dotenv').config({ path: envPath });

  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!ghToken) {
    throw new Error('GH_TOKEN not set in .env. Generate a PAT with `repo` scope at https://github.com/settings/tokens');
  }

  // 2. Parse the .env into key=value pairs from the Default section
  //    (the Custom section is the user's domain — don't touch it).
  const envContent = jetpack.read(envPath);
  const allEntries = parseEnv(envContent);
  const defaultEntries = allEntries.filter((e) => e.section === 'default');

  // 3. Filter via --only / --skip
  let entries = defaultEntries;
  if (options.only) {
    const only = String(options.only).split(',').map((s) => s.trim()).filter(Boolean);
    entries = entries.filter((e) => only.includes(e.key));
  }

  const skipEmpty = options.skipEmpty !== false && options['skip-empty'] !== 'false';
  if (skipEmpty) {
    entries = entries.filter((e) => e.value && e.value.trim().length > 0);
  }

  if (entries.length === 0) {
    logger.warn('No secrets to push (after filtering). Did you forget to fill in .env?');
    return;
  }

  // 4. Discover owner/repo
  const { owner, repo } = await discoverRepo(projectRoot);
  logger.log(`Pushing ${entries.length} secret(s) to ${owner}/${repo}...`);

  // 5. Get the repo's public key for libsodium encryption
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: ghToken });
  const publicKeyRes = await octokit.rest.actions.getRepoPublicKey({ owner, repo });
  const { key: publicKey, key_id } = publicKeyRes.data;

  const sodium = require('libsodium-wrappers');
  await sodium.ready;

  // 6. Push each.
  let successCount = 0;
  for (const entry of entries) {
    const secretValue = await resolveSecretValue(entry, projectRoot);
    if (secretValue == null) {
      logger.warn(`Skipping ${entry.key} (could not resolve value).`);
      continue;
    }

    const encrypted = encryptSecret(sodium, publicKey, secretValue);

    try {
      await octokit.rest.actions.createOrUpdateRepoSecret({
        owner,
        repo,
        secret_name: entry.key,
        encrypted_value: encrypted,
        key_id,
      });
      const tag = entry.isFilePath ? 'file' : 'string';
      logger.log(logger.format.green(`✓ ${entry.key} (${tag}, ${secretValue.length} bytes encrypted)`));
      successCount += 1;
    } catch (e) {
      logger.error(`✗ ${entry.key}: ${e.message}`);
    }
  }

  logger.log(logger.format.green(`Pushed ${successCount}/${entries.length} secret(s) to ${owner}/${repo}.`));
};

// Parse a .env file into entries with section info.
// Returns: [{ key, value, section: 'default' | 'custom' }, ...]
function parseEnv(content) {
  const lines = (content || '').split('\n');
  const entries = [];
  let section = 'default';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === DEFAULT_MARKER) { section = 'default'; continue; }
    if (trimmed === CUSTOM_MARKER)  { section = 'custom';  continue; }
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip wrapping quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    entries.push({ key, value, section });
  }
  return entries;
}

// Determine the secret value to push:
//   - If value looks like a path AND the file exists → base64-encoded file contents
//   - Otherwise → value as-is
async function resolveSecretValue(entry, projectRoot) {
  const v = entry.value;
  if (!v) return v;

  // Heuristic: relative or absolute path, ending in a typical cert/key extension
  // OR an existing file regardless of extension.
  const looksLikePath = /[/\\]/.test(v) || /\.(p12|pem|cer|p8|provisionprofile|crt|key|json)$/i.test(v);
  if (!looksLikePath) return v;

  const absolute = path.isAbsolute(v) ? v : path.join(projectRoot, v);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return v; // value contains slashes but doesn't exist — push as-is
  }

  entry.isFilePath = true;
  const buf = fs.readFileSync(absolute);
  return buf.toString('base64');
}

function encryptSecret(sodium, publicKey, value) {
  const messageBytes = Buffer.from(value);
  const keyBytes = Buffer.from(publicKey, 'base64');
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  return Buffer.from(encryptedBytes).toString('base64');
}

// Exported for tests.
module.exports.parseEnv = parseEnv;
module.exports.resolveSecretValue = resolveSecretValue;
module.exports.discoverRepo = discoverRepo;
