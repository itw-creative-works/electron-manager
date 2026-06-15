# Remote Config (a.k.a. "Hot Config")

Fetches a JSON document from the consumer's brand site so app behavior can be flipped without shipping a new build.

Modeled after the legacy somiibo / slapform `data/resources/main.json` convention.

## Source URL

By default: `${brand.url}/data/resources/main.json`. Override:

```jsonc
remoteConfig: {
  enabled: true,
  url: 'https://my-app.example/some/other/path.json',   // optional
}
```

## Cadence

Polled at the same interval as the auto-updater feed-check (`autoUpdater.feedCheckIntervalMs`, default 1h). Same job category (HTTP, low-frequency, network-dependent), so re-using the cadence keeps both poll-rates aligned. Fetch timeout is 60s; in tests both collapse to 500ms via `manager.isTesting()`.

## Defaults — `get()` always returns SOMETHING usable

A key design point: **app boot never blocks on the fetch**. `initialize()` returns synchronously, and `get()` is guaranteed to return non-`undefined` data from the moment init returns. The data progression:

1. **Synchronous, at `initialize()`:** `_data` is seeded with safe defaults so `get()` works immediately.
2. **Synchronous, if a prior session cached a fetch:** cached values overlay the defaults.
3. **Async, on the first successful background fetch:** server values overlay the defaults.
4. **Async, on every subsequent successful fetch:** repeats step 3, fires `'update'` event so consumers can re-run gates.

Defaults (exported as `manager.remoteConfig.DEFAULTS`):

```js
{
  status:          'online',     // 'online' | 'maintenance' — app gates UI on this
  versionRequired: '0.0.0',      // installed apps below this should force-update
  defaults:        {},           // free-form per-app overrides
}
```

Consumers should add their own fields freely (`limits`, `popupTriggers`, etc. — like the legacy somiibo config). Anything missing from the server response falls back to the EM-side `DEFAULTS` constant.

## The "re-run gates on update" pattern

Because the first fetch happens AFTER boot (potentially seconds later), any gate that depends on remote-config values needs to run twice: once at boot with defaults/cache, then again on every successful fetch.

```js
const semver = require('semver');
const { app, dialog } = require('electron');

function checkForceUpdate(cfg) {
  const required = cfg?.versionRequired || '0.0.0';
  if (semver.lt(app.getVersion(), required)) {
    dialog.showMessageBox({
      type: 'warning',
      message: `Update required (you have ${app.getVersion()}, server requires ${required}).`,
    });
  }
}

// Run at boot — works against defaults / cached value / first fetch result, whatever's there.
checkForceUpdate(manager.remoteConfig.get());

// Re-run on every fresh fetch so a server-side bump kicks in within an hour.
manager.remoteConfig.on('update', checkForceUpdate);
```

## Failure mode

A failed `refreshNow()` *throws* (so callers can react). The internal periodic poll catches and logs warning. The cached `_data` is never reset on failure — the app keeps working with last-known-good values (or DEFAULTS if no fetch has ever succeeded).

Failure warnings are formatted through `src/utils/format-fetch-error.js` — one line, HTTP status prefix, HTML error-page bodies replaced with a short description, 200-char cap. A missing `/data/resources/main.json` (typically the brand site's HTML 404 page) logs as `HTTP 404: response was an HTML page, not the expected resource` instead of the entire page markup.

## API

```js
manager.remoteConfig.get();                     // → entire current config (cache-first, never blocks)
manager.remoteConfig.get('versionRequired');    // → dot-path lookup
manager.remoteConfig.get('settings.deep.path'); // → nested
manager.remoteConfig.refreshNow();              // → force a fetch right now (returns Promise<data | null>)
const off = manager.remoteConfig.on('update', (data) => { ... });
off();                                          // unsubscribe
```

Renderer:

```js
const cfg = await window.em.remoteConfig.get();
const v   = await window.em.remoteConfig.get('versionRequired');
await window.em.remoteConfig.refreshNow();
const off = window.em.remoteConfig.onUpdate((data) => {
  // Fired on every successful fresh fetch from main.
});
```

## Cache strategy

- **Boot** → restore last cached value from `storage.remoteConfig` immediately. `get()` returns it synchronously.
- **Background** → kick off the first fetch. On success, overwrite cache + emit `update`.
- **Periodic** → re-fetch on the same cadence. On failure, leave cache untouched (app keeps working with last-known-good).

So `get()` always returns SOMETHING after the first successful fetch ever — even on offline boots.

## Failure mode

A failed `refreshNow()` *throws* (so callers can react). The internal periodic poll catches and logs. The cached `_data` is never reset on failure.

## Disabling

```jsonc
remoteConfig: { enabled: false }
```

Skips the fetch + the polling timer entirely. `get()` returns `undefined`.

## Tests

- `src/test/suites/main/remote-config.test.js` — URL derivation from brand.url, override URL, enabled=false short-circuit, dot-path lookup, on/off subscription, IPC handlers.
