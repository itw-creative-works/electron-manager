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

    // 1. Generate entitlements.mac.plist into dist/build/. Consumer overrides live at
    // `targets.mac.entitlements` (an object map of plist key → value, with `null` to
    // remove an EM default). Top-level `entitlements.mac` is no longer read.
    const entitlementsPath = writeMacEntitlements(distRoot, config?.targets?.mac?.entitlements);
    logger.log(`wrote ${entitlementsPath}`);

    // 2. Resolve + copy icons (3-tier waterfall) into dist/build/icons/.
    const emDefaultsRoot = path.join(__dirname, '..', '..', 'defaults', 'build');
    const icons = resolveAndCopy({ config, projectRoot, distRoot, emDefaultsRoot });
    logger.log(`resolved icons: mac=${Object.keys(icons.macos).length}, win=${Object.keys(icons.windows).length}, linux=${Object.keys(icons.linux).length}`);

    // Build the full config object from EM defaults + consumer overrides.
    let builderConfig = baseConfig(config, { entitlementsPath, icons, distRoot, projectRoot });

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

// Generic-category → per-platform mapping. Consumer sets `app.category` to one of these
// keys; EM emits the corresponding mac UTI string and Linux freedesktop category.
//
// macOS: https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/LaunchServicesKeys.html#//apple_ref/doc/uid/TP40009250-SW8
// Linux: https://specifications.freedesktop.org/menu-spec/latest/apa.html
const CATEGORY_MAP = {
  'productivity':    { mac: 'public.app-category.productivity',        linux: 'Utility' },
  'developer-tools': { mac: 'public.app-category.developer-tools',     linux: 'Development' },
  'utilities':       { mac: 'public.app-category.utilities',           linux: 'Utility' },
  'media':           { mac: 'public.app-category.entertainment',       linux: 'AudioVideo' },
  'social':          { mac: 'public.app-category.social-networking',   linux: 'Network' },
  'network':         { mac: 'public.app-category.business',            linux: 'Network' },
};

function resolveCategory(category) {
  return CATEGORY_MAP[category] || CATEGORY_MAP.productivity;
}

// Substitute the {YEAR} token in a copyright string with the current year. Idempotent
// when no token is present. Called at YAML generation time so the year stays current
// across releases without consumers ever editing config.
function expandYear(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{YEAR\}/g, String(new Date().getFullYear()));
}

// EM's canonical electron-builder config. Driven by the consumer's electron-manager.json
// where it makes sense (appId, productName, copyright, category, languages, target archs,
// installer flags); everything else (target list, file globs, signing) is EM's opinionated
// default.
//
// Optional `extras` argument carries resolved icon paths + entitlements path from the
// build-config task. When called from tests with no extras, the bare config is returned
// (paths are left as project-relative defaults that may not exist on disk — fine for
// test assertions).
function baseConfig(config, extras = {}) {
  const appId       = config?.app?.appId       || 'com.itwcreativeworks.app';
  const productName = config?.app?.productName || 'App';
  const copyright   = expandYear(config?.app?.copyright || '© {YEAR}, ITW Creative Works');

  // Generic category → per-platform values via lookup table. Default 'productivity' is
  // a safe baseline that fits ~80% of business + utility apps.
  const category   = resolveCategory(config?.app?.category || 'productivity');
  const languages  = Array.isArray(config?.app?.languages) ? config.app.languages : ['en'];
  const darkModeSupport = config?.app?.darkModeSupport !== false;  // default true

  // Per-target config blocks. Each is fully optional — every key has a default.
  const macTargetCfg   = config?.targets?.mac   || {};
  const winTargetCfg   = config?.targets?.win   || {};
  const linuxTargetCfg = config?.targets?.linux || {};

  const macArch   = Array.isArray(macTargetCfg.arch)   && macTargetCfg.arch.length   ? macTargetCfg.arch   : ['universal'];
  const winArch   = Array.isArray(winTargetCfg.arch)   && winTargetCfg.arch.length   ? winTargetCfg.arch   : ['x64', 'ia32'];
  const linuxArch = Array.isArray(linuxTargetCfg.arch) && linuxTargetCfg.arch.length ? linuxTargetCfg.arch : ['x64'];

  // NSIS installer UX. Defaults match Slack/Discord-style "no friction" install:
  // one-click (no wizard), shortcut everywhere, launch on finish, per-user.
  const nsisOneClick           = winTargetCfg.oneClick !== false;
  const nsisDesktopShortcut    = winTargetCfg.desktopShortcut !== false;
  const nsisStartMenuShortcut  = winTargetCfg.startMenuShortcut !== false;
  const nsisRunAfterFinish     = winTargetCfg.runAfterFinish !== false;
  const nsisPerMachine         = winTargetCfg.perMachine === true;

  // Snap publishing — opt-in via targets.linux.snap.enabled.
  const snapCfg = linuxTargetCfg.snap || {};
  const snapEnabled = snapCfg.enabled === true;

  const { entitlementsPath, icons, distRoot, projectRoot } = extras;
  // Paths in dist/electron-builder.yml must be project-relative because electron-builder
  // resolves them against the cwd it was invoked from (which is projectRoot, not distRoot).
  // Falling back to distRoot for older callers, but projectRoot is correct.
  const rel = (abs) => {
    if (!abs) return abs;
    if (projectRoot) return path.relative(projectRoot, abs);
    if (distRoot)    return path.relative(distRoot, abs);
    return abs;
  };

  // Sanitized productName for use in artifact filenames. electron-builder's default
  // `${productName}` template variable preserves spaces, which then become dots in NSIS
  // output ("Deployment.Playground.Setup.1.0.6.exe") and behave inconsistently across
  // targets. Replacing spaces with hyphens up front gives consistent hyphenated names
  // across mac/win/linux that match what mirror-downloads produces on download-server.
  const safeProductName = String(productName).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  // Build linux target list — `deb` + `AppImage` always; `snap` if enabled.
  const linuxTargets = [
    { target: 'deb',      arch: linuxArch },
    { target: 'AppImage', arch: linuxArch },
  ];
  if (snapEnabled) {
    linuxTargets.push({ target: 'snap', arch: linuxArch });
  }

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
      // Exclude project logs/ — gulp writes dev.log here during build, which
      // (a) shouldn't ship to end users, and (b) breaks @electron/universal's
      // merge step ("Can't reconcile two non-macho files logs/dev.log") when
      // the file content differs between the x64 and arm64 builds.
      '!logs/**',
      '!**/logs/**',
    ],

    asar: true,

    mac: {
      category:          category.mac,
      electronLanguages: languages,
      darkModeSupport:   darkModeSupport,
      // Universal binary — one .dmg + one .zip that runs on both Intel and Apple
      // Silicon. Trade-off: ~2x file size (~225MB vs ~117MB single-arch), ~2x mac
      // build time (electron-builder builds both archs then stitches them with lipo).
      // Win: one user-facing download, no "which one do I pick?" choice for end users.
      target: [
        { target: 'dmg', arch: macArch },
        { target: 'zip', arch: macArch },
      ],
      hardenedRuntime:    true,
      gatekeeperAssess:   false,
      notarize: false,   // notarization runs via afterSign hook
      // mac.artifactName is the FALLBACK template for mac targets that don't have
      // their own. The .dmg target overrides it (cleaner names without -mac suffix).
      // The .zip target uses this — KEEP the `-mac` suffix on zip filenames because
      // (a) it's electron-builder's convention, (b) mirror-downloads keys off `-mac`
      // to recognize "this is the auto-updater zip" vs a generic archive on the same
      // release. With arch=universal there's only ONE zip per version (no -arm64 split)
      // so we drop ${arch} from the template — produces e.g. `Product-1.0.0-mac.zip`.
      artifactName: `${safeProductName}-\${version}-mac.\${ext}`,
    },

    dmg: {
      // Plain `Product-version.dmg` — the user-facing installer name. Universal
      // binary so no arch suffix. Stable URL on download-server is `Product.dmg`.
      artifactName: `${safeProductName}-\${version}.\${ext}`,
    },

    win: {
      target: [
        { target: 'nsis', arch: winArch },
      ],
      signtoolOptions: {
        signingHashAlgorithms: ['sha256'],
      },
      legalTrademarks: copyright,
    },

    nsis: {
      // NSIS-Setup form. version baked in so update-server keeps unique per-release
      // filenames. download-server mirror strips the version for stable URLs.
      artifactName:            `${safeProductName}-Setup-\${version}.\${ext}`,
      oneClick:                nsisOneClick,
      perMachine:              nsisPerMachine,
      // `createDesktopShortcut: 'always'` ensures the icon is created even when the
      // installer detects an upgrade (electron-builder's default is 'never' on upgrade).
      createDesktopShortcut:   nsisDesktopShortcut ? 'always' : false,
      createStartMenuShortcut: nsisStartMenuShortcut,
      runAfterFinish:          nsisRunAfterFinish,
      // Standard wizard mode: let the user pick install dir; one-click skips this.
      allowToChangeInstallationDirectory: !nsisOneClick,
    },

    linux: {
      target:       linuxTargets,
      category:     category.linux,
      artifactName: `${safeProductName}-\${version}-\${arch}.\${ext}`,
    },
  };

  // Snap-specific block — only emitted when enabled to keep the YAML clean.
  if (snapEnabled) {
    out.snap = {
      confinement: snapCfg.confinement || 'strict',
      grade:       snapCfg.grade       || 'stable',
      autoStart:   snapCfg.autoStart !== false,
      publish:     {
        provider: 'snapStore',
        channels: Array.isArray(snapCfg.channels) && snapCfg.channels.length ? snapCfg.channels : ['stable'],
      },
    };
  }

  // fileAssociations + protocols passthrough. EM-side `protocols` is ADDITIVE — the
  // brand.id:// scheme is registered automatically (handled by lib/protocol.js at runtime
  // and by Info.plist generation at build time elsewhere); this is for additional schemes.
  if (Array.isArray(config?.fileAssociations) && config.fileAssociations.length > 0) {
    out.fileAssociations = config.fileAssociations;
  }
  if (Array.isArray(config?.protocols) && config.protocols.length > 0) {
    out.protocols = config.protocols;
  }

  // Wire entitlements.
  if (entitlementsPath) {
    out.mac.entitlements        = rel(entitlementsPath);
    out.mac.entitlementsInherit = rel(entitlementsPath);
  }

  // Wire icons. electron-builder resolves these as paths relative to the cwd it was invoked from (projectRoot).
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
module.exports.baseConfig    = baseConfig;
module.exports.deepMerge     = deepMerge;
module.exports.expandYear    = expandYear;
module.exports.resolveCategory = resolveCategory;
module.exports.CATEGORY_MAP  = CATEGORY_MAP;
