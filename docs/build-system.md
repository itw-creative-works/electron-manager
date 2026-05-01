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
| `build-config` | real | Materialize `dist/electron-builder.yml` from source + mode-dependent injections (`LSUIElement` for tray-only) |
| `package` | stub | Run `electron-builder build --config dist/electron-builder.yml` |
| `release` | stub | `electron-builder build --publish always` |
| `audit` | real | Validate consumer config (required keys, valid enums, deep-link scheme format), ensure icon + entrypoints exist; in publish mode also requires `releases.repo` + `electron-builder.yml`. Throws with a numbered list of every problem found |
| `serve` | stub | Spawns `electron .` against the build output, websocket on `EM_LIVERELOAD_PORT` |

### Composition

```js
exports.build = series(
  exports.defaults, exports.distribute,
  parallel(exports.sass, exports.webpack, exports.html),
  exports.audit,
  exports.buildConfig,
  exports.package,
);
exports.default = series(exports.serve, exports.build);
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

Driven by `electron-builder.yml`. EM materializes `dist/electron-builder.yml` from the consumer's source via `gulp/build-config`, applying:

- `mac.extendInfo.LSUIElement: true` when `startup.mode === 'tray-only'` (zero-bounce production launches — see [startup.md](startup.md)).

The materialization is YAML-text-level (preserves comments, idempotent, merges with existing `extendInfo` blocks). The consumer's source `electron-builder.yml` is NEVER mutated.

`gulp/package` points electron-builder at `dist/electron-builder.yml` (falls back to source if dist version absent).

## Build modes

Environment variables (set by `npm run build` / `npm run release`):

| Var | Effect |
|---|---|
| `EM_BUILD_MODE=true` | Production webpack (minified, name-mangled, no sourcemaps) |
| `EM_IS_PUBLISH=true` | electron-builder runs with `--publish always` |
| `EM_IS_SERVER=true` | Running in CI |

## Windows code signing

Strategy-pluggable via `signing.windows.strategy` (or `signing.windows.strategy` in config):

| Strategy | Where signing runs | When to use |
|---|---|---|
| `self-hosted` | Self-hosted GH Actions runner with USB EV token plugged in | Default for EM v1 — physical EV token desktop |
| `cloud` | `windows-latest` runner shells out to a cloud signing CLI (Azure Trusted Signing / SSL.com / DigiCert KeyLocker) | Future migration target |
| `local` | Developer's Windows machine after CI uploads unsigned artifact | Fallback when no runner is available |

The `gulp/build-config` task and `electron-builder.yml`'s `win.sign` hook both honor `signing.windows.strategy` so the same code path drives all three. Provider modules live in `src/lib/sign-providers/{ev,azure,sslcom,digicert}.js` (Pass 3).

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
