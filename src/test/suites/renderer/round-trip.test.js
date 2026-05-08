// Renderer-layer round-trip tests. The window-em-surface suite asserts the SHAPE
// of `window.em.*` (functions exist). This suite asserts the BEHAVIOR — that calls
// from a real renderer process land in main, get processed, and the response or
// side-effect comes back correctly.
//
// Test bodies run inside a BrowserWindow with only `ctx` and `window` in scope —
// no closures, no require. The main harness pre-registered a couple of test-only
// IPC channels (em:__test:echo, em:__test:read-last-log) for these tests to use.

module.exports = {
  type: 'suite',
  layer: 'renderer',
  description: 'renderer ⇄ main round-trip',
  tests: [
    {
      name: 'window.em.ipc.invoke: renderer → main → response',
      run: async (ctx) => {
        // Main registered the em:__test:echo channel — call it via the bridged ipc.
        const result = await window.em.ipc.invoke('em:__test:echo', { hello: 'from-renderer', n: 7 });
        ctx.expect(result).toBeDefined();
        ctx.expect(result.echoed).toEqual({ hello: 'from-renderer', n: 7 });
        ctx.expect(typeof result.ts).toBe('number');
      },
    },
    {
      name: 'window.em.ipc.invoke: unhandled channel rejects',
      run: async (ctx) => {
        let threw;
        try {
          await window.em.ipc.invoke('em:__test:does-not-exist');
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
      },
    },
    {
      name: 'window.em.logger.log forwards to main where it can be read back',
      run: async (ctx) => {
        const marker = `__em_test_log_${Date.now()}_${Math.random()}`;
        window.em.logger.log(marker, { extra: 'payload' });
        // Give main a moment to receive (IPC send is async, no callback).
        await new Promise((r) => setTimeout(r, 50));
        const last = await window.em.ipc.invoke('em:__test:read-last-log');
        ctx.expect(last).toBeDefined();
        // The forwarded payload shape is `{ scope, level, args }` — verify our
        // marker appears in the args. Don't tie to exact shape since the forwarder
        // serializes via JSON for cloneability.
        const serialized = JSON.stringify(last);
        ctx.expect(serialized).toContain(marker);
      },
    },
    {
      name: 'window.em.logger.warn also forwards',
      run: async (ctx) => {
        const marker = `__em_test_warn_${Date.now()}_${Math.random()}`;
        window.em.logger.warn(marker);
        await new Promise((r) => setTimeout(r, 50));
        const last = await window.em.ipc.invoke('em:__test:read-last-log');
        const serialized = JSON.stringify(last);
        ctx.expect(serialized).toContain(marker);
      },
    },
    {
      name: 'window.em.storage.set → window.em.storage.onChange fires across IPC',
      run: async (ctx) => {
        // Subscribe FIRST so we don't miss the broadcast.
        const key = `__em_renderer_change_${Date.now()}`;
        let received = null;
        const off = window.em.storage.onChange(key, (payload) => { received = payload; });
        try {
          await window.em.storage.set(key, { changed: true });
          // Allow the broadcast to round-trip back.
          for (let i = 0; i < 20 && !received; i++) {
            await new Promise((r) => setTimeout(r, 50));
          }
          ctx.expect(received).toBeDefined();
          ctx.expect(received.key).toBe(key);
        } finally {
          off?.();
          await window.em.storage.delete(key);
        }
      },
    },
    {
      name: 'window.em.autoUpdater.getStatus round-trips main state',
      run: async (ctx) => {
        const status = await window.em.autoUpdater.getStatus();
        ctx.expect(status).toBeDefined();
        ctx.expect(['idle', 'checking', 'available', 'downloading', 'downloaded', 'not-available', 'error'])
          .toContain(status.code);
      },
    },
    {
      name: 'window.em.autoUpdater.onStatus subscribes (returns unsub fn)',
      run: (ctx) => {
        // The status broadcasts from main are best-effort — outside dev-simulation mode
        // the auto-updater may not transition during the test window. Just verify the
        // subscription API works (returns an unsub function) — dev-simulation flow is
        // exercised separately in main-layer auto-updater.test.js.
        const off = window.em.autoUpdater.onStatus(() => {});
        ctx.expect(typeof off).toBe('function');
        off();
      },
    },
  ],
};
