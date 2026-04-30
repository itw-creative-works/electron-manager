# Lifecycle Hooks

Consumers can inject custom logic at well-defined points without forking EM's gulp tasks. All hooks are **purely additive extension points** — EM's core logic always runs first, the hook is called after (or before, depending on the lifecycle point), and a hook throwing only logs a warning, never breaks the build.

## How hooks work

1. EM scaffolds empty hook files into `<consumer>/hooks/**/*.js` on `npx mgr setup`.
2. At each lifecycle point, EM checks for the file. If it exists, EM loads + invokes it. If not, no-op.
3. The hook signature is `async (ctx) => { ... }`. Whatever it returns is awaited but ignored.
4. **Failure semantics:**
   - File missing entirely → logged informationally (`hook "<name>" not present at ... — skipping.`), build continues.
   - File exists but fails to load (syntax error, etc.) → **throws**, build fails.
   - File exists but doesn't export a function → **throws**, build fails.
   - File loads + invokes the function and the function throws → **throws**, build fails.

   In other words: a hook that doesn't exist is fine (you'll see one log line), but a hook that's broken in any way fails loudly. You should never silently ship a malformed hook to production.

## Hooks reference

| Hook file | When it runs | `ctx` shape |
|---|---|---|
| `hooks/build/pre.js`     | Before the build pipeline runs (`defaults` → `distribute` → `webpack` ...) | `{ manager, projectRoot, mode }` |
| `hooks/build/post.js`    | After the build pipeline finishes, before `electron-builder` packages anything | `{ manager, projectRoot, mode }` |
| `hooks/release/pre.js`   | Before `electron-builder build --publish always` | `{ manager, projectRoot, mode }` |
| `hooks/release/post.js`  | After release publishes + mirror-downloads finish | `{ manager, projectRoot, mode }` |
| `hooks/notarize/post.js` | After EM's built-in macOS notarization completes (extension only — EM's notarize is the real entrypoint) | electron-builder afterSign context |

`mode` is `'production'` when `EM_BUILD_MODE=true`, else `'development'`.

## Why this design

- **Notarize specifically:** the consumer's `hooks/notarize/post.js` is **never** the electron-builder afterSign entrypoint. EM's `gulp/build-config` injects `afterSign:` pointing at EM's real notarize implementation (resolved via `require.resolve('electron-manager/hooks/notarize')`). EM's real notarize calls into the consumer's `hooks/notarize/post.js` as a final post-step. So the consumer can never accidentally break notarization by editing the file — the file can be empty, malformed, or missing entirely and the app still notarizes correctly.
- **Why no `hooks/notarize/pre.js`?** electron-builder's `afterSign` hook is the only signing-related extension point we control. Anything that would belong in a "pre-notarize" step belongs either in `hooks/release/pre.js` (whole-release-level prep, runs before the gulp release task), or in electron-builder's own `afterPack` / `afterAllArtifactBuild` configuration (per-artifact mutation). If you have a real use case that doesn't fit either, file an issue.
- **Build/release hooks:** standard before/after lifecycle pattern. Same shape as Ultimate Jekyll Manager's hook system.

## Examples

### Slack notification on release

```js
// hooks/release/post.js
module.exports = async ({ manager, projectRoot }) => {
  const pkg = require(`${projectRoot}/package.json`);
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `🚀 ${pkg.name} v${pkg.version} released` }),
  });
};
```

### Generate changelog before build

```js
// hooks/build/pre.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async ({ projectRoot }) => {
  const log = execSync('git log --oneline -n 20', { cwd: projectRoot });
  fs.writeFileSync(path.join(projectRoot, 'CHANGELOG_LATEST.txt'), log);
};
```

### Custom post-notarize archive

```js
// hooks/notarize/post.js
const fs = require('fs');
const path = require('path');

module.exports = async (context) => {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  // e.g. archive a copy somewhere off the build path
  fs.cpSync(appPath, `/tmp/em-archive/${appName}-${Date.now()}.app`, { recursive: true });
};
```

## Tests

- `src/test/suites/build/run-consumer-hook.test.js` — silent skip, invocation with args, error swallowing.
- `src/test/suites/build/build-config.test.js` — `injectAfterSign` always points at EM's notarize.
