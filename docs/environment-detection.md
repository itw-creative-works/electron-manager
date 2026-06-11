# Environment Detection

`getEnvironment()` returns exactly ONE of three mutually-exclusive, exhaustive values:

```javascript
Manager.getEnvironment()    // 'development' | 'testing' | 'production'

Manager.isDevelopment()     // true ONLY in development
Manager.isTesting()         // true ONLY in testing
Manager.isProduction()      // true ONLY in production
```

**The Manager is the single source of truth.** `getEnvironment()` is the ONLY function that reads the raw signals (`EM_TEST_MODE` / Electron `app.isPackaged` / `config.em.environment` / `EM_BUILD_MODE` / `NODE_ENV`). The three `is*()` checks **derive** from it live on every call — they never read raw signals themselves, so they can never disagree with `getEnvironment()`.

**One implementation, mixed into all four Managers.** EM has four Manager entry points (main / renderer / preload / build). The helpers are defined once in [src/utils/mode-helpers.js](../src/utils/mode-helpers.js) and mixed into each via `attachTo(Manager)`, available as both prototype methods (`manager.isTesting()`) and statics (`Manager.isTesting()`).

```javascript
manager.getEnvironment()    // same answer in main / renderer / preload / build
Manager.isTesting()         // static form, for build-time scripts
```

**Resolution order:** testing wins first, then production, else development. The three checks are mutually exclusive — exactly one is true. `isDevelopment()` is **false** during testing, and `isProduction()` is a real positive check (it is NOT `!isDevelopment()`).

## Available helpers

| Helper | Returns |
|---|---|
| `getEnvironment()` | `'development' \| 'testing' \| 'production'` — the SSOT resolver; the only reader of raw signals. |
| `isDevelopment()` | `true` ONLY in development (running unpackaged / `electron .` / dev), and NOT testing. Derives from `getEnvironment()`. |
| `isTesting()` | `true` ONLY in testing (`EM_TEST_MODE === 'true'`). **Takes precedence** — a test run is unpackaged, but it's a test, not development. |
| `isProduction()` | `true` ONLY in production (packaged & distributed, `app.isPackaged === true`). A **real positive check** — NOT `!isDevelopment()`. |

## Gating side effects — use the INTENTIONAL check

Because there are three environments, never gate a side effect on a two-value assumption. State what you mean:

```javascript
// Production-only (skip OS side effects / real telemetry in dev AND testing):
if (isProduction())  { /* do the real thing */ }
if (!isProduction()) { /* skip / use the safe local behavior */ }

// Local-or-test (anything that should run in BOTH dev and testing):
if (isDevelopment() || isTesting()) { /* localhost URL, isolate userData, suppress login items */ }
```

**Avoid** `if (!isDevelopment())` or `if (env !== 'development')` to gate production behavior — those wrongly include `testing` as production and leak real side effects (login items, telemetry, auto-update) during test runs. This is the bug class that motivated the 3-value model. (A genuinely dev-only feature like live-reload is the exception: `env !== 'development'` correctly skips it in both testing and production.)

## URL helpers

```javascript
Manager.getApiUrl()  // the app's API URL — the SSOT for calling the backend
```

`getApiUrl()` / `getFunctionsUrl()` / `getWebsiteUrl()` resolve to **local** URLs (`http://localhost:5002` / `http://localhost:5001/<projectId>/us-central1` / `https://localhost:4000`) in development OR testing, and to production (`https://api.<authDomain>` etc.) otherwise. They route through `this.getEnvironment()`, so they're correct everywhere without an argument — call them directly. Pass an explicit `env` arg (`getApiUrl('production')`) only to force a specific environment regardless of the current one — rarely needed, and mainly used by tests to pin a specific environment's mapping.

Resolving local in test mode is required because tests hit the local emulator — without it, the app (and tests calling `getApiUrl()`) would leak to the live production server.

> The URL helpers live in [src/utils/url-helpers.js](../src/utils/url-helpers.js) and depend on `this.getEnvironment()` (from mode-helpers.js) being mixed in — both `attachTo` calls run at the bottom of every Manager entry point.

## Where they live

Source: [src/utils/mode-helpers.js](../src/utils/mode-helpers.js) for `getEnvironment()` + `is*()` + `getVersion()`; [src/utils/url-helpers.js](../src/utils/url-helpers.js) for the URL builders. Each module exposes the functions plus an `attachTo(Manager)` mixin. Attached at the bottom of all four Manager files: [main.js](../src/main.js), [renderer.js](../src/renderer.js), [preload.js](../src/preload.js), [build.js](../src/build.js) — mode-helpers first (so `getEnvironment` exists), then url-helpers.

## How detection works

`getEnvironment()` resolves in this precedence order:

1. **Testing** — `process.env.EM_TEST_MODE === 'true'` (set by EM's test runners). A test run is a test run regardless of packaged state.
2. **Config override** — `config.em.environment` (`'development'` / `'testing'` / `'production'`), the consumer's explicit choice. It beats the auto-detected `app.isPackaged` below.
3. **Production / Development (runtime)** — Electron `app.isPackaged`: packaged → production, unpackaged → development. This is the authoritative runtime signal in the main process. In renderer / preload / plain Node, `app` is unavailable, so it falls through.
4. **Build-time signals** — `EM_BUILD_MODE === 'true'` → production; `NODE_ENV === 'development'` → development.
5. **Default** — production. EM's deployed *runtime* can reach here without a dev signal (a packaged binary whose `app.isPackaged` didn't resolve is still a shipped app), so production is the safe assumption. (Contrast UJM/BXM, whose deployed artifacts always carry their signal baked in, so they default to **development** — a bare context there is just build tooling. BEM defaults to production for the same reason as EM.)

## Adding a new helper

Write the function in a `src/utils/<topic>-helpers.js` module, expose `attachTo(Manager)`, then call `attachTo` at the bottom of all four Manager files. Don't define helpers on individual Manager prototypes — that path leads to duplicated semantics (the old `getEnvironment` collision between main.js and build.js). For anything environment-derived, derive from `getEnvironment()` rather than reading `process.env` / `app.*` directly, so there is one source of truth and no chance of drift.

## Why this matters

**One signal, used everywhere.** The test runner sets `EM_TEST_MODE=true`; every piece of code that calls `isTesting()` (framework or consumer) then sees `true` — no need to invent a per-module env var.

**Sub-modules check the same signal.** When framework code (an auto-update poll, a restart-manager registration) needs to skip side effects in tests, it checks `isTesting()` — the same answer the consumer's own code gets. No drift.

**`is*()` can never disagree with `getEnvironment()`.** Because the checks derive from the single resolver instead of reading raw signals (`app.isPackaged` vs `EM_BUILD_MODE`), there is exactly one definition of "what environment is this," and a wrong-but-confident gate is structurally impossible.

## See also

- [test-framework.md](test-framework.md) — `EM_TEST_MODE` is set automatically by the test runners; extended mode (`--extended` / `TEST_EXTENDED_MODE`) gates real external APIs.
