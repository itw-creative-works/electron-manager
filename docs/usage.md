# Usage

Tracks app-launch + hours-of-use stats. Sister of legacy electron-manager's Usage library, but uses `manager.storage` instead of a separate electron-store.

## What's tracked

```js
manager.usage.opens()              // total app launches
manager.usage.hoursTotal()         // cumulative hours-of-use across clean exits
manager.usage.hoursThisSession()   // live, computed from session start
manager.usage.installedAt()        // ISO timestamp of first launch
manager.usage.toJSON()             // all of the above as a structured-cloneable object
```

## How it accumulates

Persisted shape (`storage.usage`):

```js
{
  opens: 12,
  hoursTotal: 4.75,
  installedAt: '2025-12-01T...',
  lastLaunchAt: '...',
  lastQuitAt: '...' | null,
}
```

On boot:

1. Read previous snapshot.
2. If `lastQuitAt` is set, accumulate `(lastQuitAt - lastLaunchAt)` into `hoursTotal`. This is the "previous session ended cleanly" case.
3. If `lastQuitAt` is null, the previous session crashed — we don't credit any hours. We don't know how long it ran.
4. `opens += 1`, `lastLaunchAt = now`, `lastQuitAt = null`.

On quit (via `app.on('before-quit')`):

5. `lastQuitAt = now` written to storage.
6. Next launch's step 2 picks up the duration.

So `hoursTotal` is intentionally a lower bound — it never over-counts crashed sessions.

`hoursThisSession()` is computed live from `(Date.now() - sessionStart) / 3600000`. Never stale.

## Renderer

```js
const snap = await window.em.usage.get();
// { opens: 12, hoursTotal: 4.75, hoursThisSession: 0.05, installedAt: '...' }
```

## Why not just use app-state?

`app-state.js` already tracks `launchCount` (= opens). We could fold these in. But `app-state` is concerned with first-launch / crash-sentinel / version-change semantics — `usage` is concerned with telemetry. Keeping them separate keeps each module focused. Both write to disjoint keys in `manager.storage`.

## Tests

- `src/test/suites/main/usage.test.js` — opens-bumps-on-reinit, hoursTotal accumulation from clean prior session, no-credit for crashed sessions, installedAt persistence, IPC handler.
