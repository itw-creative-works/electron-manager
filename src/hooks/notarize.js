// Real macOS notarization implementation. Lives inside EM — consumers can extend it via
// hooks/notarize/post.js (called after this completes successfully).
//
// Uses Apple's notarytool with the App Store Connect API key. Legacy Apple ID + app-specific
// password flow is deliberately NOT supported.
//
// Required env vars:
//   APPLE_API_KEY     — path to AuthKey_XXXXXXXXXX.p8 (set by EM CI workflow from base64-encoded secret)
//   APPLE_API_KEY_ID  — 10-char Key ID (matches the XXXXXXXXXX in the filename)
//   APPLE_API_ISSUER  — issuer UUID from App Store Connect → Users and Access → Keys
//
// Skipped automatically when:
//   - building for a non-darwin platform
//   - any of the env vars above is missing (warns, doesn't fail — useful for dev builds without certs)

const path = require('path');
const fs   = require('fs');

module.exports = async function notarize(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleApiKey    = process.env.APPLE_API_KEY;
  const appleApiKeyId  = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;

  if (!appleApiKey || !appleApiKeyId || !appleApiIssuer) {
    console.warn('[notarize] Skipping — set APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER to notarize.');
    return;
  }

  const apiKeyPath = path.isAbsolute(appleApiKey)
    ? appleApiKey
    : path.resolve(process.cwd(), appleApiKey);

  if (!fs.existsSync(apiKeyPath)) {
    throw new Error(`[notarize] APPLE_API_KEY file not found at ${apiKeyPath}`);
  }

  const { notarize } = require('@electron/notarize');
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] Notarizing ${appName} via App Store Connect API key (${appleApiKeyId})...`);
  const start = Date.now();

  await notarize({
    tool:          'notarytool',
    appPath,
    appleApiKey:   apiKeyPath,
    appleApiKeyId,
    appleApiIssuer,
  });

  const duration = Math.round((Date.now() - start) / 1000);
  console.log(`[notarize] Done in ${duration}s.`);

  // After EM's real notarization, optionally invoke the consumer's hooks/notarize/post.js as
  // an extension point. The consumer hook can do post-notarize work (custom stapling,
  // archiving, notifications, etc.). It is purely additive — EM's real notarize always runs
  // first.
  const runConsumerHook = require('../utils/run-consumer-hook.js');
  await runConsumerHook('notarize/post', context);
};
