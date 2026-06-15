# Test Framework

Built-in test framework for both EM itself and consumer projects. Jest-like assertion syntax (`expect(actual).toBe(expected)`), layered runners, BEM-style output.

## 🚫 NEVER mock — test against the real harness (HARD RULE)

**Do NOT hand-roll fake/stub/mock objects** — no `mockManager`, fake `ipc`/`storage`/`window`/`tray`, stubbed `app`/`BrowserWindow`, or fake IPC channels. Every test gets the **real** framework context:

- `build` runs real EM helper code in plain Node.
- `main` / `renderer` / `boot` run inside a **real spawned Electron process**, where `ctx.manager` (and boot's `inspect({ manager })`) is the **real booted Manager** — real `manager.storage`, `manager.ipc`, `manager.tray`, `manager.windows`, etc. Use them; exercise the code the way production does.

**Pure functions are the ONLY exception.** A function with zero I/O (config-defaults merge, icon-path resolver, schema validator, CLI alias resolver, a string/number transform) can be `require()`d and called directly with plain inputs — that's not mocking, there's nothing to mock. The moment a function touches `app.*` / `BrowserWindow` / `ipcMain` / `Tray` / the real bundle / an external service, it MUST run against the real harness in the appropriate layer (`main` / `renderer` / `boot`), not a stub.

**Real external APIs are gated behind extended mode (`TEST_EXTENDED_MODE`), NOT mocked** (see [Extended vs normal mode](#extended-vs-normal-mode) below). Normal mode skips them *in the source*; extended mode runs them for real. The test never fakes them. **Anything an extended test creates in a real external system MUST be cleaned up** by the test (via the suite's `cleanup(ctx)` hook) — external systems are not reset between runs.

If you find yourself writing `const mockX = {...}` to satisfy code under test, STOP — pass the real `ctx.manager` (or its real sub-object), or, if the function is genuinely pure, call it directly with plain data.

### The ONLY two exceptions where a narrow stub is allowed

Mock **nothing** by default. There are exactly two cases where the real dependency genuinely cannot run in the test environment — and even then, stub the *smallest possible seam* (one method / one object), restore it immediately, and comment *why*:

1. **A side effect that would destroy the test run itself.** If the real call would kill or corrupt the harness — `app.quit()`, a process-exit, `autoUpdater.quitAndInstall()`, a destructive wipe — stub *that one call* to a no-op, assert the surrounding decision logic (e.g. that `_allowQuit` was set first), then restore. You are preventing the harness from terminating mid-assertion, not faking behavior. (Examples: `window-manager.test.js` stubs `app.quit`; `auto-updater.test.js` stubs `installNow`/`_promptToInstall`.)
2. **A real dependency the test environment can't provide.** When the real object only exists from infra you can't stand up in a unit test (e.g. a live `webContents` from a not-yet-created window, a second running app instance), a unit test may hand a minimal stub to verify a *narrow side effect* (e.g. that `attach()` registers the right listener). Prefer obtaining the real object from the harness if you can; only stub when you genuinely can't.

If you can run it for real, you must. These exceptions are not a license to unit-test in isolation when a real-harness layer (`main`/`renderer`/`boot`) would work.

## Test coverage — every surface gets a test (HARD RULE)

A feature is not done when it works — it's done when every surface it exposes is covered in the layer that owns that surface:

| Coverage | Layer | Proves |
|---|---|---|
| **Logic** | `build` / `main` | The feature's functions do the right thing when called directly (real Manager, real storage, real IPC) |
| **UI** | `renderer` | The feature's interface is WIRED — a real event on the real DOM triggers the behavior and the visible result appears |
| **End-to-end** | `boot` | The feature survives in the consumer's actual built bundle (extend the boot suite's `inspect` assertions) |

**Skipping a layer is the exception, not the default.** A layer may be skipped ONLY when the feature genuinely has no surface there — a pure build-time utility has no UI; a CSS-only tweak has no logic to call. Convenience is never a reason: "the logic test already covers it" does NOT excuse the UI test — logic tests prove the logic, UI tests prove the wiring (a button can come unhooked while every logic test stays green), boot tests prove the packaging. When in doubt, write the test.

## Running tests

```bash
npx mgr test                          # consumer: runs framework + project suites
npx mgr test --layer=main             # only main-process suites (also: build, renderer, all)
npx mgr test --filter="storage"       # only suites/tests whose name contains "storage"
npx mgr test --extended               # opt into extended mode — real external APIs (also: TEST_EXTENDED_MODE=true)
npx mgr test --reporter=json          # pretty output + machine-readable {"event":"summary",...} line
EM_TEST_DEBUG=1 npx mgr test          # see Electron stderr (otherwise drained silently)
```

In EM itself, `npm test` does the same.

### Filtering tests

Pass a path (relative to `test/`) as a positional **target** to select which test FILES run:

```bash
# Run a single test file (matches both framework + project)
npx mgr test build/config

# Run ONLY consumer project tests (no framework suites at all)
npx mgr test project:

# Run a single project test file
npx mgr test project:main/tab-manager

# Run ONLY framework tests (universal cross-framework alias)
npx mgr test mgr:

# Run ONLY EM framework tests (EM-specific aliases, equivalent to mgr:)
npx mgr test em:
npx mgr test framework:

# Run framework tests matching a path
npx mgr test mgr:build/config
npx mgr test em:build/config

# Combine with extended mode
TEST_EXTENDED_MODE=true npx mgr test build/config
```

The target matches against the test file path. The source prefix scopes selection to framework-only or project-only tests — a prefixed target excludes the other source entirely:

- `mgr:` — the **universal cross-framework alias** for "the manager's own tests" (framework-only). Works identically in EM, BXM, UJM, and BEM.
- `em:` / `framework:` — EM-specific aliases for framework-only tests, equivalent to `mgr:`.
- `project:` — consumer project tests only.

A bare prefix (`mgr:` / `em:` / `project:` with no path) runs every test in that source. A bare path (no prefix) searches both sources by path.

> **Target vs `--filter`.** The positional target selects test FILES (by path + source). The `--filter=<substring>` flag is orthogonal: it matches test NAMES/descriptions within the selected files. Use them together, e.g. `npx mgr test project: --filter="reorder"`.

### Layers

- **build** — runs in plain Node. Fast.
- **main**  — spawns Electron and runs inside the main process. Required for anything touching `app`/`ipcMain`/`BrowserWindow`.
- **renderer** — runs inside a hidden `BrowserWindow` spawned by the main harness. Test functions are serialized + reconstructed via `new Function('ctx', body)`, so they only have access to `ctx` and the page's globals (`window`, `document`, `window.em.*`). No closures over module scope.
- **all** (default) — build, then main, then renderer in a single Electron boot.

### Extended vs normal mode

Suites that hit a live backend (Firebase Auth admin SDK, real GitHub API, etc.) are gated behind **extended mode** — `npx mgr test --extended` or `TEST_EXTENDED_MODE=true`. `TEST_EXTENDED_MODE` is the **shared, unprefixed env var across BEM/BXM/UJM/EM** (cross-framework parity) — once set on `process.env` it propagates to every spawned test environment (the Electron main/renderer/boot children, the gulp boot build) automatically via `{ ...process.env }`. These external calls are **skipped in-source, NOT mocked** — the suite short-circuits / `ctx.skip()`s when `TEST_EXTENDED_MODE` is unset; with it set, it calls the real service. Default is to skip them so `npx mgr test` is fast + green offline, and a warning prints when extended mode is on. The CI workflow runs normal mode by default; add a separate workflow that sets `TEST_EXTENDED_MODE: 'true'` for extended coverage.

Anything an extended suite creates externally must be torn down in its `cleanup(ctx)` — the harness only resets local Electron state between runs, never external systems.

### `EM_TEST_MODE=true` — the canonical "we're in tests" signal

Both EM test runners (`runners/electron.js`, `runners/boot.js`) set `EM_TEST_MODE=true` in the spawned child env. That powers `manager.isTesting()` (and `Manager.isTesting()` static) — the cross-context helper everything in EM checks when it needs to behave differently in tests:

- `auto-updater` flips its idle threshold from 15min → 3s and its periodic tick from 60s → 500ms, AND short-circuits the native install-prompt dialog (so tests don't pop modal windows).
- **Every BrowserWindow surfaces stealth** — named windows via `window-manager._surface()` AND raw `new BrowserWindow()` ones (e.g. a consumer's automation popup) via a global `browser-window-created` hook registered in `main.js` step 1a-ii. The shared recipe lives in `src/utils/stealth-window.js`: shown INACTIVE (keyboard focus never leaves your editor), opacity 0, click-through (`setIgnoreMouseEvents`), and raw windows get `show()` rerouted to `showInactive()` + `focus()` no-op'd — a test run never interrupts you, and a stray real click physically can't land in the app, while synthetic test input (`executeJavaScript`, `sendInputEvent`, CDP) is unaffected. Set **`EM_TEST_SHOW=1`** to surface windows normally and watch a run live (the predicate is evaluated per window, so flipping it mid-run works). Deliberately NOT `hide()`/`minimize()`: occluded windows get throttled by Chromium (`requestAnimationFrame` pauses, `document.visibilityState` flips to `hidden`) — tests would exercise a DIFFERENT runtime, whereas an opacity-0 shown-inactive window renders and behaves identically to a visible one. See [windows.md](windows.md).
- **App-level activation is suppressed too (macOS).** Launching a regular-policy app activates it — the menu bar and keyboard focus switch to the test process at launch even though every window surfaces inactive. Under the same stealth predicate (`src/utils/test-stealth.js` — Testing mode + `EM_TEST_SHOW` unset), `main.js` (step 1a, before app ready) and the spawned test harness flip the app to the **accessory activation policy** (`app.dock.hide()` — the same switch `LSUIElement` bakes for packaged hidden-mode apps): the process never activates, never shows a dock icon, and never steals focus, while windows still render identically. `EM_TEST_SHOW=1` restores normal activation along with visible windows. Verified by frontmost-app sampling across a full run: zero focus changes (previously four steals per run).
- `main.js#initialize` isolates userData per environment: testing runs get `<userData> (Testing)` — **wiped at boot**, so every test run starts from a clean slate (post-run state stays on disk for inspection until the next run; set `EM_TEST_KEEP_USERDATA=1` to skip the wipe). Dev runs get ` (Development)`; production is untouched. See [boot-sequence.md](boot-sequence.md).
- **The main-layer harness exposes a CDP endpoint.** `test/harness/main-entry.js` appends `--remote-debugging-port=0` at require time (loopback-only, OS-assigned port) and publishes the resolved port as **`process.env.EM_CDP_PORT`** before suites run (read from Chromium's `DevToolsActivePort` file; any value inherited from your shell is overwritten — that one points at your dev app, not the harness). Consumer suites can drive real browser automation against the harness Electron itself, e.g. `playwright-core`'s `connectOverCDP('http://127.0.0.1:' + process.env.EM_CDP_PORT)`. Covered by `suites/main/harness-cdp.test.js`.
- Other lib code can branch on `manager.isTesting()` to suppress dock bounce, login-item changes, OS protocol-handler registration, etc.

Consumers writing their own tests should set `EM_TEST_MODE=true` in their test runner so the same signal applies — for example, in `package.json`:
```json
"test": "EM_TEST_MODE=true vitest"
```
Then in your code, gate test-only behavior on `manager.isTesting()` instead of inventing yet another env var.

## Test discovery

- **Framework defaults**: `<EM>/dist/test/suites/**/*.js`
- **Consumer suites**: `<cwd>/test/**/*.js`

**The underscore convention** (`DISCOVERY_IGNORE` in `src/test/runner.js`): `_`-prefixed FILES (`test/_init.js`, `test/main/_helper.js`) and everything under a `_`-prefixed DIRECTORY at **any depth** (`test/_fixtures/**`, `test/boot/_private/**`) are excluded from suite discovery. Put shared helpers and fixture trees (including fixture packages that contain their own `.js` files) in `test/_fixtures/` and `require()` them from suites. Files load alphabetically (sorted globally per source).

**Framework boot suites are scoped to EM self-test runs only.** When a consumer runs `npx mgr test`, the framework's `dist/test/suites/boot/**` is excluded from discovery — those tests are meant to assert on EM's own internal fixtures and would fail noisily against a real consumer app. Detection: the runner checks `cwd`'s `package.json#name === 'electron-manager'`. Consumers write their own boot tests under `<cwd>/test/boot/`. Matches the same exclusion pattern in BXM and UJM. See [test-boot-layer.md](test-boot-layer.md).

## `test/_init.js` — pre-test lifecycle hook

The runner loads an optional `test/_init.js` from **both** test roots — the framework (`<EM>/test/_init.js`) and the consumer project (`<cwd>/test/_init.js`) — and runs it **once, before any suite** (it is NOT itself run as a test; the `_`-prefix keeps it out of discovery). Mirrors the same hook in BEM/UJM/BXM so all four frameworks share one shape.

The module **must export a function** — `module.exports = (ctx) => ({ ... })` — called with `{ projectRoot }` and returning the hook object. It may declare:

- `async setup({ projectRoot })` — runs once before the suites, e.g. to scaffold a fixture file the boot layer needs.

There is **no `cleanup` hook** and **no `accounts` field** (unlike BEM — these frameworks have no auth/user system): tests clean up after themselves, so there is nothing project-level to tear down.

```javascript
// <cwd>/test/_init.js
const fs = require('fs');
const path = require('path');

module.exports = ({ projectRoot }) => ({
  async setup() {
    // Seed any fixture a suite needs before it runs.
    fs.mkdirSync(path.join(projectRoot, '.temp'), { recursive: true });
  },
});
```

## Test file shapes

Three forms — pick whichever fits.

### Suite (sequential, share state, stop on first failure)

```js
module.exports = {
  type: 'suite',
  layer: 'main',                    // 'build' | 'main' | 'renderer'
  description: 'storage (main)',
  cleanup: async (ctx) => {         // runs after the last test
    ctx.manager.storage.clear();
  },
  tests: [
    {
      name: 'set + get round-trip',
      run: (ctx) => {
        ctx.manager.storage.set('hello', 'world');
        ctx.expect(ctx.manager.storage.get('hello')).toBe('world');
      },
    },
    {
      name: 'has reflects presence',
      run: (ctx) => { /* ... */ },
      cleanup: (ctx) => { /* ... */ },     // per-test cleanup
      skip: 'reason',                       // skip this test
    },
  ],
};
```

Tests share `ctx.state` across the suite. If one fails, remaining tests are skipped (`stopOnFailure: false` to disable).

### Group (parallel-ish, share state, run all regardless of failures)

```js
module.exports = {
  type: 'group',
  layer: 'main',
  description: 'boot sequence (main)',
  tests: [ /* same shape as suite */ ],
};
```

Same shape as suite, but all tests run even if some fail.

### Standalone (single test per file)

```js
module.exports = {
  layer: 'build',
  description: 'CLI alias resolves to a command file',
  run: (ctx) => { /* ... */ },
  cleanup: (ctx) => { /* ... */ },
  timeout: 10000,
  skip: false,
};
```

### Array shorthand (group of tests, no metadata)

```js
module.exports = [
  { name: 'A', run: (ctx) => { /* ... */ } },
  { name: 'B', run: (ctx) => { /* ... */ } },
];
```

## Layers

| Layer | Where it runs | Use for |
|---|---|---|
| `build` | Plain Node | CLI, package.json, config schema, gulp tasks |
| `main` | Spawned Electron main process | Manager init, lib modules, IPC, windows |
| `renderer` | Hidden BrowserWindow (not yet implemented — Pass 2.3c) | `window.em.*`, preload bridge, UI logic |

The runner partitions test files by layer at discovery time. The build layer runs inline; the main layer spawns Electron once with all main suites and parses JSON-line stdout.

## ctx (context object)

Every test fn receives a `ctx`:

```js
ctx.expect(actual)          // Jest-compatible expect()
ctx.state                   // shared object across tests in a suite/group
ctx.layer                   // 'build' | 'main' | 'renderer'
ctx.skip(reason)            // skip from inside the test
ctx.manager                 // (main layer only) the booted EM Manager
```

## expect() matchers

Jest-compatible subset:

```js
.toBe(expected)              // ===
.toEqual(expected)           // deep equal
.toBeTruthy() / .toBeFalsy()
.toBeDefined() / .toBeUndefined() / .toBeNull()
.toContain(item)             // array.includes / string.includes
.toHaveProperty(key)
.toMatch(regex)
.toBeInstanceOf(class)
.toBeGreaterThan(n) / .toBeLessThan(n)
.toThrow(regex|string)       // also accepts async fns

.not.<anything>              // negate any matcher
```

## Output

```
  Electron Manager Tests

  Framework Tests
    ⤷ storage (main)
      ✓ set + get round-trip (7ms)
      ✓ has reflects presence (8ms)
      ...

  Results
    149 passing

    Total: 149 tests in 1850ms
```

All test output is also teed (ANSI-stripped) to `<projectRoot>/logs/test.log`, truncated fresh on each run — same pattern as `dev.log` (and BEM's `test.log`). Grep it after a run instead of scrolling terminal output.

## Test harness internals (main layer)

- `runners/electron.js` spawns Electron with `harness/main-entry.js` as the app.
- `harness/main-entry.js` boots Manager with `skipWindowCreation: true`, runs the suites, emits results via `__EM_TEST__{json}\n` lines on stdout.
- The runner parses those lines and renders BEM-style output.
- stderr is always drained (otherwise the pipe fills and the harness blocks); printed only when `EM_TEST_DEBUG=1`.
- `ELECTRON_RUN_AS_NODE` is stripped from the spawn env (would otherwise make Electron behave as Node and break the harness).

## Writing consumer tests

In a consumer project, drop files in `test/` (or `test/**`):

```js
// test/login-flow.test.js
module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'login flow',
  tests: [
    {
      name: 'storage starts empty',
      run: (ctx) => {
        ctx.expect(ctx.manager.storage.get('user')).toBeUndefined();
      },
    },
  ],
};
```

`npx mgr test` runs framework defaults + your project suites.
