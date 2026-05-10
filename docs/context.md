# Context

Runtime info block. Mirrors BEM's `assistant.request.{geolocation,client}` shape so EM apps + sister projects (BEM, UJM, web-manager) all reference the same property paths when reading user info.

Populated asynchronously during `manager.initialize()`.

## Shape

```js
manager.context.geolocation = {
  ip:      '203.0.113.42',     // async-fetched via ipify
  country: null,               // future enhancement
  region:  null,
  city:    null,
};

manager.context.client = {
  userAgent: 'Mozilla/5.0 ...',  // app.userAgentFallback
  locale:    'en-US',            // app.getLocale()
  platform:  'darwin',           // os.platform()
  arch:      'arm64',            // os.arch()
  mobile:    false,              // always false on EM (desktop framework)
};

manager.context.session = {
  id:        '<uuid>',           // fresh per launch (crypto.randomUUID)
  startTime: '2026-05-08T...',   // ISO at boot
  deviceId:  '<uuid or MAC>',    // stable per-machine
};

manager.context.app = {
  version:     '1.2.3',          // manager.getVersion()
  environment: 'production',     // manager.getEnvironment()
  isPackaged:  true,             // app.isPackaged
};
```

## Device ID resolution

Order:

1. **Storage** — already persisted from a prior boot. Wins so we're stable across NIC swaps / VPN changes.
2. **First non-internal MAC** from `os.networkInterfaces()`. Stable on a stable rig.
3. **`crypto.randomUUID()`** fallback. Persisted on first launch.

Once resolved on first launch it never changes. This is the input to `analytics._clientId = uuidv5(deviceId, projectIdNamespace)`.

## Geolocation

`geolocation.ip` is fetched in the background via `https://api.ipify.org?format=json`. Cached to `storage.context.geolocation` so the next launch has last-known-good values even if offline. The `country/region/city` fields are reserved for a future enrichment provider.

Failure mode: a failed ipify fetch leaves the previous cached value untouched. The app keeps working with last-known-good.

## API

```js
manager.context.geolocation.ip            // direct read
manager.context.session.deviceId          // direct read
const snap = manager.context.toJSON();    // structured-cloneable snapshot
```

Renderer:

```js
const snap = await window.em.context.get();
console.log(snap.session.deviceId);
```

## Why the BEM shape

Sister projects (BEM, web-manager, UJM) all reference paths like `assistant.request.geolocation.country` and `assistant.request.client.userAgent`. EM matches the leaf names so consumer code can write logic that works across all four runtimes:

```js
const country = manager.context.geolocation.country
             || assistant.request.geolocation.country  // BEM
             || webManager.context.geolocation.country;
```

## Tests

- `src/test/suites/main/context.test.js` — session shape, deviceId stability across re-init, client info, IPC handler, JSON-roundtrippability.
