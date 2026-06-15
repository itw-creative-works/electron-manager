// Empty-string signing env vars are WORSE than unset ones: the consumer .env
// template ships placeholders like CSC_LINK="" so dotenv injects them as
// set-but-empty, and app-builder-lib only null-checks — it then calls
// importCertificate('') whose path.resolve('') lands on the PROJECT ROOT and
// dies with "<projectRoot> not a file". Same hazard for the notarization and
// Windows signing placeholders.
//
// Rule: an empty (or whitespace-only) value on any of these keys means "not
// configured" — delete it so electron-builder's own auto-discovery/skip logic
// applies. Returns the list of removed keys (for logging).

const SIGNING_ENV_KEYS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
];

function sanitizeSigningEnv(env) {
  const removed = [];

  for (const key of SIGNING_ENV_KEYS) {
    if (typeof env[key] === 'string' && env[key].trim() === '') {
      delete env[key];
      removed.push(key);
    }
  }

  return removed;
}

module.exports = sanitizeSigningEnv;
module.exports.SIGNING_ENV_KEYS = SIGNING_ENV_KEYS;
