// Resolve icon paths via a convention-only waterfall, copy resolved files into
// dist/config/icons/, and return the paths electron-builder.yml needs.
//
// Resolution order per slot, per platform (most specific wins):
//   1. <projectRoot>/config/icons/<platform>/<file>       — platform-specific override
//   2. <projectRoot>/config/icons/global/<file>           — universal fallback (shared by all platforms)
//   3. <projectRoot>/config/icons/windows/<file>          — Linux-only extra: legacy Linux→Windows fallback
//   4. <EM>/dist/config/icons/<platform>/<file>           — EM bundled default
//
// Note the DMG slot is macOS-only by definition. Its lookup chain skips step 3
// entirely and step 2 only checks `global/` for the DMG file specifically (which
// almost never exists — a "global DMG background" makes no sense).
//
// Retina (@2x) variants are DERIVED. Consumers ship ONE file at the @2x (native) size.
// EM downscales it to write the @1x sibling. So `tray.png` is the 32x32 native retina
// source (consumer-facing input name), and EM emits both `trayTemplate.png` (16x16)
// and `trayTemplate@2x.png` (32x32) into `dist/config/icons/macos/`. The output name
// diverges from the input on macOS because the `Template` suffix is a system magic
// marker that triggers auto-inversion in dark mode. Same retina derivation for
// `dmg.png` (1080x760 native → emits 540x380 + 1080x760, no name change).
//
// Special fallbacks:
//   - Windows tray slot falls back to the Windows app icon if no tray source resolves.
//   - Linux uses the Windows resolved paths if its own chain produces nothing.

const path    = require('path');
const jetpack = require('fs-jetpack');
const sharp   = require('sharp');

// Slot defs: per platform, a list of { slot, file, outFile, retina } entries.
//   slot    = key under resolved[platform] (e.g. 'app' → resolved.macos.app)
//   file    = INPUT filename — what consumers ship in config/icons/<platform>/ (or global/)
//   outFile = OUTPUT filename written into dist/config/icons/<platform>/.
//             Defaults to `file`. Diverges only when the on-disk runtime name
//             carries magic meaning (e.g. macOS tray icons must end in
//             `Template.png` for the OS to auto-invert them in dark mode —
//             EM owns that detail so consumers can just call it `tray.png`).
//   retina  = if set, the SOURCE file is treated as @2x (native). EM downscales it
//             to produce the @1x sibling. Both files are written into dist/.
const SLOTS = {
  macos: [
    { slot: 'app',   file: 'icon.png' },
    { slot: 'tray',  file: 'tray.png', outFile: 'trayTemplate.png', retina: true },
    { slot: 'dmg',   file: 'dmg.png',                                retina: true },
  ],
  windows: [
    { slot: 'app',   file: 'icon.png' },
    { slot: 'tray',  file: 'tray.png' },        // optional; falls back to app icon if missing
  ],
  linux: [
    { slot: 'app',   file: 'icon.png' },
    { slot: 'tray',  file: 'tray.png' },
  ],
};

// Given a non-retina file path, return its @2x sibling (`foo.png` → `foo@2x.png`).
function retinaSibling(p) {
  const dir  = path.dirname(p);
  const ext  = path.extname(p);
  const base = path.basename(p, ext);
  return path.join(dir, `${base}@2x${ext}`);
}

// Find the source file for a slot on a platform via the convention waterfall.
// Most-specific-wins: platform-specific override beats global fallback beats
// bundled default. Linux gets an extra step: it falls back to the Windows
// consumer dir before going to bundled defaults (legacy compat — Linux apps
// historically reuse Windows assets).
function findSource({ slot, file }, platform, opts) {
  const { projectRoot, emDefaultsRoot } = opts;

  // 1. Platform-specific override.
  const platformPath = path.join(projectRoot, 'config', 'icons', platform, file);
  if (jetpack.exists(platformPath)) return platformPath;

  // 2. Universal fallback (shared by all platforms). Skip for macOS-only slots
  // like `dmg` where a global file makes no sense — but we still allow it (if
  // someone REALLY wants a global dmg.png, fine; we don't enforce semantics).
  const globalPath = path.join(projectRoot, 'config', 'icons', 'global', file);
  if (jetpack.exists(globalPath)) return globalPath;

  // 3. Linux-only: legacy fallback through Windows consumer dir.
  if (platform === 'linux') {
    const winFallback = path.join(projectRoot, 'config', 'icons', 'windows', file);
    if (jetpack.exists(winFallback)) return winFallback;
  }

  // 4. EM bundled default.
  const bundled = path.join(emDefaultsRoot, 'icons', platform, file);
  if (jetpack.exists(bundled)) return bundled;

  // Linux gets one more shot at bundled defaults via the Windows chain.
  if (platform === 'linux') {
    const bundledWin = path.join(emDefaultsRoot, 'icons', 'windows', file);
    if (jetpack.exists(bundledWin)) return bundledWin;
  }

  return null;
}

// Downscale an @2x source to its @1x sibling. Source is written as the @2x output,
// and a half-sized copy is written alongside as the @1x output. Returns { ref1x, ref2x }.
async function emitRetinaPair(src, dest) {
  const dest2x = retinaSibling(dest);

  // @2x output is a straight copy of the native source.
  jetpack.copy(src, dest2x, { overwrite: true });

  // @1x output is the source downscaled by 50%.
  const meta = await sharp(src).metadata();
  const w1x = Math.max(1, Math.round((meta.width  || 2) / 2));
  const h1x = Math.max(1, Math.round((meta.height || 2) / 2));
  await sharp(src)
    .resize(w1x, h1x, { fit: 'fill' })
    .toFile(dest);

  return { ref1x: dest, ref2x: dest2x };
}

// Resolve all icons, copy into dist/config/icons/, return the wiring object that
// build-config consumes.
async function resolveAndCopy({ config, projectRoot, distRoot, emDefaultsRoot }) {
  const distIconsRoot = path.join(distRoot, 'config', 'icons');
  jetpack.dir(distIconsRoot);

  const resolved = { macos: {}, windows: {}, linux: {} };

  // First pass: resolve each platform/slot. For retina slots, source file is treated as
  // @2x; EM emits both <slot>.png (downscaled) and <slot>@2x.png (the source) into dist.
  for (const platform of Object.keys(SLOTS)) {
    for (const def of SLOTS[platform]) {
      const src = findSource(def, platform, { projectRoot, emDefaultsRoot });
      if (!src) continue;

      const outFile = def.outFile || def.file;
      const dest = path.join(distIconsRoot, platform, outFile);
      jetpack.dir(path.dirname(dest));

      if (def.retina) {
        const { ref1x, ref2x } = await emitRetinaPair(src, dest);
        resolved[platform][def.slot]            = ref1x;
        resolved[platform][`${def.slot}2x`]     = ref2x;
      } else {
        jetpack.copy(src, dest, { overwrite: true });
        resolved[platform][def.slot] = dest;
      }
    }
  }

  // Special fallbacks:
  //   - Windows tray → Windows app icon if tray didn't resolve.
  if (!resolved.windows.tray && resolved.windows.app) {
    resolved.windows.tray = resolved.windows.app;
  }
  //   - Linux entirely follows Windows resolved paths if its own chain produced nothing.
  for (const slot of ['app', 'tray']) {
    if (!resolved.linux[slot] && resolved.windows[slot]) {
      resolved.linux[slot] = resolved.windows[slot];
    }
  }

  return resolved;
}

module.exports = {
  SLOTS,
  retinaSibling,
  findSource,
  emitRetinaPair,
  resolveAndCopy,
};
