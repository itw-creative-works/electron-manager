# Auto-updater

Wraps `electron-updater` with three triggers: startup check, periodic check, and a 30-day max-age gate that force-installs pending updates that have been ignored too long.

## Triggers

| Trigger | When | Behavior |
|---|---|---|
| **Startup check** | `startupDelayMs` after `app.whenReady()` (default 10s) | Non-blocking. Fires once. |
| **Periodic check** | Every `intervalMs` (default 60s) | Fires forever, also re-evaluates the 30-day gate each tick. |
| **30-day gate** | At init + every periodic tick | If a pending update was downloaded ≥ `maxAgeMs` ago (default 30 days), force `quitAndInstall()`. |
| **Manual check** | `manager.autoUpdater.checkNow()` (main) or `window.em.autoUpdater.checkNow()` (renderer) | Same as a periodic check but `userInitiated: true`. |

## State machine

`status.code` is one of:

```
idle             — nothing happening
checking         — checking the feed
available        — feed says an update exists
downloading      — download in progress (status.percent updated)
downloaded       — fully downloaded; ready to install. Also: pendingUpdate.downloadedAt is set in storage.
not-available   — feed says no update
error           — checkForUpdates() or download failed; status.error.message has details
```

## Config (`config/electron-manager.json`)

```jsonc
autoUpdate: {
  enabled:        true,
  channel:        'latest',          // latest / beta / alpha
  startupDelayMs: 10000,             // 10s after whenReady
  intervalMs:     60000,             // 60s — also when the 30-day gate is re-checked
  maxAgeMs:       2592000000,        // 30 days; if pendingUpdate is older, force install
  autoDownload:   true,              // electron-updater downloads automatically
}
```

## 30-day max-age gate

The problem: if a user keeps their app open for weeks, an update may download but never apply. Eventually their version is dangerously stale (e.g. an unpatched security issue).

The gate:

1. **First download wins.** When `update-downloaded` fires, EM stores `pendingUpdate = { version, downloadedAt: Date.now() }` to `storage.autoUpdater.pendingUpdate`.
2. **Subsequent downloads do NOT reset the timer.** If a newer update downloads later, `downloadedAt` stays at the original time. (Otherwise the user could keep dodging by triggering re-checks.)
3. **Every poll tick + at init**, EM checks if `Date.now() - downloadedAt >= maxAgeMs`. If yes → `quitAndInstall()`. Force.
4. **Cleared on apply.** When the app next launches and `app.getVersion() === pendingUpdate.version`, the flag is cleared automatically (the user successfully restarted into the new version).

This guarantees no app on EM stays > maxAgeMs days behind a downloaded update.

## Idle-aware install (15-min default)

When an update finishes downloading via a background poll (NOT a user-initiated check), EM does NOT immediately quit-and-install. Instead, it kicks off an idle watcher:

- Any UI activity bumps `_lastActivityAt = Date.now()`. Built-in signals:
  - **Renderer-side** — `mousedown`, `keydown`, `wheel`, `touchstart`, `focus` on `window` (capture phase, debounced to once per 5s; sent to main as IPC `em:auto-updater:activity`).
  - **Main-side** — `app.on('browser-window-focus')` (covers tray-click-to-show, dock click, alt-tab back, etc.).
- Every minute, the watcher polls `Date.now() - _lastActivityAt`:
  - If `>= 15min` → `installNow()` (app quits + relaunches into the new version).
  - Else if we haven't prompted for this version yet → show a native dialog ("Restart Now / Later"). One prompt per version, ever. Dismissal ("Later") is "not now" — the watcher keeps polling and will auto-install when the user eventually walks away.

Constants are hardcoded at the top of `src/lib/auto-updater.js`:
- `IDLE_INSTALL_THRESHOLD_MS = 15 * 60 * 1000` — how long the user must be idle.
- `IDLE_WATCHER_INTERVAL_MS = 60 * 1000` — how often the watcher re-evaluates.

User-initiated checks (someone clicked "Check for Updates" in the menu/tray) bypass this entirely — the consumer's UI is responsible for surfacing the "Restart to Update" affordance (the menu/tray item already does this label-wise).

### Consumer hook: `markActive()`

Consumers can force-bump the activity timestamp from anywhere:

```js
manager.autoUpdater.markActive();
```

Call this from app-specific signals the framework can't see — e.g. just received an auth event, finished a long renderer task, finished a backend sync. Use sparingly; the built-in renderer mouse/keyboard/focus signals cover almost everything.

### Why 15 minutes?

Long enough that an actively-used app won't surprise-quit mid-task. Short enough that a user who minimizes the app and walks to lunch comes back to the new version. Tune the constants in `auto-updater.js` if your app's usage pattern is different.

### Implementation notes

- `_promptedForVersion` tracks the version we've already shown the dialog for. Reset on `shutdown()`. If a *newer* update downloads later, the prompt fires again (different version).
- `_idleWatcherId` is cleared as soon as `_state.code !== 'downloaded'` (i.e. the moment installNow() takes effect or storage clears the pending update).
- The watcher tick runs immediately upon download, then every `IDLE_WATCHER_INTERVAL_MS`. So a user who's been idle for hours when the update lands gets the install instantly without waiting another minute.

## Menu integration

EM's default menu template includes a "Check for Updates..." item with id `em:check-for-updates`. The auto-updater listens to its own status changes and updates the item's label + enabled state, VS Code-style:

| State | Label | Enabled |
|---|---|---|
| `idle` / `error` | Check for Updates... | yes |
| `checking` | Checking for Updates... | no |
| `available` | Downloading Update v{version}... | no |
| `downloading` | Downloading Update ({percent}%) | no |
| `downloaded` | Restart to Update v{version} | yes (clicks `installNow()`) |
| `not-available` | You're up to date | yes |

Click handler defaults to `checkNow()` when not yet downloaded; `installNow()` when downloaded.

Consumers can find / move / remove the item via `manager.menu.findItem('em:check-for-updates')` etc. — see [docs/menu.md](menu.md).

## Renderer surface

Preload exposes `window.em.autoUpdater`:

```js
// Get current state
const status = await window.em.autoUpdater.getStatus();
// → { code, version, percent, error, downloadedAt, lastCheckedAt }

// Subscribe to updates
const unsubscribe = window.em.autoUpdater.onStatus((status) => {
  console.log('update status →', status.code, status.version, status.percent);
});

// User-initiated check (e.g. "Check for updates" menu item)
await window.em.autoUpdater.checkNow();

// User-initiated install (after status === 'downloaded')
await window.em.autoUpdater.installNow();
```

Status is also broadcast on the IPC channel `em:auto-updater:status` after every state transition.

## Dev simulation

Without a real update server you can validate the entire flow via env vars:

```bash
# Simulate "update available" — full cascade through downloading → downloaded
EM_DEV_UPDATE=available npm start

# Simulate "no update available" — lands in not-available
EM_DEV_UPDATE=unavailable npm start

# Simulate a feed failure — lands in error
EM_DEV_UPDATE=error npm start
```

In dev simulation mode, `quitAndInstall()` is a no-op (no actual restart) so you can step through the dialog flow without the app exiting.

## Production: how electron-updater finds the feed

`electron-updater` reads the `publish` block from the embedded `app-update.yml` (baked into the `.app` / `.exe` at build time by electron-builder). EM's `gulp/build-config` injects `publish` from `config.releases.{owner,repo}` into `dist/electron-builder.yml` before packaging, so the published `app-update.yml` points at:

```
provider: github
owner:    <config.releases.owner ?? appOwner>
repo:     <config.releases.repo  ?? 'update-server'>
releaseType: release
```

So your private app repo and your public release repo are completely decoupled — the bundled binary knows where to look for updates.

## Failure modes

- **Update repo isn't public** → `electron-updater` gets 404 or 401 against a private repo. Fix: ensure `<owner>/<update-server>` is public.
- **Token rotates / expires for `releases` repo** — `electron-updater` doesn't authenticate downloads (anonymous public reads). So tokens don't apply on the consumer side.
- **`app-update.yml` missing in the packaged app** → look at the build log for `electron-builder`'s "creating updates yml" line. If it's skipped, your `publish` block didn't materialize correctly into `dist/electron-builder.yml`.
- **`error` status with code `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`** → there's no `latest-mac.yml` (or `latest.yml` / `latest-linux.yml`) at the configured channel. Run a release first.

## Tests

- `src/test/suites/main/auto-updater.test.js` — state machine, dev simulation, 30-day gate (first-download-wins, force install at age, fresh updates ignored), pendingUpdate clear on version match, IPC handler registration, `enabled=false` skip.
