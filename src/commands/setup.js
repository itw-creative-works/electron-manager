// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('setup');
const path = require('path');
const jetpack = require('fs-jetpack');
const version = require('wonderful-version');
const { execute, force } = require('node-powertools');
const NPM = require('npm-api');

// Load packages
const package = Manager.getPackage('main');
const project = Manager.getPackage('project');
const rootPathProject = Manager.getRootPath('project');

// Peer-dep install location overrides
const DEPENDENCY_MAP = {
  gulp: 'dev',
  electron: 'dev',
  'electron-builder': 'dev',
};

module.exports = async function (options) {
  options = options || {};
  options.checkManager = force(options.checkManager || true, 'boolean');
  options.checkNode = force(options.checkNode || true, 'boolean');
  options.checkPeerDependencies = force(options.checkPeerDependencies || true, 'boolean');
  options.setupScripts = force(options.setupScripts || true, 'boolean');
  options.copyDefaults = force(options.copyDefaults || true, 'boolean');
  options.checkLocality = force(options.checkLocality || true, 'boolean');
  options.pushSecrets = options.pushSecrets !== false; // default true

  // Quick mode (mirrors UJM's UJ_QUICK pattern): skip every network-bound / GitHub-talking /
  // cert-checking step. Keep only the local-only, idempotent, fast steps (scaffold, projectScripts,
  // .nvmrc write, locality check). Used for inner-loop dev once a full setup has succeeded once.
  // Triggered by `--quick` / `-q` CLI flag (or `EM_QUICK=true` env), plumbed via Manager.isQuickMode().
  if (options.quick === true || options.q === true || Manager.isQuickMode()) {
    logger.log('Quick mode: Skipping slow setup operations');
    options.checkManager          = false;
    options.checkNode             = false;
    options.checkPeerDependencies = false;
    options.validateCerts         = false;
    options.provisionRepos        = false;
    options.pushSecrets           = false;
  }

  logger.log(`Welcome to ${package.name} v${package.version}!`);
  logger.log('options', options);

  project.dependencies = project.dependencies || {};
  project.devDependencies = project.devDependencies || {};

  await logCWD();

  if (options.checkManager) {
    await updateManager();
  }

  // Setup projectScripts FIRST — these are pure package.json edits, don't depend on Node version
  // or peer deps being correct. Critical that this runs before any potentially-throwing step like
  // ensureNodeVersion, since the consumer needs the postinstall script wired up regardless.
  if (options.setupScripts) {
    setupScripts();
  }

  // Resolve the required Node major from the consumer's electron version (via the electron
  // releases feed). Falls back to EM's package.json engines.node if the lookup fails.
  // Write .nvmrc FIRST so the pin is correct even if the user's current Node is stale.
  if (options.checkNode !== false) {
    const requiredMajor = await resolveRequiredNodeMajor();
    ensureNvmrc(requiredMajor);
    if (options.checkNode) {
      await ensureNodeVersion(requiredMajor);
    }
  }

  if (options.checkPeerDependencies) {
    await ensurePeerDependencies();
  }

  if (options.copyDefaults) {
    await copyDefaults();
  }

  if (options.checkLocality) {
    checkLocality();
  }

  // Validate signing prereqs as a soft check — never fails setup, just warns so the
  // user knows what's missing before they try to release. Skip if explicitly disabled.
  if (options.validateCerts !== false) {
    try {
      const validateCerts = require('./validate-certs.js');
      const result = await validateCerts({ strict: false });
      if (result?.ok === false) {
        logger.log('(Run `npx mgr validate-certs` after wiring up your signing assets to re-check.)');
      }
    } catch (e) {
      logger.warn(`validate-certs threw during setup (non-fatal): ${e.message}`);
    }
  }

  // Auto-provision the public release/download repos referenced in config.releases / config.downloads.
  // Idempotent: only creates if missing. Skipped silently if GH_TOKEN missing or config.releases.enabled = false.
  if (options.provisionRepos !== false) {
    try {
      const fs = require('fs');
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });
      if (process.env.GH_TOKEN) {
        await provisionReleaseRepos();
      } else {
        logger.log('(Skipping repo provisioning: GH_TOKEN not set.)');
      }
    } catch (e) {
      logger.warn(`provision-repos failed during setup (non-fatal): ${e.message}`);
    }
  }

  // Push secrets to GitHub Actions. Auto-runs every setup so CI always reflects local .env.
  // Skipped silently if .env or GH_TOKEN is missing (so first-time setups before creds are
  // wired up don't error out). Disable with options.pushSecrets = false.
  if (options.pushSecrets !== false) {
    try {
      const fs = require('fs');
      const envPath = path.join(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) {
        logger.log('(Skipping push-secrets: no .env at project root.)');
      } else {
        require('dotenv').config({ path: envPath });
        if (!process.env.GH_TOKEN) {
          logger.log('(Skipping push-secrets: GH_TOKEN not set in .env. Run `npx mgr push-secrets` after filling it in.)');
        } else {
          const pushSecrets = require('./push-secrets.js');
          await pushSecrets({});
        }
      }
    } catch (e) {
      logger.warn(`push-secrets failed during setup (non-fatal): ${e.message}`);
    }
  }
};

async function logCWD() {
  logger.log('Current working directory:', process.cwd());
}

async function updateManager() {
  const npm = new NPM();
  const installedVersion = project.devDependencies[package.name];

  if (!installedVersion) {
    throw new Error(`No installed version of ${package.name} found in devDependencies.`);
  }

  const latestVersion = await npm.repo(package.name)
    .package()
    .then((pkg) => pkg.version, () => '0.0.0');

  const isUpToDate = version.is(installedVersion, '>=', latestVersion);
  const levelDifference = version.levelDifference(installedVersion, latestVersion);

  logVersionCheck(package.name, installedVersion, latestVersion, isUpToDate);

  if (installedVersion.startsWith('file:')) {
    return;
  }

  if (!isUpToDate) {
    if (levelDifference === 'major' && installedVersion !== 'latest') {
      return logger.error(`Major version difference detected. Please update to ${latestVersion} manually.`);
    }
    await install(package.name, latestVersion);
  }
}

// Resolve the required Node major for the consumer's installed electron version by hitting
// the official electron releases feed. Falls back to EM's own engines.node if the network is
// down or the electron version can't be resolved.
async function resolveRequiredNodeMajor() {
  // Look at the consumer's electron version FIRST (peer dep), then fall back to EM's pin.
  const consumerElectron = project?.devDependencies?.electron || project?.dependencies?.electron || package?.peerDependencies?.electron;
  if (consumerElectron) {
    try {
      const { resolveNodeMajorForElectron } = require('../utils/electron-node-version.js');
      const node = await resolveNodeMajorForElectron(consumerElectron);
      if (node) return node;
    } catch (e) { /* fall through to static value */ }
  }
  // Fallback: EM's package.json engines.node (last-known-good).
  return version.clean(package.engines.node).split('.')[0];
}

async function ensureNodeVersion(requiredMajor) {
  const installedMajor = version.clean(process.version).split('.')[0];
  const matches = String(installedMajor) === String(requiredMajor);

  logVersionCheck('Node.js', `v${installedMajor}`, `v${requiredMajor}`, matches);

  if (!matches) {
    throw new Error(
      `Node version mismatch: running v${installedMajor} but Electron requires v${requiredMajor} (matches Electron's bundled Node). ` +
      `Run \`nvm use\` (the .nvmrc has been written to v${requiredMajor}/*) and re-run setup.`,
    );
  }
}

// Write/update the consumer's .nvmrc to match the required Node major. Idempotent.
function ensureNvmrc(requiredMajor) {
  const desired       = `v${requiredMajor}/*`;
  const nvmrcPath     = path.join(rootPathProject, '.nvmrc');
  const existing      = jetpack.read(nvmrcPath);

  if (existing && existing.trim() === desired) {
    logger.log(`✓ .nvmrc is up to date (${desired})`);
    return;
  }

  jetpack.write(nvmrcPath, `${desired}\n`);
  if (existing) {
    logger.log(`✓ .nvmrc updated: ${existing.trim()} → ${desired}`);
  } else {
    logger.log(`✓ .nvmrc created: ${desired}`);
  }
}

async function ensurePeerDependencies() {
  const requiredPeerDependencies = package.peerDependencies || {};

  for (let [dependency, ver] of Object.entries(requiredPeerDependencies)) {
    const projectDependencyVersion = version.clean(project?.dependencies?.[dependency] || project?.devDependencies?.[dependency]);
    const location = DEPENDENCY_MAP[dependency] === 'dev' ? '--save-dev' : '';
    const isUpToDate = version.is(projectDependencyVersion, '>=', ver);

    ver = version.clean(ver);

    logVersionCheck(dependency, projectDependencyVersion, ver, isUpToDate);

    if (!projectDependencyVersion || !isUpToDate) {
      await install(dependency, ver, location);
    }
  }
}

function setupScripts() {
  project.scripts = project.scripts || {};

  Object.keys(package.projectScripts || {}).forEach((key) => {
    project.scripts[key] = package.projectScripts[key];
  });

  // Electron consumer projects should not be published to npm
  project.private = true;

  // Point electron at the built main bundle.
  // The gulp `webpack` task emits dist/main.bundle.js; the consumer's src/main.js is the *source* entry.
  project.main = 'dist/main.bundle.js';

  jetpack.write(path.join(process.cwd(), 'package.json'), project);
}

async function copyDefaults() {
  const defaultsDir = path.resolve(__dirname, '..', 'defaults');

  if (!jetpack.exists(defaultsDir)) {
    logger.warn(`Defaults directory not found at ${defaultsDir}`);
    return;
  }

  const { mergeLineBasedFiles } = require('../utils/merge-line-files.js');
  const MERGEABLE_BASENAMES = new Set(['.env', '.gitignore']);

  // Template substitution context — `{{ versions.node }}` etc. resolved at scaffold time.
  // Source of truth is EM's own package.json `engines` block. EM auto-syncs `engines.node`
  // to whatever Electron's bundled Node version is via scripts/sync-nvmrc.js, so consumers'
  // workflows + .nvmrc track Electron-Node automatically without manual bumps.
  const templateContext = { versions: package.engines || {} };
  // Files we run substitution on. Anything else copies byte-for-byte.
  const TEMPLATABLE_EXTS = new Set(['.yml', '.yaml']);
  const TEMPLATABLE_BASENAMES = new Set(['.nvmrc']);

  const files = jetpack.find(defaultsDir, { matching: '**/*', recursive: true, files: true, directories: false });

  for (const src of files) {
    const rel = path.relative(defaultsDir, src);
    // Convert leading `_.` to `.` so dotfiles ship past npm's filter
    const target = rel.split(path.sep).map((part) => part.startsWith('_.') ? part.slice(1) : part).join(path.sep);
    const dest = path.join(rootPathProject, target);
    const basename = path.basename(target);
    const ext      = path.extname(target).toLowerCase();
    const templatable = TEMPLATABLE_EXTS.has(ext) || TEMPLATABLE_BASENAMES.has(basename);

    if (jetpack.exists(dest)) {
      // Line-based files (.env, .gitignore) merge instead of skipping so the framework's
      // default keys/lines stay in sync without clobbering the user's custom values.
      if (MERGEABLE_BASENAMES.has(basename)) {
        try {
          const existing = jetpack.read(dest, 'utf8');
          const incoming = renderTemplate(jetpack.read(src, 'utf8'), templateContext);
          const merged   = mergeLineBasedFiles(existing, incoming, basename);
          if (merged !== existing) {
            jetpack.write(dest, merged);
            logger.log(`Merged default → ${target}`);
          }
        } catch (e) {
          logger.warn(`Failed to merge ${target}: ${e.message}`);
        }
        continue;
      }

      // Templatable files (workflow YAMLs, .nvmrc) are EM-owned: always re-render so they
      // track changes in EM's defaults (e.g. engines.node bumping when Electron updates).
      // Skip the write if the rendered contents are byte-identical to what's already there.
      if (templatable) {
        const incoming = renderTemplate(jetpack.read(src, 'utf8'), templateContext);
        const existing = jetpack.read(dest, 'utf8');
        if (incoming !== existing) {
          jetpack.write(dest, incoming);
          logger.log(`Re-rendered template → ${target}`);
        }
        continue;
      }

      // Non-mergeable, non-templatable, already exists → preserve consumer's version.
      continue;
    }

    if (templatable) {
      const contents = renderTemplate(jetpack.read(src, 'utf8'), templateContext);
      jetpack.write(dest, contents);
    } else {
      jetpack.copy(src, dest);
    }
    logger.log(`Copied default → ${target}`);
  }
}

// Minimal `{{ key.path }}` substitution — same syntax as UJM, no dependencies.
// Whitespace inside the braces is tolerated. Unknown keys render as the original
// `{{ ... }}` string (no error) so non-template content with literal braces survives.
function renderTemplate(content, context) {
  if (typeof content !== 'string' || !content.includes('{{')) return content;
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, keyPath) => {
    const value = keyPath.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), context);
    return (value === undefined || value === null) ? full : String(value);
  });
}

function checkLocality() {
  const installedVersion = project.devDependencies[package.name];

  if (!installedVersion) {
    throw new Error(`No installed version of ${package.name} found in devDependencies.`);
  }

  if (installedVersion.startsWith('file:')) {
    logger.warn(`⚠️  You are using the local version of ${package.name}. This WILL NOT WORK when published.`);
  }
}

function install(pkg, ver, location) {
  ver = ver === 'latest' || !ver ? 'latest' : version.clean(ver);

  const command = `npm install ${pkg}@${ver} ${location || '--save'}`;
  logger.log('Installing:', command);

  return execute(command, { log: true })
    .then(() => {
      const projectUpdated = jetpack.read(path.join(process.cwd(), 'package.json'), 'json');
      project.dependencies = projectUpdated.dependencies || {};
      project.devDependencies = projectUpdated.devDependencies || {};
      logger.log('Installed:', pkg, ver);
    });
}

async function provisionReleaseRepos() {
  const { discoverRepo, getOctokit, ensureRepo } = require('../utils/github.js');
  const octokit = getOctokit();
  if (!octokit) return;

  const config = Manager.getConfig() || {};
  const projectRoot = process.cwd();
  let appOwner;
  try {
    const discovered = await discoverRepo(projectRoot);
    appOwner = discovered.owner;
  } catch (e) {
    logger.warn(`provision-repos: could not discover app owner (${e.message}). Set package.json repository.url.`);
    return;
  }

  const targets = [];
  if (config?.releases?.enabled !== false) {
    targets.push({
      name:        'releases (auto-update feed)',
      owner:       config?.releases?.owner || appOwner,
      repo:        config?.releases?.repo || 'update-server',
      description: `Public release artifacts + auto-update feed for ${appOwner}'s electron-manager apps. Managed by electron-manager.`,
    });
  }
  if (config?.downloads?.enabled !== false) {
    targets.push({
      name:        'downloads (fixed-name mirror)',
      owner:       config?.downloads?.owner || appOwner,
      repo:        config?.downloads?.repo || 'download-server',
      description: `Fixed-name download mirror for ${appOwner}'s electron-manager apps. Managed by electron-manager.`,
    });
  }

  for (const t of targets) {
    try {
      const result = await ensureRepo(octokit, t.owner, t.repo, { description: t.description, private: false });
      if (result.created) {
        logger.log(`provision-repos: ✓ created ${t.owner}/${t.repo} — ${t.name}`);
      } else {
        logger.log(`provision-repos: ✓ ${t.owner}/${t.repo} already exists — ${t.name}`);
      }
    } catch (e) {
      logger.warn(`provision-repos: ✗ ${t.owner}/${t.repo} (${t.name}) — ${e.message}`);
    }
  }
}

function logVersionCheck(name, installedVersion, latestVersion, isUpToDate) {
  if (installedVersion && installedVersion.startsWith('file:')) {
    isUpToDate = true;
  }

  const installedLabel = installedVersion || '(none)';
  const latestLabel = latestVersion || '(unknown)';
  const status = isUpToDate ? logger.format.green('Yes') : logger.format.red('No');

  logger.log(`Checking if ${name} is up to date (${logger.format.bold(installedLabel)} >= ${logger.format.bold(latestLabel)}): ${status}`);
}
