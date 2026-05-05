// Quick local package: produces a runnable .app/.exe-folder/linux-unpacked dir for the host
// platform + host arch only, with NO DMG, NO universal stitching, NO notarization. ~20-30s
// vs ~3min for the full `package`. Output: release/<platform>-<arch>/<ProductName>.app|.exe.
//
// Trade-offs vs `package`:
//   - Mac: skips DMG + zip + universal binary (host arch only). Code signing still runs if
//     the cert is available — the .app launches normally on the dev machine. No notarization.
//   - Win: skips NSIS installer. Output is `release/win-unpacked/<ProductName>.exe` you run directly.
//   - Linux: skips deb + AppImage. Output is `release/linux-unpacked/<ProductName>` binary.
//
// Why bypass gulp/package: we need to override `mac.target`, `win.target`, `linux.target`,
// `mac.notarize` for this run only without mutating dist/electron-builder.yml. Cleanest is
// to programmatically call electron-builder.build() with a config override layered on top.

const path    = require('path');
const jetpack = require('fs-jetpack');
const yaml    = require('js-yaml');
const Manager = new (require('../../build.js'));

const logger = Manager.logger('package-quick');

module.exports = function packageQuick(done) {
  const projectRoot = process.cwd();
  const configPath  = path.join(projectRoot, 'dist', 'electron-builder.yml');

  if (!jetpack.exists(configPath)) {
    return done(new Error(`Missing ${configPath}. Run gulp/build-config first.`));
  }

  let builder;
  try {
    builder = Manager.require('electron-builder');
  } catch (e) {
    return done(new Error(`Could not resolve electron-builder: ${e.message}`));
  }

  // Load the materialized config + override target lists for fast/dir output.
  const baseConfig = yaml.load(jetpack.read(configPath));

  baseConfig.mac = baseConfig.mac || {};
  baseConfig.mac.target = ['dir'];
  baseConfig.mac.notarize = false;

  baseConfig.win = baseConfig.win || {};
  baseConfig.win.target = ['dir'];

  baseConfig.linux = baseConfig.linux || {};
  baseConfig.linux.target = ['dir'];

  // Strip the publish block — we never want this build leaking to GitHub.
  delete baseConfig.publish;

  // Strip afterSign — no notarization on quick builds.
  delete baseConfig.afterSign;

  // Pick host platform + host arch.
  const platform = process.platform;          // 'darwin' | 'win32' | 'linux'
  const arch     = process.arch;              // 'arm64'  | 'x64'

  const opts = {
    config: baseConfig,
    publish: 'never',
  };

  // Map host to electron-builder's targets parameter.
  const targets = {};
  if (platform === 'darwin') {
    targets.mac = builder.Platform.MAC.createTarget('dir', builder.Arch[arch] || builder.Arch.x64);
  } else if (platform === 'win32') {
    targets.win = builder.Platform.WINDOWS.createTarget('dir', builder.Arch[arch] || builder.Arch.x64);
  } else if (platform === 'linux') {
    targets.linux = builder.Platform.LINUX.createTarget('dir', builder.Arch[arch] || builder.Arch.x64);
  } else {
    return done(new Error(`Unsupported host platform: ${platform}`));
  }

  // electron-builder.build accepts `targets` as a Map<Platform, Map<Arch, string[]>>.
  // The createTarget() helper returns that structure for one platform; merge them into
  // the opts when more than one is desired (we only build one here, for the host).
  opts.targets = Object.values(targets)[0];

  logger.log(`Quick-packaging for ${platform}-${arch} (--dir, no installer, no notarize)...`);

  builder.build(opts)
    .then((artifacts) => {
      const list = (artifacts || []).map((a) => path.relative(projectRoot, a));
      logger.log(`Produced ${list.length} artifact(s):`);
      list.forEach((a) => logger.log(`  • ${a}`));

      // Print the runnable path explicitly — it's what the user actually wants.
      const runnable = list.find((a) => a.endsWith('.app') || a.endsWith('.exe') || (!path.extname(a) && a.includes('linux-unpacked')));
      if (runnable) {
        logger.log('');
        logger.log(`▶ Launch:  open "${runnable}"`);
      }
      done();
    })
    .catch((e) => {
      logger.error(`electron-builder failed: ${e.message}`);
      done(e);
    });
};
