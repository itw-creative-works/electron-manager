// Build-layer tests for lib/_menu-mixin.js — the shared id-path utility used by
// tray, menu, and context-menu. These run in plain Node (no Electron) so we test
// the algorithms directly without booting the framework.

const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const mixin = require(path.join(root, 'dist', 'lib', '_menu-mixin.js'));

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'menu-mixin (id-path utilities)',
  tests: [
    {
      name: 'findItem: full-id match anywhere in the tree',
      run: (ctx) => {
        const items = [
          { id: 'main', submenu: [
            { id: 'main/check-for-updates', label: 'Updates' },
            { id: 'main/quit', label: 'Quit' },
          ]},
        ];
        ctx.expect(mixin.findItem(items, 'main/check-for-updates').label).toBe('Updates');
        ctx.expect(mixin.findItem(items, 'main/quit').label).toBe('Quit');
        ctx.expect(mixin.findItem(items, 'main')).toBeTruthy();
      },
    },
    {
      name: 'findItem: walks segments when full-id misses',
      run: (ctx) => {
        // No item is tagged with 'main/preferences', but the structure has 'main' → 'preferences'.
        const items = [
          { id: 'main', submenu: [
            { id: 'preferences', label: 'Prefs' },
          ]},
        ];
        ctx.expect(mixin.findItem(items, 'main/preferences').label).toBe('Prefs');
      },
    },
    {
      name: 'findItem: returns null for missing path',
      run: (ctx) => {
        ctx.expect(mixin.findItem([], 'foo')).toBe(null);
        ctx.expect(mixin.findItem([{ id: 'a' }], 'b')).toBe(null);
        ctx.expect(mixin.findItem([{ id: 'a' }], 'a/b')).toBe(null);
      },
    },
    {
      name: 'insertRelative: before & after',
      run: (ctx) => {
        const items = [
          { id: 'a' },
          { id: 'b' },
          { id: 'c' },
        ];
        mixin.insertRelative(items, 'b', { id: 'before-b' }, 'before');
        mixin.insertRelative(items, 'b', { id: 'after-b' }, 'after');
        const ids = items.map((i) => i.id);
        ctx.expect(ids).toEqual(['a', 'before-b', 'b', 'after-b', 'c']);
      },
    },
    {
      name: 'appendInside: pushes into a submenu, creating it if absent',
      run: (ctx) => {
        const items = [{ id: 'parent' }];
        const ok = mixin.appendInside(items, 'parent', { id: 'child' });
        ctx.expect(ok).toBe(true);
        ctx.expect(items[0].submenu.length).toBe(1);
        ctx.expect(items[0].submenu[0].id).toBe('child');
      },
    },
    {
      name: 'updateItem: patches in place, returns false on miss',
      run: (ctx) => {
        const items = [{ id: 'a', label: 'A' }];
        ctx.expect(mixin.updateItem(items, 'a', { label: 'A2' })).toBe(true);
        ctx.expect(items[0].label).toBe('A2');
        ctx.expect(mixin.updateItem(items, 'nope', { label: 'X' })).toBe(false);
      },
    },
    {
      name: 'removeItem: splices and returns true on hit',
      run: (ctx) => {
        const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        ctx.expect(mixin.removeItem(items, 'b')).toBe(true);
        ctx.expect(items.map((i) => i.id)).toEqual(['a', 'c']);
        ctx.expect(mixin.removeItem(items, 'nope')).toBe(false);
      },
    },
    {
      name: 'removeItem: deep path removes from submenu',
      run: (ctx) => {
        const items = [
          { id: 'parent', submenu: [
            { id: 'parent/x' },
            { id: 'parent/y' },
          ]},
        ];
        ctx.expect(mixin.removeItem(items, 'parent/x')).toBe(true);
        ctx.expect(items[0].submenu.map((i) => i.id)).toEqual(['parent/y']);
      },
    },
    {
      name: 'buildIdApi: wraps mutations + calls render',
      run: (ctx) => {
        const items = [{ id: 'a', label: 'A' }];
        let renderCount = 0;
        const api = mixin.buildIdApi({
          getItems: () => items,
          render:   () => { renderCount += 1; },
          logger:   { warn: () => {} },
        });

        ctx.expect(api.update('a', { label: 'A2' })).toBe(true);
        ctx.expect(items[0].label).toBe('A2');
        ctx.expect(renderCount).toBe(1);

        ctx.expect(api.hide('a')).toBe(true);
        ctx.expect(items[0].visible).toBe(false);
        ctx.expect(renderCount).toBe(2);

        // Misses don't render.
        ctx.expect(api.update('nope', {})).toBe(false);
        ctx.expect(renderCount).toBe(2);
      },
    },
  ],
};
