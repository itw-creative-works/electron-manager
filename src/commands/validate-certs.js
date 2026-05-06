// Validate code-signing prerequisites (certs, profiles, env vars).
//
// Runs as part of `npx mgr setup` (non-fatal — warns and continues so scaffolding
// finishes even if certs aren't ready yet) and standalone via `npx mgr validate-certs`.
//
// Exit codes:
//   0  all checks passed
//   1  failures (only when --strict is passed; otherwise we always exit 0 and just warn)

const path = require('path');
const fs = require('fs');
const jetpack = require('fs-jetpack');
const { execute } = require('node-powertools');

const Manager = new (require('../build.js'));
const logger = Manager.logger('validate-certs');

module.exports = async function (options) {
  options = options || {};
  const strict = options.strict === true || options._?.includes?.('--strict');

  logger.log('Validating signing prerequisites...');

  const platform = process.platform;
  const config = Manager.getConfig();
  const winStrategy = Manager.getWindowsSignStrategy();

  const issues = [];

  // macOS checks (run on any platform if cert files are present in build/certs/, since
  // CI builds happen cross-platform — useful to flag bad files even when running on win/linux).
  await checkMac(issues, config);

  if (platform === 'win32') {
    checkWindows(issues, winStrategy, config);
  }

  // Report.
  if (issues.length === 0) {
    logger.log(logger.format.green('All signing prerequisites OK.'));
    return { ok: true };
  }

  for (const issue of issues) {
    if (issue.severity === 'error') {
      logger.error(`✗ ${issue.message}`);
    } else {
      logger.warn(`⚠ ${issue.message}`);
    }
  }

  if (strict && issues.some((i) => i.severity === 'error')) {
    throw new Error(`${issues.length} validation issue(s) — see above.`);
  }

  return { ok: false, issues };
};

async function checkMac(issues, config) {
  const projectRoot = process.cwd();
  const certsDir = path.join(projectRoot, 'build', 'certs');
  const buildDir = path.join(projectRoot, 'build');
  const expectedAppId = config?.app?.appId
                     || `com.itwcw.${config?.brand?.id || 'app'}`;

  // 1. Developer ID Application .p12
  const cscLink = process.env.CSC_LINK;
  if (cscLink) {
    const p12Path = path.isAbsolute(cscLink) ? cscLink : path.join(projectRoot, cscLink);
    if (!jetpack.exists(p12Path)) {
      issues.push({ severity: 'error', message: `CSC_LINK points to a missing file: ${p12Path}` });
    } else if (!process.env.CSC_KEY_PASSWORD) {
      issues.push({ severity: 'warn', message: 'CSC_KEY_PASSWORD not set — signing will fail.' });
    } else {
      logger.log(logger.format.green(`✓ Developer ID Application cert at ${path.relative(projectRoot, p12Path)}`));
    }
  } else if (jetpack.exists(certsDir)) {
    // Look for the file even if env not pointed
    const p12Files = jetpack.find(certsDir, { matching: '*.p12', recursive: false }) || [];
    if (p12Files.length === 0) {
      issues.push({ severity: 'warn', message: `No .p12 found in build/certs/ and CSC_LINK not set. (Required for macOS signing.)` });
    } else {
      issues.push({ severity: 'warn', message: `Found .p12 in build/certs/ but CSC_LINK env var is not set. Set CSC_LINK=${path.relative(projectRoot, p12Files[0])}` });
    }
  } else {
    issues.push({ severity: 'warn', message: 'No build/certs/ directory and no CSC_LINK env var. Skipping mac cert check.' });
  }

  // 2. Provisioning profile (optional — only some apps need one)
  const provisionFiles = jetpack.exists(buildDir)
    ? (jetpack.find(buildDir, { matching: '*.provisionprofile', recursive: false }) || [])
    : [];
  for (const profPath of provisionFiles) {
    try {
      const parsed = parseProvision(profPath);
      const rel = path.relative(projectRoot, profPath);

      if (!parsed.parsed || !parsed.raw) {
        issues.push({ severity: 'error', message: `${rel}: could not parse plist payload.` });
        continue;
      }

      const exp = parsed.parsed.ExpirationDate;
      if (exp && new Date(exp) < new Date()) {
        issues.push({ severity: 'error', message: `${rel}: EXPIRED on ${new Date(exp).toISOString()}.` });
        continue;
      }

      // Days until expiry — warn if < 30 days
      if (exp) {
        const daysLeft = Math.floor((new Date(exp) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft < 30) {
          issues.push({ severity: 'warn', message: `${rel}: expires in ${daysLeft} day(s) — renew soon.` });
        }
      }

      // App ID match — provisioning profiles embed the app-id-prefix.bundle-id.
      // Be lenient: just check the bundle id appears anywhere in the raw plist text.
      if (expectedAppId && !parsed.raw.includes(expectedAppId)) {
        issues.push({ severity: 'error', message: `${rel}: does not contain expected appId "${expectedAppId}". This profile is for a different app.` });
        continue;
      }

      logger.log(logger.format.green(`✓ ${rel} (expires ${exp ? new Date(exp).toISOString().slice(0,10) : 'unknown'})`));
    } catch (e) {
      issues.push({ severity: 'error', message: `${path.relative(projectRoot, profPath)}: parse failed: ${e.message}` });
    }
  }

  // 3. Notarization API key (.p8)
  const apiKeyEnv = process.env.APPLE_API_KEY;
  if (apiKeyEnv) {
    const p8Path = path.isAbsolute(apiKeyEnv) ? apiKeyEnv : path.join(projectRoot, apiKeyEnv);
    if (!jetpack.exists(p8Path)) {
      issues.push({ severity: 'error', message: `APPLE_API_KEY points to a missing file: ${p8Path}` });
    } else {
      // Check the filename includes the key id (Apple's filename convention is AuthKey_<KEY_ID>.p8).
      const keyId = process.env.APPLE_API_KEY_ID;
      const issuer = process.env.APPLE_API_ISSUER;
      const filenameKeyId = path.basename(p8Path).match(/AuthKey_([A-Z0-9]+)\.p8$/i)?.[1];

      if (!keyId) {
        issues.push({ severity: 'warn', message: 'APPLE_API_KEY set but APPLE_API_KEY_ID is missing.' });
      } else if (filenameKeyId && filenameKeyId !== keyId) {
        issues.push({ severity: 'warn', message: `APPLE_API_KEY filename suggests key ID "${filenameKeyId}" but APPLE_API_KEY_ID is "${keyId}". Likely a typo.` });
      }

      if (!issuer) {
        issues.push({ severity: 'warn', message: 'APPLE_API_KEY set but APPLE_API_ISSUER is missing.' });
      }

      logger.log(logger.format.green(`✓ Notarization API key at ${path.relative(projectRoot, p8Path)}`));
    }
  } else {
    issues.push({ severity: 'warn', message: 'No APPLE_API_KEY set. Required for notarization (`npm run release`).' });
  }

  // 4. Apple Team ID format check
  const teamId = process.env.APPLE_TEAM_ID;
  if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) {
    issues.push({ severity: 'warn', message: `APPLE_TEAM_ID="${teamId}" doesn't match the expected 10-character format.` });
  }

  // 5. macOS Keychain identity (only when running on macOS — irrelevant on win/linux)
  if (process.platform === 'darwin') {
    try {
      const out = await execute('security find-identity -v -p codesigning', { log: false });
      const identities = String(out || '');
      if (!identities.includes('Developer ID Application')) {
        issues.push({ severity: 'warn', message: 'No "Developer ID Application" identity in macOS Keychain. Import your .p12 via Keychain Access.' });
      } else {
        logger.log(logger.format.green('✓ Keychain has Developer ID Application identity.'));
      }
    } catch (e) {
      issues.push({ severity: 'warn', message: `Could not query macOS Keychain: ${e.message}` });
    }
  }
}

function checkWindows(issues, strategy, config) {
  logger.log(`Checking Windows signing prerequisites (strategy: ${strategy})...`);

  if (strategy === 'self-hosted' || strategy === 'local') {
    const tokenPath = process.env.WIN_EV_TOKEN_PATH || process.env.WIN_CSC_LINK;
    if (!tokenPath) {
      issues.push({ severity: 'error', message: 'Set WIN_EV_TOKEN_PATH (or WIN_CSC_LINK) to the EV token / certificate path.' });
      return;
    }
    if (!process.env.WIN_CSC_KEY_PASSWORD) {
      issues.push({ severity: 'warn', message: 'WIN_CSC_KEY_PASSWORD not set — signing will fail.' });
    }
    logger.log(logger.format.green(`✓ Windows EV token path present (strategy=${strategy}).`));
    return;
  }

  if (strategy === 'cloud') {
    const provider = config?.targets?.win?.signing?.cloud?.provider;
    if (!provider) {
      issues.push({ severity: 'error', message: 'Cloud signing strategy selected but no provider set (config.targets.win.signing.cloud.provider).' });
      return;
    }
    const required = {
      azure:    ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT'],
      sslcom:   ['SSLCOM_USERNAME', 'SSLCOM_PASSWORD', 'SSLCOM_CREDENTIAL_ID'],
      digicert: ['DIGICERT_API_KEY', 'DIGICERT_KEYPAIR_ALIAS'],
    }[provider] || [];

    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      issues.push({ severity: 'error', message: `Missing cloud-signing env vars for ${provider}: ${missing.join(', ')}` });
      return;
    }
    logger.log(logger.format.green(`✓ Cloud signing provider "${provider}" configured.`));
    return;
  }

  issues.push({ severity: 'error', message: `Unknown Windows signing strategy: ${strategy}` });
}

// Parse a provisioning profile (a CMS-signed plist). Extract the embedded plist payload.
function parseProvision(filepath) {
  const raw = jetpack.read(filepath);
  if (!raw) return { parsed: null, raw: null };

  const match = raw.match(/<\?xml(.|\n)*?<\/plist>/);
  if (!match) return { parsed: null, raw: null };

  const xml = match[0];
  let parsed;
  try {
    parsed = require('plist').parse(xml);
  } catch (e) {
    return { parsed: null, raw: xml };
  }
  return { parsed, raw: xml };
}

// Exported for tests.
module.exports.parseProvision = parseProvision;
