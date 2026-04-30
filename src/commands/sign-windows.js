// Strategy-aware Windows code signer.
//
// Reads strategy from EM_WIN_SIGN_STRATEGY env (or config.signing.windows.strategy):
//   self-hosted — sign with signtool against an EV USB token (typically on a self-hosted runner)
//   cloud       — shell out to a cloud signing provider's CLI (Azure / SSL.com / DigiCert)
//   local       — no-op (developer signs manually on their own Windows box)
//
// Usage:
//   npx mgr sign-windows                                 # sign every .exe/.msi under ./release
//   npx mgr sign-windows --in release/ --out release/signed/
//   npx mgr sign-windows --verify-only                   # don't sign, just verify existing signatures
//   npx mgr sign-windows --smoke                         # sign a 1-byte dummy .exe to validate the setup
//   npx mgr sign-windows --target some-binary.exe        # sign a single specific file
//
// Cloud provider modules will live in src/lib/sign-providers/{azure,sslcom,digicert}.js
// (Pass 3 work). For now the cloud branch logs the intended provider command and exits cleanly.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const jetpack = require('fs-jetpack');
const { execute } = require('node-powertools');

const Manager = new (require('../build.js'));
const logger = Manager.logger('sign-windows');
const { startAutoUnlock } = require('../lib/sign-helpers/auto-unlock.js');

module.exports = async function (options) {
  options = options || {};

  // Smoke test mode: create a 1-byte .exe in a temp dir, sign it, verify it, clean up.
  // This is the fastest possible end-to-end check that the EV token, drivers, signtool,
  // and password cache are all working — no EM build required.
  if (options.smoke) {
    return smokeTest();
  }

  const strategy = process.env.EM_WIN_SIGN_STRATEGY || Manager.getWindowsSignStrategy();
  const config   = Manager.getConfig();
  const projectRoot = process.cwd();

  // Resolve --in and --out (CLI flags) → directories of unsigned / signed artifacts.
  const inDir  = options.in  ? path.resolve(projectRoot, options.in)  : path.join(projectRoot, 'release');
  const outDir = options.out ? path.resolve(projectRoot, options.out) : path.join(projectRoot, 'release', 'signed');

  // Single-target shortcut — useful for debugging a specific failure.
  let targets;
  if (options.target) {
    const t = path.resolve(projectRoot, options.target);
    if (!jetpack.exists(t)) throw new Error(`--target file does not exist: ${t}`);
    targets = [t];
  } else {
    if (!jetpack.exists(inDir)) {
      throw new Error(`Input directory does not exist: ${inDir}`);
    }
    targets = jetpack.find(inDir, { matching: ['*.exe', '*.msi'], recursive: true, files: true, directories: false });
    if (targets.length === 0) {
      logger.warn(`No .exe / .msi files found under ${inDir} — nothing to sign.`);
      return;
    }
  }

  // Verify-only mode: don't sign anything, just run signtool verify against each.
  if (options['verify-only'] || options.verifyOnly) {
    return verifyOnly(targets);
  }

  jetpack.dir(outDir);

  logger.log(`Signing ${targets.length} artifact(s) — strategy=${strategy}, in=${path.relative(projectRoot, inDir)}, out=${path.relative(projectRoot, outDir)}`);

  if (strategy === 'self-hosted' || strategy === 'local') {
    if (strategy === 'local') {
      logger.warn('strategy=local — this command will run signtool against whatever cert config the local box has. Make sure your EV token is plugged in.');
    }
    await signWithSigntool(targets, inDir, outDir);
    return;
  }

  if (strategy === 'cloud') {
    const provider = process.env.WIN_CLOUD_SIGN_PROVIDER || config?.signing?.windows?.cloud?.provider;
    if (!provider) {
      throw new Error('strategy=cloud but no provider set (WIN_CLOUD_SIGN_PROVIDER or config.signing.windows.cloud.provider).');
    }
    await signWithCloudProvider(provider, targets, inDir, outDir);
    return;
  }

  throw new Error(`Unknown Windows signing strategy: ${strategy}`);
};

// signtool path (Windows SDK). Falls back to plain `signtool` on PATH.
function getSigntoolPath() {
  if (process.env.SIGNTOOL_PATH) return process.env.SIGNTOOL_PATH;
  return 'signtool'; // assume on PATH; SDK installers add it
}

// Detect whether WIN_EV_TOKEN_PATH is a SHA1 thumbprint (40 hex chars, optional spaces)
// vs. a file path. SafeNet/eToken-managed certs live in the user store and are selected
// by thumbprint via /sha1; .pfx files are passed via /f + /p.
function isThumbprint(value) {
  if (!value) return false;
  const stripped = value.replace(/\s+/g, '');
  return /^[0-9a-fA-F]{40}$/.test(stripped);
}

async function signWithSigntool(targets, inDir, outDir) {
  const projectRoot = process.cwd();
  const tokenRef   = process.env.WIN_EV_TOKEN_PATH || process.env.WIN_CSC_LINK;
  const password   = process.env.WIN_CSC_KEY_PASSWORD;

  if (!tokenRef) {
    throw new Error('WIN_EV_TOKEN_PATH (or WIN_CSC_LINK) not set — cannot sign.');
  }

  const useThumbprint = isThumbprint(tokenRef);

  // Thumbprint mode (SafeNet/eToken): signtool finds cert in user store, SafeNet handles auth.
  // File mode (.pfx): /f + /p, password handed to signtool directly.
  if (!useThumbprint && !password) {
    throw new Error('WIN_CSC_KEY_PASSWORD not set — required when WIN_EV_TOKEN_PATH is a .pfx path.');
  }

  const signtool = getSigntoolPath();
  const timestampUrl = process.env.WIN_TIMESTAMP_URL || 'http://timestamp.sectigo.com';

  for (const target of targets) {
    const rel = path.relative(inDir, target);
    const outPath = path.join(outDir, rel);
    jetpack.dir(path.dirname(outPath));

    // Copy first, sign in place at the output location (signtool modifies in-place).
    jetpack.copy(target, outPath, { overwrite: true });

    const certArgs = useThumbprint
      ? [`/sha1 ${tokenRef.replace(/\s+/g, '')}`]
      : [`/f "${tokenRef}"`, `/p "${password}"`];

    const cmd = [
      `"${signtool}"`,
      'sign',
      ...certArgs,
      `/tr "${timestampUrl}"`,
      '/td sha256',
      '/fd sha256',
      `"${outPath}"`,
    ].join(' ');

    logger.log(`Signing ${path.relative(projectRoot, outPath)}${useThumbprint ? ' (thumbprint mode)' : ''}...`);

    // In thumbprint mode against a SafeNet/eToken cert, signtool triggers a
    // "Token Logon" dialog. Start a watcher that types the password into it.
    const unlock = useThumbprint ? startAutoUnlock({ password, logger }) : { stop: () => {} };
    try {
      await execute(cmd, { log: false });
    } finally {
      unlock.stop();
    }

    const verifyCmd = `"${signtool}" verify /pa "${outPath}"`;
    await execute(verifyCmd, { log: false });
    logger.log(logger.format.green(`✓ Signed: ${path.relative(projectRoot, outPath)}`));
  }
}

// Verify-only: run signtool verify /pa against each target, report whether it's signed.
// Doesn't fail if some are unsigned — reports each.
async function verifyOnly(targets) {
  const signtool = getSigntoolPath();
  let signed = 0;
  let unsigned = 0;
  let errored = 0;

  for (const t of targets) {
    try {
      const out = await execute(`"${signtool}" verify /pa /v "${t}"`, { log: false });
      const trimmed = String(out || '').trim();
      // signtool prints things like "Successfully verified" or details about the chain.
      if (/Successfully verified/i.test(trimmed)) {
        logger.log(logger.format.green(`✓ Signed: ${t}`));
        // Pull the subject CN out for visibility.
        const cn = trimmed.match(/Issued to:\s*(.+)/i)?.[1];
        if (cn) logger.log(`  Subject: ${cn.trim()}`);
        signed += 1;
      } else {
        logger.warn(`? Unclear verify output for: ${t}`);
        logger.log(trimmed.split('\n').slice(0, 5).join('\n'));
        errored += 1;
      }
    } catch (e) {
      // signtool exits non-zero on unsigned files.
      logger.warn(`✗ Unsigned or invalid: ${t}`);
      const msg = String(e?.message || e).split('\n').slice(0, 3).join(' ');
      logger.log(`  ${msg}`);
      unsigned += 1;
    }
  }

  logger.log(`Verify summary: ${signed} signed, ${unsigned} unsigned, ${errored} unclear (of ${targets.length} total).`);
  return { signed, unsigned, errored, total: targets.length };
}

// Smoke test: write a 1-byte .exe to %TEMP%, run the full self-hosted signing flow against it.
// Validates that EV token, SafeNet drivers, signtool, and the password cache are all functional
// without needing an actual EM build. Cleans up after itself.
async function smokeTest() {
  if (process.platform !== 'win32') {
    throw new Error('--smoke is Windows-only (signtool is required).');
  }

  const tokenRef = process.env.WIN_EV_TOKEN_PATH || process.env.WIN_CSC_LINK;
  const password = process.env.WIN_CSC_KEY_PASSWORD;
  if (!tokenRef) {
    throw new Error('WIN_EV_TOKEN_PATH (or WIN_CSC_LINK) not set — set a SHA1 thumbprint (SafeNet/eToken) or a .pfx path in your .env before running --smoke.');
  }
  const useThumbprint = isThumbprint(tokenRef);
  if (!useThumbprint && !password) {
    throw new Error('WIN_CSC_KEY_PASSWORD not set — required when WIN_EV_TOKEN_PATH is a .pfx path.');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-smoke-'));
  // Build a minimal valid PE/COFF .exe: copy whichever tiny system .exe is around.
  // Easiest source: %WINDIR%\System32\where.exe (small, always present, copy is OK).
  const sourceExe = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'where.exe');
  const target    = path.join(tmp, 'em-smoke-test.exe');
  if (!jetpack.exists(sourceExe)) {
    throw new Error(`Could not find a sample .exe to sign at ${sourceExe}. Pass --target <path> instead.`);
  }
  jetpack.copy(sourceExe, target, { overwrite: true });

  logger.log(`Smoke test: signing a temp copy of where.exe at ${target}`);
  logger.log(`Cert ref: ${tokenRef}${useThumbprint ? ' (thumbprint mode — SafeNet handles auth)' : ' (file mode)'}`);

  try {
    await signWithSigntool([target], path.dirname(target), path.dirname(target));
    logger.log(logger.format.green('✓ Smoke test passed — EV token + signtool + password cache all working.'));
  } catch (e) {
    logger.error(`Smoke test FAILED: ${e.message}`);
    logger.log('Most common causes:');
    logger.log('  • EV token not plugged in or not detected by SafeNet');
    logger.log('  • SafeNet driver not installed');
    logger.log('  • WIN_CSC_KEY_PASSWORD wrong or token locked (check tray icon)');
    logger.log('  • signtool.exe not on PATH (Windows SDK or VS Build Tools required)');
    throw e;
  } finally {
    try { jetpack.remove(tmp); } catch (e) { /* ignore */ }
  }
}

async function signWithCloudProvider(provider, targets, inDir, outDir) {
  // Provider modules live in src/lib/sign-providers/<name>.js. Each exports
  //   async function sign({ targets, inDir, outDir, projectRoot, env }) { ... }
  let providerModule;
  try {
    providerModule = require(path.join(__dirname, '..', 'lib', 'sign-providers', `${provider}.js`));
  } catch (e) {
    throw new Error(`Cloud provider "${provider}" is not yet implemented (no src/lib/sign-providers/${provider}.js). Supported: azure, sslcom, digicert.`);
  }

  if (typeof providerModule.sign !== 'function') {
    throw new Error(`sign-providers/${provider}.js does not export a sign() function.`);
  }

  await providerModule.sign({
    targets,
    inDir,
    outDir,
    projectRoot: process.cwd(),
    env:         process.env,
    logger,
  });
}
