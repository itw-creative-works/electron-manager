// Main-process tests for lib/ipc.js — handler registry, invoke roundtrip,
// listener subscribe/unsubscribe, broadcast safety, error propagation.
//
// We test the main-side surface directly. Renderer-side wiring (preload contextBridge,
// ipcRenderer.invoke) is exercised in pass 2.3c when the renderer harness lands.

const TEST_CHANNEL = 'em:test:echo';
const TEST_LISTEN  = 'em:test:event';

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'ipc (main)',
  cleanup: (ctx) => {
    // Always tear down the test channels so suites don't bleed into each other.
    if (ctx.manager.ipc.hasHandler(TEST_CHANNEL)) {
      ctx.manager.ipc.unhandle(TEST_CHANNEL);
    }
    // Best-effort: drain test listeners.
    while (ctx.manager.ipc.listenerCount(TEST_LISTEN) > 0) {
      // off() needs the original fn; nothing left to remove if our local refs are gone.
      // The listenerCount === 0 guard in off() will leave the registry clean once tests unsubscribe themselves.
      break;
    }
  },
  tests: [
    {
      name: 'initialized after boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.ipc._initialized).toBe(true);
      },
    },
    {
      name: 'storage handlers are registered on the ipc bus',
      run: (ctx) => {
        ctx.expect(ctx.manager.ipc.hasHandler('em:storage:get')).toBe(true);
        ctx.expect(ctx.manager.ipc.hasHandler('em:storage:set')).toBe(true);
        ctx.expect(ctx.manager.ipc.hasHandler('em:storage:delete')).toBe(true);
        ctx.expect(ctx.manager.ipc.hasHandler('em:storage:has')).toBe(true);
        ctx.expect(ctx.manager.ipc.hasHandler('em:storage:clear')).toBe(true);
      },
    },
    {
      name: 'handle + invoke round-trip',
      run: async (ctx) => {
        ctx.manager.ipc.handle(TEST_CHANNEL, (payload) => {
          return { echoed: payload.value };
        });
        const result = await ctx.manager.ipc.invoke(TEST_CHANNEL, { value: 42 });
        ctx.expect(result).toEqual({ echoed: 42 });
      },
    },
    {
      name: 'handle throws on duplicate registration',
      run: (ctx) => {
        // The previous test left TEST_CHANNEL registered.
        ctx.expect(() => {
          ctx.manager.ipc.handle(TEST_CHANNEL, () => 'dup');
        }).toThrow(/already has a handler/);
      },
    },
    {
      name: 'unhandle removes the handler',
      run: (ctx) => {
        ctx.manager.ipc.unhandle(TEST_CHANNEL);
        ctx.expect(ctx.manager.ipc.hasHandler(TEST_CHANNEL)).toBe(false);
      },
    },
    {
      name: 'invoke without a handler rejects',
      run: async (ctx) => {
        let err;
        try {
          await ctx.manager.ipc.invoke(TEST_CHANNEL, {});
        } catch (e) {
          err = e;
        }
        ctx.expect(err).toBeDefined();
        ctx.expect(err.message).toMatch(/no handler registered/);
      },
    },
    {
      name: 'handler errors propagate through invoke',
      run: async (ctx) => {
        ctx.manager.ipc.handle(TEST_CHANNEL, () => {
          throw new Error('boom');
        });
        let err;
        try {
          await ctx.manager.ipc.invoke(TEST_CHANNEL, {});
        } catch (e) {
          err = e;
        }
        ctx.expect(err).toBeDefined();
        ctx.expect(err.message).toBe('boom');
        ctx.manager.ipc.unhandle(TEST_CHANNEL);
      },
    },
    {
      name: 'on registers a listener and returns an unsubscribe fn',
      run: (ctx) => {
        const fn = () => {};
        const off = ctx.manager.ipc.on(TEST_LISTEN, fn);
        ctx.expect(ctx.manager.ipc.listenerCount(TEST_LISTEN)).toBe(1);
        off();
        ctx.expect(ctx.manager.ipc.listenerCount(TEST_LISTEN)).toBe(0);
      },
    },
    {
      name: 'multiple listeners on the same channel',
      run: (ctx) => {
        const a = () => {};
        const b = () => {};
        const offA = ctx.manager.ipc.on(TEST_LISTEN, a);
        const offB = ctx.manager.ipc.on(TEST_LISTEN, b);
        ctx.expect(ctx.manager.ipc.listenerCount(TEST_LISTEN)).toBe(2);
        offA();
        ctx.expect(ctx.manager.ipc.listenerCount(TEST_LISTEN)).toBe(1);
        offB();
        ctx.expect(ctx.manager.ipc.listenerCount(TEST_LISTEN)).toBe(0);
      },
    },
    {
      name: 'broadcast with no windows is a safe no-op',
      run: (ctx) => {
        // Test harness runs with skipWindowCreation: true — no BrowserWindows exist.
        // This must not throw.
        ctx.manager.ipc.broadcast('em:test:broadcast', { hello: 'world' });
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'send to a destroyed/null webContents is a safe no-op',
      run: (ctx) => {
        ctx.manager.ipc.send(null, 'em:test:send', {});
        ctx.manager.ipc.send({ isDestroyed: () => true }, 'em:test:send', {});
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'storage.set triggers ipc broadcast (no throw with zero renderers)',
      run: (ctx) => {
        // storage._broadcast routes through ipc.broadcast — confirm it runs cleanly here.
        ctx.manager.storage.set('ipc-broadcast-probe', 1);
        ctx.expect(ctx.manager.storage.get('ipc-broadcast-probe')).toBe(1);
        ctx.manager.storage.delete('ipc-broadcast-probe');
      },
    },
    {
      name: 'handle rejects non-string channel',
      run: (ctx) => {
        ctx.expect(() => ctx.manager.ipc.handle('', () => {})).toThrow(/non-empty string/);
        ctx.expect(() => ctx.manager.ipc.handle(null, () => {})).toThrow(/non-empty string/);
      },
    },
    {
      name: 'handle rejects non-function handler',
      run: (ctx) => {
        ctx.expect(() => ctx.manager.ipc.handle('em:test:bad', null)).toThrow(/handler must be a function/);
      },
    },
  ],
};
