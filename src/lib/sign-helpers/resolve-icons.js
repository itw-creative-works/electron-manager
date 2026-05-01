// Resolve icon paths from a 3-tier waterfall, copy resolved files into dist/build/icons/,
// and return the paths electron-builder.yml needs.
//
// Resolution order per slot, per platform:
//   1. Consumer config (e.g. config.app.icons.appMac is an absolute or project-relative path)
//   2. Consumer file convention (e.g. <projectRoot>/config/icons/macos/icon.png)
//   3. EM bundled default (<EM>/dist/build/icons/macos/icon.png)
//
// @2x retina variants are derived automatically — for any slot whose `retina` flag is true,
// after resolving the @1x source we look for `<basename>@2x.png` in the same directory.
// Found → copy as the @2x slot. Missing → skip (electron-builder/Electron handle missing
// @2x fine on their own).
//
// Special fallbacks:
//   - Windows tray slot falls back to the Windows app icon if no tray-specific source resolves.
//   - Linux uses the Windows resolution chain entirely (no Linux-specific bundled defaults).

const path    = require('path');
const jetpack = require('fs-jetpack');

// Slot defs: per platform, a list of { slot, file, retina } entries.
//   slot   = config key suffix (e.g. 'app' → consumer config key `appMac`)
//   file   = filename inside the convention/bundled dirs
//   retina = if true, also look for `<basename>@2x.png` in the same dir
const SLOTS = {
  macos: [
    { slot: 'app',   file: 'icon.png' },
    { slot: 'tray',  file: 'trayTemplate.png', retina: true },
    { slot: 'dmg',   file: 'dmg.png',          retina: true },
  ],
  windows: [
    { slot: 'app',   file: 'icon.png' },
    { slot: 'tray',  file: 'tray.png' },        // optional; falls back to app icon if missing
  ],
  linux: [
    { slot: 'app',   file: 'icon.png' },         // falls through to windows chain
    { slot: 'tray',  file: 'tray.png' },
  ],
};

// Consumer-config key naming: `<slot><Platform>` for explicit overrides.
// e.g. app.icons.appMac, app.icons.trayWindows, app.icons.dmgMac
function configKey(slot, platform) {
  const platformCap = { macos: 'Mac', windows: 'Windows', linux: 'Linux' }[platform];
  return slot + platformCap;
}

// Given a @1x file path, return the conventional @2x sibling (`foo.png` → `foo@2x.png`).
function retinaSibling(p) {
  const dir  = path.dirname(p);
  const ext  = path.extname(p);
  const base = path.basename(p, ext);
  return path.join(dir, `${base}@2x${ext}`);
}

// Find the source file for a slot on a platform via the 3-tier chain.
function findSource({ slot, file }, platform, opts) {
  const { config, projectRoot, emDefaultsRoot } = opts;

  // 1. Explicit config path.
  const cfgVal = config?.app?.icons?.[configKey(slot, platform)];
  if (cfgVal && typeof cfgVal === 'string') {
    const abs = path.isAbsolute(cfgVal) ? cfgVal : path.join(projectRoot, cfgVal);
    if (jetpack.exists(abs)) return abs;
  }

  // 2. Consumer file convention.
  const conventional = path.join(projectRoot, 'config', 'icons', platform, file);
  if (jetpack.exists(conventional)) return conventional;

  // 3. EM bundled default.
  const bundled = path.join(emDefaultsRoot, 'icons', platform, file);
  if (jetpack.exists(bundled)) return bundled;

  return null;
}

// Resolve all icons, copy into dist/build/icons/, return the wiring object that
// build-config consumes.
function resolveAndCopy({ config, projectRoot, distRoot, emDefaultsRoot }) {
  const distIconsRoot = path.join(distRoot, 'build', 'icons');
  jetpack.dir(distIconsRoot);

  const resolved = { macos: {}, windows: {}, linux: {} };

  // First pass: resolve each platform/slot. For retina slots, also look for the @2x
  // sibling next to the resolved @1x source and copy it under the `<slot>2x` key.
  for (const platform of Object.keys(SLOTS)) {
    for (const def of SLOTS[platform]) {
      const src = findSource(def, platform, { config, projectRoot, emDefaultsRoot });
      if (!src) continue;

      const dest = path.join(distIconsRoot, platform, def.file);
      jetpack.copy(src, dest, { overwrite: true });
      resolved[platform][def.slot] = dest;

      if (def.retina) {
        const src2x = retinaSibling(src);
        if (jetpack.exists(src2x)) {
          const dest2x = retinaSibling(dest);
          jetpack.copy(src2x, dest2x, { overwrite: true });
          resolved[platform][`${def.slot}2x`] = dest2x;
        }
      }
    }
  }

  // Special fallbacks:
  //   - Windows tray → Windows app icon if tray didn't resolve.
  if (!resolved.windows.tray && resolved.windows.app) {
    resolved.windows.tray = resolved.windows.app;
  }
  //   - Linux entirely follows Windows resolution.
  for (const slot of ['app', 'tray']) {
    if (!resolved.linux[slot] && resolved.windows[slot]) {
      resolved.linux[slot] = resolved.windows[slot];
    }
  }

  return resolved;
}

module.exports = {
  SLOTS,
  configKey,
  retinaSibling,
  findSource,
  resolveAndCopy,
};
