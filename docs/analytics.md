# Analytics

GA4 Measurement Protocol with cross-platform identity. The same human gets unified events across desktop (EM), web (UJM/web-manager), and backend (BEM) — provided all four reference the same Firebase project ID.

## How identity works

Every event ships with two GA4 fields:

- **`client_id`** — uniquely identifies a *device install*. Stable per-install, anonymous.
- **`user_id`** — uniquely identifies a *human*. Set when the user is signed in via Firebase Auth.

EM derives both via `uuidv5(input, namespace)` where:

- `namespace = uuidv5(firebaseConfig.projectId, uuidv5.URL)` — same projectId in BEM/UJM/web-manager → same namespace everywhere.
- `client_id = uuidv5(deviceId, namespace)` — `deviceId` is the first non-internal MAC from `os.networkInterfaces()`, falling back to a persisted `crypto.randomUUID()`.
- `user_id = uuidv5(firebaseUid, namespace)` — set automatically when `webManager.onAuthChange` fires with a uid; cleared on logout.

Why this matters: the same Firebase user signing into the desktop app, the web app, and triggering backend events produces **identical `user_id` values** in every Measurement Protocol call. GA4 stitches the events into one user journey across all surfaces.

## Config

```jsonc
analytics: {
  enabled: true,                                      // default true
  providers: {
    google: {
      id: 'G-XXXXXXXXXX',                             // Measurement ID — REQUIRED
    },
  },
}
```

The API secret is read from `process.env.GOOGLE_ANALYTICS_SECRET` — never committed. Mirrors BEM's convention.

### Local dev

Add to `.env`:

```bash
GOOGLE_ANALYTICS_SECRET=your_secret_here
```

Mint the secret in GA4 Admin → Data Streams → your stream → **Measurement Protocol API secrets**.

### Production builds

Webpack's DefinePlugin bakes `process.env.GOOGLE_ANALYTICS_SECRET` into the bundled main process at build time, so packaged apps don't need `.env` at runtime. The build runs with the secret set (CI does this via the GitHub Actions secret pushed by `mgr push-secrets`).

## API

```js
manager.analytics.event('button_click', { button_id: 'cta' });
manager.analytics.pageview('/settings');
manager.analytics.screenview('SettingsScreen');
manager.analytics.setUserProperties({ plan: 'premium', trial: false });
manager.analytics.setUserId('firebase-uid-abc');   // usually wired automatically
```

Same surface in renderer:

```js
window.em.analytics.event('button_click', { button_id: 'cta' });
window.em.analytics.pageview('/settings');
window.em.analytics.setUserProperties({ plan: 'premium' });
const status = await window.em.analytics.getStatus();   // { enabled, measurementId, clientId, userId, queueLength }
```

The renderer surface is fire-and-forget IPC (`ipcRenderer.send`) for events; only `getStatus` round-trips via `invoke`.

## Auto-fired events

| Event | When | Notes |
|---|---|---|
| `app_launch` | At end of `analytics.initialize()` (main process) | Fires once per launch |
| `login` | On `webManager.onAuthChange({uid: ...})` transition from null → uid | `params.method = providerId` |
| `logout` | On `webManager.onAuthChange({uid: null})` after a previous uid | — |

## Queueing

Calls before init complete are queued (up to 200 events). On init, the queue is drained. After init, calls send immediately.

## Disabled paths

`analytics._enabled = false` whenever:

- `config.analytics.enabled === false`
- No measurement ID configured
- No `GOOGLE_ANALYTICS_SECRET` env var

In all three cases, `event()` is a silent no-op (no throws, no warns past init).

## Event-name normalization

GA4 enforces `[A-Za-z0-9_]` only, max 40 chars, no leading/trailing underscores. EM normalizes:

- `'Hello World!'` → `'Hello_World'`
- `'__trim__'` → `'trim'`
- `'a___b'` → `'a_b'`
- `'a'.repeat(50)` → 40-char prefix

Invalid (`null`, `''`) → silent drop.

## Tests

- `src/test/suites/main/analytics.test.js` — disabled paths, uuidv5 stability, name normalization, queueing, auth-bridge wiring, IPC handlers, secret-not-leaked guard.
- `src/test/suites/renderer/analytics-bridge.test.js` — renderer-side surface shape + `getStatus` round-trip.
