// Renderer-layer suite — asserts the `window.em` surface exposed by preload is shaped
// correctly and that the storage proxy round-trips through IPC into the main store.
//
// Runs inside a hidden BrowserWindow spawned by the test harness. The renderer harness
// reconstructs each `run` function via `new Function('ctx', body)` so the function bodies
// here can only reference `ctx` and `window` — no closures over module scope.

module.exports = {
  type: 'suite',
  layer: 'renderer',
  description: 'window.em surface + storage proxy roundtrip',
  tests: [
    {
      name: 'window.em is exposed and is an object',
      run: (ctx) => {
        ctx.expect(typeof window.em).toBe('object');
        ctx.expect(window.em).toBeTruthy();
      },
    },
    {
      name: 'window.em.ipc has invoke / on / send',
      run: (ctx) => {
        ctx.expect(typeof window.em.ipc.invoke).toBe('function');
        ctx.expect(typeof window.em.ipc.on).toBe('function');
        ctx.expect(typeof window.em.ipc.send).toBe('function');
      },
    },
    {
      name: 'window.em.storage has get / set / delete / has / clear',
      run: (ctx) => {
        ctx.expect(typeof window.em.storage.get).toBe('function');
        ctx.expect(typeof window.em.storage.set).toBe('function');
        ctx.expect(typeof window.em.storage.delete).toBe('function');
        ctx.expect(typeof window.em.storage.has).toBe('function');
        ctx.expect(typeof window.em.storage.clear).toBe('function');
      },
    },
    {
      name: 'window.em.logger has log / warn / error',
      run: (ctx) => {
        ctx.expect(typeof window.em.logger.log).toBe('function');
        ctx.expect(typeof window.em.logger.warn).toBe('function');
        ctx.expect(typeof window.em.logger.error).toBe('function');
      },
    },
    {
      name: 'window.em.autoUpdater has getStatus / checkNow / installNow',
      run: (ctx) => {
        ctx.expect(typeof window.em.autoUpdater.getStatus).toBe('function');
        ctx.expect(typeof window.em.autoUpdater.checkNow).toBe('function');
        ctx.expect(typeof window.em.autoUpdater.installNow).toBe('function');
      },
    },
    {
      name: 'storage.set + storage.get round-trips through IPC',
      run: async (ctx) => {
        const key = '__em_renderer_test_value';
        await window.em.storage.set(key, { hello: 'world', n: 42 });
        const value = await window.em.storage.get(key);
        ctx.expect(value).toEqual({ hello: 'world', n: 42 });
        await window.em.storage.delete(key);
      },
    },
    {
      name: 'storage.has reports correctly',
      run: async (ctx) => {
        const key = '__em_renderer_has_test';
        await window.em.storage.set(key, 'x');
        const yes = await window.em.storage.has(key);
        ctx.expect(yes).toBe(true);
        await window.em.storage.delete(key);
        const no = await window.em.storage.has(key);
        ctx.expect(no).toBe(false);
      },
    },
    {
      name: 'storage.delete removes the key',
      run: async (ctx) => {
        const key = '__em_renderer_delete_test';
        await window.em.storage.set(key, 'gone');
        await window.em.storage.delete(key);
        const value = await window.em.storage.get(key, 'fallback');
        ctx.expect(value).toBe('fallback');
      },
    },
    {
      name: 'autoUpdater.getStatus returns a status object',
      run: async (ctx) => {
        const status = await window.em.autoUpdater.getStatus();
        ctx.expect(status).toBeDefined();
        ctx.expect(typeof status.code).toBe('string');
      },
    },
  ],
};
