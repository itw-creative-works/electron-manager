# Remote Scripts

Emergency remote code execution for when the normal update pipeline is broken. Fetches a single JS file from the brand's website and executes it in the main process.

## Why it exists

Auto-updater failures, storage corruption, stuck states — any situation where the app is deployed and you need to push a fix but can't ship a new version through the normal pipeline. Remote scripts let you patch running apps from a single JS file on your website.

## Source URL

```
${brand.url}/data/scripts/main.js
```

Override with `config.remoteScripts.url`. Same domain-derivation pattern as `remote-config` (`/data/resources/main.json`).

## Polling cadence

Matches `remote-config` — inherits from `autoUpdater._options.feedCheckIntervalMs` (~1 hour). In testing mode, collapses to 500ms.

`initialize()` is fully non-blocking: fires the first fetch as fire-and-forget, never blocks the boot sequence.

## The script file

Host a plain `.js` file at the source URL. The content is fetched as text and executed as an async function body with `manager` and `require` in scope.

**Dedup is automatic** — the script's SHA-256 content hash is stored in `electron-store`. The same script won't re-execute until you change the content. To force a re-run of the same script, add a comment like `// v2` to change the hash.

### Example: force all users to update

```js
await manager.autoUpdater.checkNow();
```

### Example: clear corrupted storage

```js
manager.storage.delete('auth.staleToken');
manager.storage.set('app.patched', true);
```

### Example: emergency restart with cache wipe

```js
const fs = require('fs');
const path = require('path');
const cacheDir = path.join(require('electron').app.getPath('userData'), 'cache');

if (fs.existsSync(cacheDir)) {
  fs.rmSync(cacheDir, { recursive: true });
}

manager.relaunch({ force: true });
```

### Example: redirect updater to a hotfix feed

```js
manager.autoUpdater._autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'myorg',
  repo: 'myapp-hotfix',
});
await manager.autoUpdater.checkNow();
```

### Example: version-gated fix (script handles its own gating)

```js
const wv = require('wonderful-version');
const appVersion = require('electron').app.getVersion();

if (wv.greaterThanOrEqual(appVersion, '1.4.0') && wv.lessThan(appVersion, '1.6.0')) {
  manager.storage.delete('corrupted.key');
}
```

### Deactivating

To stop the script from running on new installs (without affecting installs that already ran it), replace the file content with an empty file or a no-op comment:

```js
// no-op
```

Or return a 404 — fetch failures are caught and logged, never crash.

## Execution context

The script runs via `new AsyncFunction('manager', 'require', code)`:

- **`manager`** — the live main-process Manager singleton. Full access to all libs: `manager.storage`, `manager.autoUpdater`, `manager.windows`, `manager.ipc`, etc.
- **`require`** — the real Node.js `require` (uses `__non_webpack_require__` when webpacked). Can load `fs`, `path`, `child_process`, `electron`, or any installed package.
- **`await`** — supported natively.

### Error handling

If the script throws, the error is logged but the hash is still stored (prevents infinite retry loops). Check `runtime.log`:

```
[remote-scripts] remote-scripts: script threw: Cannot read properties of undefined
```

## API

```js
// Force-fetch and execute if the script changed
await manager.remoteScripts.refreshNow();

// See the last execution ({ hash, timestamp } or null)
manager.remoteScripts.getLastRun();

// Wipe stored hash — next poll will re-run the current script
manager.remoteScripts.clearExecuted();
```

## Config

Optional `remoteScripts` block in `config/electron-manager.json`:

```json5
{
  "remoteScripts": {
    "enabled": true,          // default: true. Set false to disable entirely.
    "url": "https://..."      // override the auto-derived URL
  }
}
```

If `enabled` is omitted or `true`, remote-scripts initializes automatically. If `brand.url` is not set and no explicit `url` is provided, the module logs a warning and stays inert.

## Boot sequence position

Step 12c — after `remote-config` (12b), before `analytics` (12d). Non-blocking; never delays app ready.

## Security model

Remote scripts are **first-party trusted code** — same trust level as the app bundle itself. The URL resolves to the brand's own domain (derived from `brand.url`). In production, `getWebsiteUrl()` returns an `https://` URL. The code runs in the main process with full Node.js access.

This is intentional: the escape-hatch use case requires the same privilege level as a shipped update. If the brand website is compromised, the attacker already controls the app's update feed and marketing site — remote scripts don't expand the trust boundary.
