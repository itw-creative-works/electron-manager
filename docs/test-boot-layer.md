# Test Framework — Boot Layer

The `boot` test layer runs against the **consumer's actual built `dist/main.bundle.js`** — the real production main entry, exactly as `electron .` would load it. Replaces shell-level `npm start && sleep 12 && kill` smoke tests with deterministic, signal-driven pass/fail.

## When to use it

| Layer | What it tests | Speed |
|---|---|---|
| `build` | Plain Node — config parsing, util fns, schema validation. | Fast (ms) |
| `main` | EM lib code in isolation (storage, ipc, tray, etc.) inside Electron. | Fast (~50ms each) |
| `renderer` | Inside a hidden BrowserWindow. | Fast |
| `boot` | The **whole boot integration** — consumer's main.js → manager.initialize → live state | ~1s startup, then fast |

Use `boot` for tests that need to verify **integration** rather than unit behavior:
- "Does the consumer's `src/main.js` actually wire up correctly?"
- "Did all 13 boot steps complete without throwing?"
- "Did config flow from JSON5 → manager.config → tray titles?"
- "Did `src/integrations/{tray,menu,context-menu}/index.js` load?"
- "Is the menu rendered with the expected default ids?"

## Test shape

```js
// test/boot.test.js (consumer-side)
module.exports = {
  type:        'group',
  layer:       'boot',
  description: 'consumer boot smoke',
  timeout:     20000,
  tests: [
    {
      description: 'manager initialized end-to-end',
      inspect: async ({ manager, expect, projectRoot }) => {
        expect(manager._initialized).toBe(true);
        expect(manager.config).toBeTruthy();
      },
    },
    {
      description: 'tray + menu rendered',
      inspect: async ({ manager, expect }) => {
        expect(manager.tray.has('open')).toBe(true);
        expect(manager.menu.isRendered()).toBe(true);
      },
    },
  ],
};
```

The `inspect` function receives:
| Arg | Description |
|---|---|
| `manager` | The fully-initialized live Manager instance — same one your consumer code uses. |
| `expect` | EM's [Jest-compatible assertion library](../src/test/assert.js). |
| `projectRoot` | Absolute path to the consumer project root. |

## How it works

1. Test runner discovers `test/**/*.js` files with `layer: 'boot'`.
2. Aggregates each test's `inspect` source body into a JSON spec file.
3. Spawns a real Electron process: `electron <projectRoot>` — same as `npm start` does.
4. Sets three env vars before spawn:
   - `EM_TEST_BOOT=1` — gate
   - `EM_TEST_BOOT_HARNESS=<absolute path to dist/test/harness/boot-entry.js>`
   - `EM_TEST_BOOT_SPEC=<temp file with test definitions>`
5. EM's `main.js` boots normally; after `manager.initialize()` resolves, detects `EM_TEST_BOOT=1`, reconstitutes each `inspect` from its serialized body string, runs them sequentially, and emits `__EM_TEST__` JSON lines on stdout.
6. Test runner parses results, calls `app.exit()`. **No sleep, no kill.**

## Running

```bash
# All layers including boot
npx mgr test

# Boot only
npx mgr test --layer boot

# With debug output (shows electron's stderr + harness internals)
EM_TEST_DEBUG=1 npx mgr test --layer boot
```

## Prerequisites

Boot tests run against `dist/main.bundle.js`. **The runner always rebuilds it first** (via the same gulp pipeline `npm run build` uses) so tests never see stale code. Adds ~10s to the boot-test run; correctness over speed.

Opt out for CI scenarios where build already ran in a separate step:

```bash
EM_TEST_SKIP_BUILD=1 npx mgr test --layer boot
```

When `EM_TEST_SKIP_BUILD=1` is set and the bundle is missing, boot tests are skipped with a warning instead of running against nothing.

## Self-test from the framework repo (the bundled fixture)

Everything above describes a **consumer** running boot tests against their own `dist/main.bundle.js`. EM also boot-tests *itself* — the same way BXM verifies "does the extension load?" and UJM verifies "does the site boot?".

When `npx mgr test` runs from the electron-manager repo (the cwd's `package.json` name is `electron-manager`), two complementary mechanisms engage:

- **`isFrameworkSelfTest`** (in [src/test/runner.js](../src/test/runner.js)) — test discovery includes the framework's own `boot/**` suites. For a real consumer this flag is false and framework `boot/**` suites are **excluded** (they target EM's fixture, not the consumer's app), so they never run in a consumer's `npx mgr test`.
- **`EM_TEST_BOOT_PROJECT`** — [src/commands/test.js](../src/commands/test.js) points the boot runner at the bundled fixture under `src/test/fixtures/consumer-app/` instead of the cwd.

The gate decides *whether* the framework boot suite runs; the env var decides *which project* gets booted. (BEM's `BEM_TEST_BOOT_PROJECT`, BXM's `BXM_TEST_BOOT_PROJECT`, and UJM's `UJ_TEST_BOOT_PROJECT` are the exact analogs.)

### The bundled fixture

`src/test/fixtures/consumer-app/` — a minimal, committed EM consumer (source only):

- `config/electron-manager.json` — fake brand (`em-fixture`), `releases.enabled: false` (no repo discovery during the build), empty `firebaseConfig` (no Firebase hang).
- `src/main.js` / `src/preload.js` — the one-line bootstraps a real consumer ships; `main.js` creates the `main` window (`show: false`).
- `src/views/main/index.html` + `src/assets/js/components/main/index.js` + `src/assets/scss/main.scss` — a real view/renderer/theme so webpack + sass run exactly as for a consumer.

**Runtime-only, gitignored** (never committed): before the boot build, the runner symlinks `electron-manager` (→ the EM repo root) and `electron` (→ EM's own copy) into the fixture's `node_modules` — the only two deps resolved by *explicit path* (the gulpfile location, webpack's `require('electron-manager/main')`, and the runner's electron-binary lookup). Everything else (gulp, electron-store, …) resolves via the upward `node_modules` walk because the fixture lives inside the EM repo. The links are **removed again when the run finishes** — the `electron-manager` link points back at the repo root, which *contains* the fixture, so a leftover link forms an infinite directory cycle inside `dist/` that crashes the next prepare-package tree walk (`npm run prepare` / `npm publish` → `ENAMETOOLONG`). The fixture `.gitignore` is belt-and-suspenders for crashed runs. See `ensureFixtureDeps()` / `removeFixtureDeps()` in [src/test/runners/boot.js](../src/test/runners/boot.js).

The fixture is then **webpack-built into a real `dist/main.bundle.js`** and booted — the same production path a consumer's boot test exercises (bundled, not the unbundled lib code the `main` layer covers). The boot smoke lives at [src/test/suites/boot/consumer-app-boots.test.js](../src/test/suites/boot/consumer-app-boots.test.js).

### `EM_TEST_BOOT_PROJECT`

| Env | Purpose |
|---|---|
| `EM_TEST_BOOT_PROJECT` | Root of a project to boot instead of the cwd. Auto-set to `src/test/fixtures/consumer-app` when EM tests itself; set it explicitly to boot a **real consumer** (e.g. `deployment-playground-desktop`) without `cd`-ing into it. |

### Why this exists

The `build`/`main`/`renderer` layers cover EM's lib code fast and in isolation. None of them prove the framework still assembles a consumer's `src/main.js` into a webpacked bundle that boots end-to-end. The fixture self-test fills that gap — EM's analog of "does the extension load?" (BXM) / "does the site boot?" (UJM).

## Limitations

- Tests run sequentially in a single Electron process to amortize startup cost (~1s). State doesn't carry across tests — they all share one `manager` instance.
- `inspect` function bodies are serialized via `Function.prototype.toString` and reconstituted with `new Function(...)`. Closures over the test file's outer scope **don't survive** — only the `inspect` argument bag is available inside.
- We can't simulate user input (clicking the tray, right-clicking, typing). For that, you'd need `nut-js` or similar — out of scope.
