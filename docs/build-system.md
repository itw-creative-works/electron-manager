# Build System

EM's pipeline: **prepare-package** (framework only) → **gulp** (consumer) → **webpack** (3 targets) → **electron-builder** (packaging) → **strategy-pluggable signing**.

## prepare-package (framework-side)

Copies EM's `src/` → `dist/` so consumers `require('electron-manager/main')` from the built output. Configured in EM's `package.json`:

```jsonc
"preparePackage": {
  "input":  "./src",
  "output": "./dist",
  "type":   "copy",
  "replace": {},
  "hooks":   {}
}
```

Run with `npm start` (watch) or `npm run prepare` (one-shot).

## Gulp (consumer-side)

Auto-loads tasks from `<EM>/dist/gulp/tasks/*.js` via `<EM>/dist/gulp/main.js`. Consumer's `package.json` points there:

```jsonc
"scripts": {
  "gulp": "gulp --cwd ./ --gulpfile ./node_modules/electron-manager/dist/gulp/main.js"
}
```

### Tasks

| Task | Status | Description |
|---|---|---|
| `defaults` | real | Copy `<EM>/dist/defaults/*` into the consumer (skips existing files) |
| `distribute` | real | Stage consumer `src/` + EM `dist/` into `.em-build/` |
| `webpack` | real | Three parallel targets — main / preload / renderer |
| `sass` | real | SCSS → `dist/assets/css/*` |
| `html` | real | `src/views/**/index.html` → `dist/views/*` |
| `build-config` | real | Materialize `dist/electron-builder.yml` from source + mode-dependent injections (`LSUIElement` for hidden mode) |
| `package` | real | Run `electron-builder build --config dist/electron-builder.yml` (full DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux) |
| `package-quick` | real | Quick-package for host platform/arch only — `--dir` mode, no DMG/zip/universal/notarize. ~20-30s vs ~3min for full `package`. Output: `release/<platform>-<arch>/<ProductName>.app` (or `.exe`-folder/linux-unpacked) — directly launchable. Used for smoke-testing packaged-mode behavior locally. |
| `release` | real | `electron-builder build --publish always` |
| `audit` | real | Validate consumer config (required keys, valid enums, deep-link scheme format), ensure icon + entrypoints exist; in publish mode also requires `releases.repo` + `electron-builder.yml`. Throws with a numbered list of every problem found |
| `serve` | real | Spawns `electron .` against the build output, websocket on `EM_LIVERELOAD_PORT` |

### Composition

```js
// `build` produces bundles only (dist/main.bundle.js, etc.) — no installer.
exports.build = series(
  exports['hook:build:pre'],
  exports.defaults,
  exports.distribute,
  parallel(exports.sass, exports.webpack, exports.html),
  exports.audit,
  exports['build-config'],
  exports['hook:build:post'],
);

// `packageBuild` = build + electron-builder (full DMG/zip/universal). Slow (~3min on mac).
exports.packageBuild = series(exports.build, exports.package);

// `packageQuick` = build + electron-builder --dir for host platform/arch only.
// Fast (~20-30s) — smoke-testing only.
exports.packageQuick = series(exports.build, exports['package-quick']);

// `publish` = build + sign + notarize + GH Release upload + mirror to download-server.
exports.publish = series(
  exports.build,
  exports['hook:release:pre'],
  exports.release,
  exports['mirror-downloads'],
  exports['hook:release:post'],
);

exports.default = series(exports.build, exports.serve);
```

## Webpack — three targets

All bundled in production for source protection. `app.asar` alone is not obfuscation (anyone can `npx asar extract` it) — webpack mangling is what protects framework + app source.

| Target | Entry | Output | Externals |
|---|---|---|---|
| `main` | `src/main.js` | `dist/main.bundle.js` | electron + node builtins + native modules from consumer's `package.json` |
| `preload` | `src/preload.js` | `dist/preload.bundle.js` | electron only |
| `renderer` | `src/assets/js/components/<view>/index.js` | `dist/assets/js/components/<view>.bundle.js` | none |

`output.module = false` per target so flipping to ESM later is a config switch, not a refactor.

### EM_BUILD_JSON injection

DefinePlugin replaces the bare identifier `EM_BUILD_JSON` with the parsed config. BannerPlugin prepends an IIFE that assigns it to `globalThis` and `window` so renderer code can read `window.EM_BUILD_JSON.config`.

## electron-builder

EM **generates** `dist/electron-builder.yml` from `config/electron-manager.json` + EM defaults — the consumer never ships an `electron-builder.yml`. `gulp/build-config` does the materialization, applying:

- App metadata: `appId`, `productName`, `copyright` (with `{YEAR}` token expansion to the current year)
- App-level cross-platform fields: `category` mapping, `languages`, `darkModeSupport`
- Per-target (per-platform) installer config from `targets.{mac,win,linux}`:
  - **mac**: arch (default `universal`), MAS stubs (not implemented)
  - **win**: arch (default `x64`+`ia32`), NSIS oneClick + shortcuts
  - **linux**: arch, optional snap publishing
- Mode-dependent injections like `mac.extendInfo.LSUIElement: true` when `startup.mode === 'hidden'` (zero-bounce production launches — see [startup.md](startup.md))
- Generated entitlements + resolved icons + materialized publish + afterSign hook
- Optional passthrough: `fileAssociations`, `protocols`

The full per-target reference (every config knob, default value, and what it produces in YAML) lives in **[installer-options.md](installer-options.md)**.

`gulp/package` and `gulp/package-quick` both point electron-builder at the generated `dist/electron-builder.yml`. Consumer overrides via `config.electronBuilder.*` are merged on top of the generated config — see [installer-options.md § Raw `electronBuilder` overrides](installer-options.md#raw-electronbuilder-overrides-escape-hatch) for the escape hatch.

## Build modes

Environment variables (set by `npm run build` / `npm run release`):

| Var | Effect |
|---|---|
| `EM_BUILD_MODE=true` | Production webpack (minified, name-mangled, no sourcemaps) |
| `EM_IS_PUBLISH=true` | electron-builder runs with `--publish always` |
| `EM_IS_SERVER=true` | Running in CI |

## Windows code signing

Strategy-pluggable via `targets.win.signing.strategy` in `config/electron-manager.json`:

| Strategy | Where signing runs | When to use |
|---|---|---|
| `self-hosted` | Self-hosted GH Actions runner with USB EV token plugged in | Default for EM v1 — physical EV token desktop |
| `cloud` | `windows-latest` runner shells out to a cloud signing CLI (Azure Trusted Signing / SSL.com / DigiCert KeyLocker) | Future migration target |
| `local` | Developer's Windows machine after CI uploads unsigned artifact | Fallback when no runner is available |

The `gulp/build-config` task and `electron-builder.yml`'s `win.sign` hook both honor `targets.win.signing.strategy` so the same code path drives all three. Provider modules live in `src/lib/sign-providers/{ev,azure,sslcom,digicert}.js` (Pass 3).

## GitHub Actions

`.github/workflows/build.yml` (in `src/defaults/`) runs a 3-OS matrix: macOS / Linux / Windows. Windows job uploads unsigned; a separate `windows-sign` job runs on the strategy-appropriate runner and attaches signed artifacts to the release.

Env vars set globally:

```yaml
NODE_VERSION:  '22'
EM_BUILD_MODE: 'true'
EM_IS_PUBLISH: 'true'
EM_IS_SERVER:  'true'
GH_TOKEN:      ${{ secrets.GITHUB_TOKEN }}
```

Concurrency group: `${{ github.ref }}` with `cancel-in-progress`.
