// Generate dist/electron-builder.yml entirely from EM defaults + the consumer's
// config/electron-manager.json. The consumer NEVER ships an electron-builder.yml.
//
// Why:
//   - Single source of truth: consumer config (electron-manager.json) drives everything.
//   - Stops consumers from drifting into electron-builder-config-fork-of-our-defaults hell.
//   - Lets EM evolve packaging defaults centrally (e.g. switch from NSIS to MSIX someday)
//     without per-consumer migrations.
//
// Consumer overrides:
//   `electronBuilder` block in electron-manager.json gets shallow-merged onto our defaults
//   for genuine special cases. Most apps will never set this.

const path    = require('path');
const jetpack = require('fs-jetpack');
const yaml    = require('js-yaml');
const Manager = new (require('../../build.js'));

const { writeMacEntitlements } = require('../../lib/sign-helpers/entitlements.js');
const { resolveAndCopy }       = require('../../lib/sign-helpers/resolve-icons.js');

const logger = Manager.logger('build-config');

module.exports = function buildConfig(done) {
  Promise.resolve().then(async () => {
    const projectRoot = process.cwd();
    const distRoot    = path.join(projectRoot, 'dist');
    const distPath    = path.join(distRoot, 'electron-builder.yml');

    const config      = Manager.getConfig() || {};
    const startupMode = config?.startup?.mode || 'normal';

    // 1. Generate entitlements.mac.plist into dist/build/.
    const entitlementsPath = writeMacEntitlements(distRoot, config?.entitlements?.mac);
    logger.log(`wrote ${entitlementsPath}`);

    // 2. Resolve + copy icons (3-tier waterfall) into dist/build/icons/.
    const emDefaultsRoot = path.join(__dirname, '..', '..', 'defaults', 'build');
    const icons = resolveAndCopy({ config, projectRoot, distRoot, emDefaultsRoot });
    logger.log(`resolved icons: mac=${Object.keys(icons.macos).length}, win=${Object.keys(icons.windows).length}, linux=${Object.keys(icons.linux).length}`);

    // Build the full config object from EM defaults + consumer overrides.
    let builderConfig = baseConfig(config, { entitlementsPath, icons, distRoot });

    // Mode-dependent injections. `hidden` mode bakes LSUIElement=true into Info.plist
    // → on macOS the app launches with no dock icon, no Cmd+Tab presence, completely
    // invisible. Tray/notifications/networking still work. Consumer surfaces UI via
    // manager.windows.create('main') which calls app.dock.show() automatically.
    if (startupMode === 'hidden') {
      builderConfig.mac = builderConfig.mac || {};
      builderConfig.mac.extendInfo = builderConfig.mac.extendInfo || {};
      builderConfig.mac.extendInfo.LSUIElement = true;
      logger.log('startup.mode=hidden → injected mac.extendInfo.LSUIElement=true');
    }

    // Inject `publish` from `releases` config.
    if (config?.releases?.enabled !== false) {
      const releases = config?.releases || {};
      let releaseOwner = releases.owner;
      if (!releaseOwner) {
        try {
          const { discoverRepo } = require('../../utils/github.js');
          const discovered = await discoverRepo(projectRoot);
          releaseOwner = discovered.owner;
        } catch (e) {
          logger.warn(`Could not discover repo owner; leaving publish block off. (${e.message})`);
        }
      }
      const releaseRepo = releases.repo || 'update-server';
      if (releaseOwner) {
        builderConfig.publish = {
          provider:    'github',
          owner:       releaseOwner,
          repo:        releaseRepo,
          releaseType: 'release',
        };
        logger.log(`releases → publish block: github ${releaseOwner}/${releaseRepo}`);
      }
    }

    // Inject afterSign → EM's built-in notarize hook.
    builderConfig.afterSign = require.resolve('electron-manager/hooks/notarize');
    logger.log(`afterSign → ${builderConfig.afterSign}`);

    // Apply consumer overrides last so they win.
    if (config?.electronBuilder && typeof config.electronBuilder === 'object') {
      builderConfig = deepMerge(builderConfig, config.electronBuilder);
      logger.log('Applied electronBuilder overrides from electron-manager.json');
    }

    // Serialize to YAML and write.
    const yml = yaml.dump(builderConfig, { lineWidth: -1, noRefs: true });
    jetpack.write(distPath, yml);
    logger.log(`wrote ${distPath} (mode=${startupMode})`);
  }).then(() => done(), done);
};

// EM's canonical electron-builder config. Driven by the consumer's electron-manager.json
// where it makes sense (appId, productName, copyright); everything else (signing, target
// archs, file globs) is EM's opinionated default.
//
// Optional `extras` argument carries resolved icon paths + entitlements path from the
// build-config task. When called from tests with no extras, the bare config is returned
// (paths are left as project-relative defaults that may not exist on disk — fine for
// test assertions).
function baseConfig(config, extras = {}) {
  const appId       = config?.app?.appId       || 'com.itwcreativeworks.app';
  const productName = config?.app?.productName || 'App';
  const copyright   = config?.app?.copyright   || '© ITW Creative Works';

  const { entitlementsPath, icons, distRoot } = extras;
  const rel = (abs) => abs && distRoot ? path.relative(distRoot, abs) : abs;

  const out = {
    appId,
    productName,
    copyright,

    directories: {
      output:         'release',
      buildResources: 'build',         // dist/build/ (relative to dist/electron-builder.yml)
    },

    files: [
      '**/*',
      '!**/*.map',
      '!.env',
      '!.env.*',
      '!**/*.env',
    ],

    asar: true,

    mac: {
      category: 'public.app-category.utilities',
      target: [
        { target: 'dmg', arch: ['x64', 'arm64'] },
        { target: 'zip', arch: ['x64', 'arm64'] },
      ],
      hardenedRuntime:    true,
      gatekeeperAssess:   false,
      notarize: false,   // notarization runs via afterSign hook
    },

    dmg: {},

    win: {
      target: [
        { target: 'nsis', arch: ['x64'] },
      ],
      signtoolOptions: {
        signingHashAlgorithms: ['sha256'],
      },
    },

    linux: {
      target: [
        { target: 'deb',      arch: ['x64'] },   // Ubuntu/Debian/Mint. (i386 dropped — extinct on modern distros.)
        { target: 'AppImage', arch: ['x64'] },   // Fedora/Arch/openSUSE — distro-agnostic.
      ],
      category: 'Utility',
    },
  };

  // Wire entitlements.
  if (entitlementsPath) {
    out.mac.entitlements        = rel(entitlementsPath);
    out.mac.entitlementsInherit = rel(entitlementsPath);
  }

  // Wire icons. electron-builder resolves these as paths relative to the config file (dist/electron-builder.yml).
  if (icons?.macos?.app)  out.mac.icon   = rel(icons.macos.app);
  if (icons?.macos?.dmg)  out.dmg.background = rel(icons.macos.dmg);
  if (icons?.windows?.app) out.win.icon  = rel(icons.windows.app);
  if (icons?.linux?.app)   out.linux.icon = rel(icons.linux.app);

  return out;
}

// Shallow object merge with arrays replaced (not concatenated) so consumer overrides like
// `mac.target: [...]` fully replace ours rather than appending to defaults.
function deepMerge(a, b) {
  if (Array.isArray(b)) return b;
  if (b && typeof b === 'object' && !Array.isArray(a)) {
    const out = { ...a };
    for (const k of Object.keys(b)) {
      out[k] = (a && k in a) ? deepMerge(a[k], b[k]) : b[k];
    }
    return out;
  }
  return b;
}

// Exported for tests.
module.exports.baseConfig = baseConfig;
module.exports.deepMerge  = deepMerge;
