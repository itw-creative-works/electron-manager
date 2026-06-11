# Lib Modules

`src/lib/*.js` — every Electron concern is its own module. Each exports a singleton with `initialize(manager)`; the main-process Manager wires them in a fixed order at boot (see [boot-sequence.md](boot-sequence.md)). The per-module catalog with one-line descriptions lives in [CLAUDE.md](../CLAUDE.md#lib-modules); each row links its own deep reference (`docs/<lib-name>.md`).

## Lib initialization contract

Each lib exposes the same skeleton:

```js
const myLib = {
  _initialized: false,
  _manager: null,

  initialize(manager) {
    myLib._manager = manager;
    // wire IPC handlers, app event listeners, etc.
    myLib._initialized = true;
  },

  // Public API
  doThing() { ... },

  // Disable at runtime (idempotent)
  disable() {
    // tear down listeners; safe to call multiple times
  },
};

module.exports = myLib;
```

Don't use `EventEmitter` unless the lib genuinely emits multiple event types. For "fires once when ready" use a promise; for "broadcasts changes" use IPC with renderer subscriptions.

## Adding a new lib

1. Create `src/lib/<name>.js` exporting a singleton object with `initialize(manager)`.
2. Wire it into the boot order in `src/main.js` (or the renderer/preload Manager if it's a per-context lib) — check [boot-sequence.md](boot-sequence.md) for where it belongs and what it may depend on.
3. Attach it to `Manager.prototype` as `manager.<camelCaseName>` so consumers can access it at runtime.
4. Write tests at every layer the lib has a surface in (see [test-framework.md](test-framework.md)) — at minimum `src/test/suites/main/<name>.test.js`.
5. Add a `docs/<name>.md` deep reference and link it from the CLAUDE.md lib catalog + Documentation index.

## Flat file vs directory split

- **Default to flat `src/lib/<name>.js`.**
- **Split into a directory** (`src/lib/<name>/{index,core,main,renderer,preload}.js`) ONLY when each Electron context has materially different logic that would force ugly runtime branching inside one file. `index.js` becomes a thin context detector that delegates.
- Currently only `lib/sentry/` is split (the SDK has separate main/renderer/preload entry points). `sign-helpers/` is a helpers directory, not a lib.
- Don't split prophylactically; convert when the branching gets ugly.

## See also

- [boot-sequence.md](boot-sequence.md) — the fixed `manager.initialize()` order + rationale
- [environment-detection.md](environment-detection.md) — cross-context helpers shared by all four Managers via `attachTo(Manager)`
- [test-framework.md](test-framework.md) — the four-layer harness new libs must ship tests in
