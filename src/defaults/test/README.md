# Project tests

Drop your project test suites here. The framework auto-runs them alongside its own when you run `npx mgr test`.

## Layers

Match the framework's four layers — Electron Manager's test runner discovers files by the directory they sit in:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node | Build-time logic, config validation, pure utilities |
| `test/main/` | Spawned Electron main process | IPC, storage, windows, anything that needs `app.*` |
| `test/renderer/` | Hidden BrowserWindow | Renderer-side logic, DOM, preload bridge |
| `test/boot/` | Consumer's actual built bundle | End-to-end smoke tests (does the app boot, does main show a window, do IPC handlers register) |

## Quick example

```js
// test/build/my-feature.test.js
const assert = require('electron-manager/test/assert');

module.exports = {
  'my feature does the thing': async () => {
    const result = await doTheThing();
    assert.equal(result, 'expected');
  },
};
```

## See also

`node_modules/electron-manager/docs/test-framework.md` — full reference for the test framework (layers, assert API, fixtures, runner internals).
