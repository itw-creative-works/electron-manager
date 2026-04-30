// Main-process tests for lib/storage.js — round-trip, dot-notation, persistence, broadcast.
//
// ctx.manager is a fully-initialized EM Manager (skipWindowCreation: true).

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'storage (main)',
  cleanup: async (ctx) => {
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
      name: 'get returns default when missing',
      run: (ctx) => {
        ctx.expect(ctx.manager.storage.get('nope', 'fallback')).toBe('fallback');
        ctx.expect(ctx.manager.storage.get('nope')).toBeUndefined();
      },
    },
    {
      name: 'has reflects presence',
      run: (ctx) => {
        ctx.manager.storage.set('present', 1);
        ctx.expect(ctx.manager.storage.has('present')).toBe(true);
        ctx.expect(ctx.manager.storage.has('absent')).toBe(false);
      },
    },
    {
      name: 'delete removes the key',
      run: (ctx) => {
        ctx.manager.storage.set('temp', 'x');
        ctx.manager.storage.delete('temp');
        ctx.expect(ctx.manager.storage.has('temp')).toBe(false);
      },
    },
    {
      name: 'dot-notation nested paths',
      run: (ctx) => {
        ctx.manager.storage.set('window.main.bounds', { x: 10, y: 20, w: 800, h: 600 });
        ctx.expect(ctx.manager.storage.get('window.main.bounds')).toEqual({ x: 10, y: 20, w: 800, h: 600 });
        ctx.expect(ctx.manager.storage.get('window.main.bounds.w')).toBe(800);
      },
    },
    {
      name: 'onChange fires for the watched key',
      run: async (ctx) => {
        const calls = [];
        const unsub = ctx.manager.storage.onChange('watched', (value, previous) => {
          calls.push({ value, previous });
        });
        ctx.manager.storage.set('watched', 'first');
        ctx.manager.storage.set('watched', 'second');
        unsub();
        ctx.manager.storage.set('watched', 'third'); // should NOT fire after unsub
        ctx.expect(calls.length).toBe(2);
        ctx.expect(calls[0].value).toBe('first');
        ctx.expect(calls[1].value).toBe('second');
        ctx.expect(calls[1].previous).toBe('first');
      },
    },
    {
      name: 'clear empties the store',
      run: (ctx) => {
        ctx.manager.storage.set('a', 1);
        ctx.manager.storage.set('b', 2);
        ctx.manager.storage.clear();
        ctx.expect(ctx.manager.storage.has('a')).toBe(false);
        ctx.expect(ctx.manager.storage.has('b')).toBe(false);
      },
    },
    {
      name: 'getPath returns the on-disk file location',
      run: (ctx) => {
        const p = ctx.manager.storage.getPath();
        ctx.expect(typeof p).toBe('string');
        ctx.expect(p).toMatch(/em-storage\.json$/);
      },
    },
  ],
};
