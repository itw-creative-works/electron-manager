# App State

Storage-backed launch flags + crash sentinel. Tells you *whether* this is the first launch ever, *how many* times the app has launched, *whether* the previous run crashed, and *whether* the version changed.

## Public API on `manager.appState`

```js
manager.appState.isFirstLaunch()         // boolean — true ONLY on the very first boot
manager.appState.getLaunchCount()        // number — total successful launches (including this one)
manager.appState.getInstalledAt()        // Date  — first ever launch timestamp
manager.appState.getLastLaunchAt()       // Date | null — previous launch (null on first)
manager.appState.getLastQuitAt()         // Date | null — previous graceful quit; null if it crashed
manager.appState.recoveredFromCrash()    // boolean — previous run did not exit cleanly

manager.appState.getVersion()            // string | null — package version of this launch
manager.appState.getPreviousVersion()    // string | null — version before this launch
manager.appState.wasUpgraded()           // boolean — true if THIS launch's version differs from the prior

manager.appState.launchedAtLogin()       // boolean — OS booted us via openAtLogin
manager.appState.launchedFromDeepLink()  // boolean — argv had a deep-link payload (set by lib/deep-link)

manager.appState.reset()                 // wipe persisted state (test helper / factory-reset command)
```

## Storage shape (key `appState`)

```js
{
  installedAt:     1700000000000,    // first ever boot timestamp (ms epoch)
  launchCount:     42,
  lastLaunchAt:    1700000123456,    // THIS launch's timestamp; previous launch's value exposed via getLastLaunchAt()
  lastQuitAt:      null,             // null while running; set on graceful quit
  version:         '1.2.3',
  previousVersion: '1.2.2',          // preserved across no-change launches (see "Upgrade detection")
  sentinel:        true              // true while running, cleared on graceful quit
}
```

## Crash detection

- On every boot, `appState.initialize()` reads the previous `sentinel` and `lastQuitAt` values BEFORE overwriting them.
- If `sentinel === true` AND `lastQuitAt === null`, the previous run never made it to `before-quit` / `will-quit` → it crashed. `recoveredFromCrash()` returns `true` for this launch only.
- First launch is exempt (no prior state to compare).
- Graceful-quit cleanup is wired up via `app.on('before-quit')` and `app.on('will-quit')`. Both fire under different shutdown paths; either one clears the sentinel and writes `lastQuitAt`.

## Upgrade detection

`wasUpgraded()` is true **only** if THIS launch's version differs from the prior launch's version. Subsequent launches at the same version return `false`, but `getPreviousVersion()` keeps returning the historical value so you can show a "what's new" UI on the second launch too.

```js
// install 1.0.0
appState.wasUpgraded()        // false (first launch)
appState.getPreviousVersion() // null

// upgrade to 1.0.1, launch again
appState.wasUpgraded()        // true
appState.getPreviousVersion() // '1.0.0'

// launch again at 1.0.1, no change
appState.wasUpgraded()        // false
appState.getPreviousVersion() // '1.0.0' (preserved — useful for "what's new" UIs)
```

## Common patterns

### Show onboarding on first launch

```js
if (manager.appState.isFirstLaunch()) {
  manager.windows.show('onboarding');
}
```

### Crash report ping

```js
if (manager.appState.recoveredFromCrash()) {
  manager.sentry.captureMessage('recovered from crash', 'warning');
}
```

### What's new modal after upgrade

```js
if (manager.appState.wasUpgraded()) {
  manager.windows.show('changelog');
}
```

## Test helper

`appState.reset()` wipes the persisted state and resets the in-memory snapshot. Useful in test suites and as a real `Settings → Reset to factory defaults` command.
