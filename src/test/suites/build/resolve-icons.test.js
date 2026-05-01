// Build-layer tests for lib/sign-helpers/resolve-icons.js — 3-tier waterfall.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const jetpack = require('fs-jetpack');

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

function fakePng(p) {
  // Minimal PNG signature so jetpack.exists() reports true and copies are byte-stable.
  jetpack.dir(path.dirname(p));
  fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'resolve-icons — 3-tier waterfall + Linux/Windows fallback',
  tests: [
    {
      name: 'falls back to EM bundled defaults when consumer has nothing',
      run: (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.macos.app).toBe(path.join(distRoot, 'build', 'icons', 'macos', 'icon.png'));
          ctx.expect(out.windows.app).toBe(path.join(distRoot, 'build', 'icons', 'windows', 'icon.png'));
          ctx.expect(jetpack.exists(out.macos.app)).toBeTruthy();
          ctx.expect(jetpack.exists(out.windows.app)).toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'consumer file convention overrides bundled default',
      run: (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          const consumerIcon = path.join(projectRoot, 'config', 'icons', 'macos', 'icon.png');
          fakePng(consumerIcon);
          fs.writeFileSync(consumerIcon, Buffer.from('consumer-bytes'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          const dest = out.macos.app;
          const bytes = fs.readFileSync(dest);
          ctx.expect(bytes.toString()).toBe('consumer-bytes');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'explicit config path beats both file convention and bundled default',
      run: (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          fakePng(path.join(projectRoot, 'config', 'icons', 'macos', 'icon.png'));

          const explicit = path.join(projectRoot, 'custom', 'my-icon.png');
          fakePng(explicit);
          fs.writeFileSync(explicit, Buffer.from('explicit-bytes'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = resolveAndCopy({
            config: { app: { icons: { appMac: 'custom/my-icon.png' } } },
            projectRoot,
            distRoot,
            emDefaultsRoot,
          });

          const dest  = out.macos.app;
          const bytes = fs.readFileSync(dest);
          ctx.expect(bytes.toString()).toBe('explicit-bytes');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'Windows tray falls back to Windows app icon when no tray.png exists',
      run: (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));
          // No windows/tray.png anywhere.

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.windows.tray).toBeDefined();
          ctx.expect(out.windows.tray).toBe(out.windows.app);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'Linux follows Windows resolution entirely',
      run: (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'windows', 'icon.png'));
          // No Linux dir anywhere.

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.linux.app).toBe(out.windows.app);
          ctx.expect(out.linux.tray).toBe(out.windows.tray);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'Mac slots: @2x auto-derived from @1x source when sibling exists',
      run: (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'trayTemplate.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'trayTemplate@2x.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'dmg.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'dmg@2x.png'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          // @1x slots resolve normally.
          ctx.expect(out.macos.app).toBeDefined();
          ctx.expect(out.macos.tray).toBeDefined();
          ctx.expect(out.macos.dmg).toBeDefined();
          // @2x slots are auto-discovered + populated under <slot>2x keys.
          ctx.expect(out.macos.tray2x).toBeDefined();
          ctx.expect(out.macos.dmg2x).toBeDefined();
          // app slot has no retina flag, so no app2x.
          ctx.expect(out.macos.app2x).toBeUndefined();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: '@2x missing: skip silently (no synthesis)',
      run: (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          // Bundle @1x but NOT @2x.
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'trayTemplate.png'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.macos.tray).toBeDefined();
          ctx.expect(out.macos.tray2x).toBeUndefined();   // missing → skip
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: '@2x discovered next to consumer-provided @1x source',
      run: (ctx) => {
        const { root, projectRoot, distRoot, emDefaultsRoot } = stage();
        try {
          fakePng(path.join(emDefaultsRoot, 'icons', 'macos', 'icon.png'));
          // Consumer puts both @1x and @2x in their config dir.
          const consumer1x = path.join(projectRoot, 'config', 'icons', 'macos', 'trayTemplate.png');
          const consumer2x = path.join(projectRoot, 'config', 'icons', 'macos', 'trayTemplate@2x.png');
          fakePng(consumer1x);
          fakePng(consumer2x);
          fs.writeFileSync(consumer2x, Buffer.from('consumer-2x-bytes'));

          const { resolveAndCopy } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'resolve-icons.js'));
          const out = resolveAndCopy({ config: {}, projectRoot, distRoot, emDefaultsRoot });

          ctx.expect(out.macos.tray).toBeDefined();
          ctx.expect(out.macos.tray2x).toBeDefined();
          // The @2x sibling came from the consumer's dir, not the EM bundle.
          const bytes = fs.readFileSync(out.macos.tray2x);
          ctx.expect(bytes.toString()).toBe('consumer-2x-bytes');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
  ],
};
