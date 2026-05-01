# Boot Test Layer

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

## Limitations

- Tests run sequentially in a single Electron process to amortize startup cost (~1s). State doesn't carry across tests — they all share one `manager` instance.
- `inspect` function bodies are serialized via `Function.prototype.toString` and reconstituted with `new Function(...)`. Closures over the test file's outer scope **don't survive** — only the `inspect` argument bag is available inside.
- We can't simulate user input (clicking the tray, right-clicking, typing). For that, you'd need `nut-js` or similar — out of scope.
