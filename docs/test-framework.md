# Test Framework

Built-in test framework for both EM itself and consumer projects. Jest-like assertion syntax (`expect(actual).toBe(expected)`), three layers, BEM-style output.

## Running tests

```bash
npx mgr test                          # consumer: runs framework + project suites
npx mgr test --layer=main             # only main-process suites (also: build, renderer, all)
npx mgr test --filter="storage"       # only suites/tests whose name contains "storage"
npx mgr test --integration            # opt in to integration suites (Firebase, etc.)
npx mgr test --reporter=json          # pretty output + machine-readable {"event":"summary",...} line
EM_TEST_DEBUG=1 npx mgr test          # see Electron stderr (otherwise drained silently)
```

In EM itself, `npm test` does the same.

### Layers

- **build** — runs in plain Node. Fast.
- **main**  — spawns Electron and runs inside the main process. Required for anything touching `app`/`ipcMain`/`BrowserWindow`.
- **renderer** — runs inside a hidden `BrowserWindow` spawned by the main harness. Test functions are serialized + reconstructed via `new Function('ctx', body)`, so they only have access to `ctx` and the page's globals (`window`, `document`, `window.em.*`). No closures over module scope.
- **all** (default) — build, then main, then renderer in a single Electron boot.

### Integration vs unit

Suites that hit a live backend (Firebase Auth admin SDK, real GitHub API, etc.) are gated behind `--integration` (or `EM_TEST_INTEGRATION=1`). Default is to skip them so `npx mgr test` is fast + green offline. The CI workflow runs unit tests only by default; add a separate workflow to flip the flag for integration coverage.

## Test discovery

- **Framework defaults**: `<EM>/dist/test/suites/**/*.js`
- **Consumer suites**: `<cwd>/test/**/*.js`

Files in directories starting with `_` are ignored. Files load alphabetically (sorted globally per source).

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
