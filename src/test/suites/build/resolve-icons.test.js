// Build-layer tests for lib/sign-helpers/resolve-icons.js — convention waterfall
// (platform > global > linux-via-windows > bundled) + retina derivation.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const jetpack = require('fs-jetpack');
const sharp   = require('sharp');

function stage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-icons-'));
  const projectRoot    = path.join(root, 'project');
  const distRoot       = path.join(root, 'project', 'dist');
  const emDefaultsRoot = path.join(root, 'em-defaults');
  jetpack.dir(projectRoot);
  jetpack.dir(distRoot);
  jetpack.dir(emDefaultsRoot);
  return { root, projectRoot, distRoot, emDefaultsRoot };
}

// Emit a real PNG so sharp can read metadata (used for retina slots).
async function realPng(p, width, height) {
  jetpack.dir(path.dirname(p));
  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  }).png().toFile(p);
}

// Minimal PNG signature for slots that don't need sharp metadata (non-retina).
function fakePng(p) {
  jetpack.dir(path.dirname(p));
  fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'resolve-icons — convention waterfall + retina derivation',
  tests: [
    {
      name: 'falls back to EM bundled defaults when consumer has nothing',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.macos.app).toBe(path.join(distRoot, 'config', 'icons', 'macos', 'icon.png'));
          ctx.expect(out.windows.app).toBe(path.join(distRoot, 'config', 'icons', 'windows', 'icon.png'));
          ctx.expect(jetpack.exists(out.macos.app)).toBeTruthy();
          ctx.expect(jetpack.exists(out.windows.app)).toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'platform-specific override beats bundled default',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          const consumerIcon = path.join(projectRoot, 'config', 'icons', 'macos', 'icon.png');
          fakePng(consumerIcon);
          fs.writeFileSync(consumerIcon, Buffer.from('consumer-bytes'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          const bytes = fs.readFileSync(out.macos.app);
          ctx.expect(bytes.toString()).toBe('consumer-bytes');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'global/ fallback covers all platforms when no platform-specific override exists',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          // Bundled defaults exist for all three platforms — but consumer-global wins.
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));

          // Consumer ships ONE file at the global path. All three platforms pick it up.
          const globalIcon = path.join(projectRoot, 'config', 'icons', 'global', 'icon.png');
          fakePng(globalIcon);
          fs.writeFileSync(globalIcon, Buffer.from('global-bytes'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          for (const platform of ['macos', 'windows', 'linux']) {
            ctx.expect(out[platform].app).toBeDefined();
            const bytes = fs.readFileSync(out[platform].app);
            ctx.expect(bytes.toString()).toBe('global-bytes');
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'platform-specific override beats global fallback',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));

          // Global file exists.
          const globalIcon = path.join(projectRoot, 'config', 'icons', 'global', 'icon.png');
          fakePng(globalIcon);
          fs.writeFileSync(globalIcon, Buffer.from('global-bytes'));

          // Mac-specific override exists — should win for macOS.
          const macIcon = path.join(projectRoot, 'config', 'icons', 'macos', 'icon.png');
          fakePng(macIcon);
          fs.writeFileSync(macIcon, Buffer.from('mac-specific-bytes'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(fs.readFileSync(out.macos.app).toString()).toBe('mac-specific-bytes');
          ctx.expect(fs.readFileSync(out.windows.app).toString()).toBe('global-bytes');
          ctx.expect(fs.readFileSync(out.linux.app).toString()).toBe('global-bytes');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'Windows tray falls back to Windows app icon when no tray.png exists',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));
          // No windows/tray.png anywhere.

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.windows.tray).toBeDefined();
          ctx.expect(out.windows.tray).toBe(out.windows.app);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'Linux resolves through Windows bundled defaults when no Linux source exists',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));
          // No Linux bundled dir anywhere — Linux must walk the chain through Windows bundled.

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          // Linux gets its own dist path (icon copied INTO linux/), populated from the
          // Windows bundled source.
          ctx.expect(out.linux.app).toBe(path.join(distRoot, 'config', 'icons', 'linux', 'icon.png'));
          ctx.expect(jetpack.exists(out.linux.app)).toBeTruthy();
          // Tray: no tray source anywhere → linux.tray falls back to windows.tray, which
          // itself fell back to windows.app (the Windows-tray-to-Windows-app special case).
          ctx.expect(out.linux.tray).toBe(out.windows.app);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'Linux: consumer windows/ override beats bundled (legacy linux→windows fallback)',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'linux', 'icon.png'));
          // No bundled linux defaults; consumer ships a windows/ override.
          const winIcon = path.join(projectRoot, 'config', 'icons', 'windows', 'icon.png');
          fakePng(winIcon);
          fs.writeFileSync(winIcon, Buffer.from('win-consumer-bytes'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          // Linux pulled from the consumer's windows/ dir (legacy fallback), not bundled linux/.
          ctx.expect(fs.readFileSync(out.linux.app).toString()).toBe('win-consumer-bytes');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'retina slots: source treated as @2x, @1x derived at half size',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          // Input source files at retina (native) size. EM should emit both @1x + @2x in dist.
          // Tray input is `tray.png`; EM renames the dist output to `trayTemplate.png` (macOS magic).
          await realPng(path.join(emDefaultsRoot, 'icons', 'macos', 'tray.png'), 32, 32);
          await realPng(path.join(emDefaultsRoot, 'icons', 'macos', 'dmg.png'), 1080, 760);

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          // Both @1x and @2x slots populated.
          ctx.expect(out.macos.tray).toBeDefined();
          ctx.expect(out.macos.tray2x).toBeDefined();
          ctx.expect(out.macos.dmg).toBeDefined();
          ctx.expect(out.macos.dmg2x).toBeDefined();
          // app slot has no retina flag.
          ctx.expect(out.macos.app2x).toBeUndefined();

          // Tray output filename is trayTemplate.png (renamed for macOS auto-inversion magic).
          ctx.expect(path.basename(out.macos.tray)).toBe('trayTemplate.png');
          ctx.expect(path.basename(out.macos.tray2x)).toBe('trayTemplate@2x.png');

          // @1x derived at half the @2x dimensions.
          const tray1xMeta = await sharp(out.macos.tray).metadata();
          const tray2xMeta = await sharp(out.macos.tray2x).metadata();
          ctx.expect(tray1xMeta.width).toBe(16);
          ctx.expect(tray1xMeta.height).toBe(16);
          ctx.expect(tray2xMeta.width).toBe(32);
          ctx.expect(tray2xMeta.height).toBe(32);

          const dmg1xMeta = await sharp(out.macos.dmg).metadata();
          const dmg2xMeta = await sharp(out.macos.dmg2x).metadata();
          ctx.expect(dmg1xMeta.width).toBe(540);
          ctx.expect(dmg1xMeta.height).toBe(380);
          ctx.expect(dmg2xMeta.width).toBe(1080);
          ctx.expect(dmg2xMeta.height).toBe(760);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'consumer single-file retina source overrides bundled default',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          await realPng(path.join(emDefaultsRoot, 'icons', 'macos', 'tray.png'), 32, 32);
          // Consumer ships ONE file as `tray.png` (at @2x native size).
          const consumerTray = path.join(projectRoot, 'config', 'icons', 'macos', 'tray.png');
          await realPng(consumerTray, 32, 32);

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.macos.tray).toBeDefined();
          ctx.expect(out.macos.tray2x).toBeDefined();
          // Output is still trayTemplate.png regardless of input name.
          ctx.expect(path.basename(out.macos.tray)).toBe('trayTemplate.png');
          const tray1xMeta = await sharp(out.macos.tray).metadata();
          ctx.expect(tray1xMeta.width).toBe(16);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'global/ retina source covers all platforms (tray)',
      run: async (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));

          // Consumer ships ONE tray file under global/.
          await realPng(path.join(projectRoot, 'config', 'icons', 'global', 'tray.png'), 32, 32);

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = await resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.macos.tray).toBeDefined();
          ctx.expect(out.macos.tray2x).toBeDefined();
          ctx.expect(out.windows.tray).toBeDefined();
          ctx.expect(out.linux.tray).toBeDefined();

          // macOS @1x derived at half size from the global @2x source.
          const macTrayMeta = await sharp(out.macos.tray).metadata();
          ctx.expect(macTrayMeta.width).toBe(16);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
  ],
};
