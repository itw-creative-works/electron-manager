// Main-process tests for lib/menu.js — file-based application menu + builder API.
//
// In the harness, no consumer src/menu/index.js exists, so menu falls back to
// the default template. We then exercise the runtime define()/builder API.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'menu (main)',
  cleanup: (ctx) => {
    ctx.manager.menu.destroy();
  },
  tests: [
    {
      name: 'initialize ran (enabled by default)',
      run: (ctx) => {
        ctx.expect(ctx.manager.menu._initialized).toBe(true);
      },
    },
    {
      name: 'no consumer definition file → default template loaded',
      run: (ctx) => {
        const items = ctx.manager.menu.getItems();
        ctx.expect(Array.isArray(items)).toBe(true);
        ctx.expect(items.length).toBeGreaterThan(0);

        // Find expected top-level entries (some are platform-specific; Edit/View/Window are universal).
        const labels = items.map((i) => i.label);
        ctx.expect(labels).toContain('Edit');
        ctx.expect(labels).toContain('View');
        ctx.expect(labels).toContain('Window');
      },
    },
    {
      name: 'default template renders and Menu.setApplicationMenu was called',
      run: (ctx) => {
        ctx.expect(ctx.manager.menu.isRendered()).toBe(true);
        ctx.expect(ctx.manager.menu.getMenu()).toBeTruthy();
      },
    },
    {
      name: 'macOS: first menu is the app menu (productName)',
      run: (ctx) => {
        if (process.platform !== 'darwin') {
          ctx.skip('macOS-only behavior');
        }
        const productName = ctx.manager.config?.app?.productName;
        const items = ctx.manager.menu.getItems();
        ctx.expect(items[0].label).toBe(productName);
      },
    },
    {
      name: 'define() runs the builder fn and replaces items',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu }) => {
          menu.menu('Test', [
            { label: 'Hello', click: () => {} },
            { type: 'separator' },
            { label: 'World', click: () => {} },
          ]);
        });

        const items = ctx.manager.menu.getItems();
        ctx.expect(items.length).toBe(1);
        ctx.expect(items[0].label).toBe('Test');
        ctx.expect(Array.isArray(items[0].submenu)).toBe(true);
        ctx.expect(items[0].submenu.length).toBe(3);
      },
    },
    {
      name: 'define() throws on non-function input',
      run: (ctx) => {
        ctx.expect(() => ctx.manager.menu.define(null)).toThrow(/must be a function/);
      },
    },
    {
      name: 'menu.menu(label, items) appends a top-level entry',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu }) => {
          menu.menu('First', [{ label: 'a' }]);
          menu.menu('Second', [{ label: 'b' }]);
        });
        const labels = ctx.manager.menu.getItems().map((i) => i.label);
        ctx.expect(labels).toEqual(['First', 'Second']);
      },
    },
    {
      name: 'useDefaults() replaces items with the platform default template',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu }) => {
          menu.menu('Custom', [{ label: 'x' }]);
          menu.useDefaults();
        });
        const labels = ctx.manager.menu.getItems().map((i) => i.label);
        ctx.expect(labels).toContain('Edit');
        ctx.expect(labels).not.toContain('Custom');
      },
    },
    {
      name: 'clear() empties the items list',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu }) => {
          menu.menu('A', [{ label: 'a' }]);
          menu.clear();
        });
        ctx.expect(ctx.manager.menu.getItems()).toEqual([]);
      },
    },
    {
      name: 'append() adds a raw descriptor at top level',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu }) => {
          menu.append({ label: 'Raw', submenu: [{ label: 'inside' }] });
        });
        const items = ctx.manager.menu.getItems();
        ctx.expect(items.length).toBe(1);
        ctx.expect(items[0].label).toBe('Raw');
      },
    },
    {
      name: 'dynamic label functions are evaluated at resolve time',
      run: (ctx) => {
        let count = 0;
        ctx.manager.menu.define(({ menu }) => {
          menu.menu('Counter', [{ label: () => `Count: ${count}` }]);
        });

        const item = ctx.manager.menu.getItems()[0].submenu[0];
        const resolved1 = ctx.manager.menu._resolveItem(item);
        ctx.expect(resolved1.label).toBe('Count: 0');

        count = 7;
        const resolved2 = ctx.manager.menu._resolveItem(item);
        ctx.expect(resolved2.label).toBe('Count: 7');
      },
    },
    {
      name: 'click handlers are wrapped to catch errors',
      run: (ctx) => {
        let called = false;
        ctx.manager.menu.define(({ menu }) => {
          menu.menu('M', [
            { label: 'Boom', click: () => { called = true; throw new Error('boom'); } },
          ]);
        });
        const inner = ctx.manager.menu.getItems()[0].submenu[0];
        const resolved = ctx.manager.menu._resolveItem(inner);
        resolved.click(null, null, null);
        ctx.expect(called).toBe(true);
      },
    },
    {
      name: 'submenu items are recursively resolved',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu }) => {
          menu.menu('Top', [
            {
              label: 'Parent',
              submenu: [
                { label: () => 'Dyn child' },
                { type: 'separator' },
              ],
            },
          ]);
        });
        const top = ctx.manager.menu.getItems()[0];
        const resolved = ctx.manager.menu._resolveItem(top);
        ctx.expect(resolved.submenu[0].label).toBe('Parent');
        ctx.expect(resolved.submenu[0].submenu[0].label).toBe('Dyn child');
        ctx.expect(resolved.submenu[0].submenu[1].type).toBe('separator');
      },
    },
    {
      name: 'default template includes em:check-for-updates item',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu: m }) => m.useDefaults());
        const item = ctx.manager.menu.findItem('em:check-for-updates');
        ctx.expect(item).toBeTruthy();
        ctx.expect(typeof item.label).toBe('string');
        ctx.expect(typeof item.click).toBe('function');
      },
    },
    {
      name: 'findItem returns null for unknown id',
      run: (ctx) => {
        ctx.expect(ctx.manager.menu.findItem('does-not-exist')).toBe(null);
      },
    },
    {
      name: 'updateItem patches label and re-renders',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu: m }) => m.useDefaults());
        const ok = ctx.manager.menu.updateItem('em:check-for-updates', { label: 'PROBE LABEL' });
        ctx.expect(ok).toBe(true);
        const item = ctx.manager.menu.findItem('em:check-for-updates');
        ctx.expect(item.label).toBe('PROBE LABEL');
      },
    },
    {
      name: 'updateItem returns false for unknown id',
      run: (ctx) => {
        const ok = ctx.manager.menu.updateItem('nope', { label: 'nope' });
        ctx.expect(ok).toBe(false);
      },
    },
    {
      name: 'removeItem deletes item from tree',
      run: (ctx) => {
        // Recreate the default template so we have the item to remove (previous test may have mutated).
        ctx.manager.menu.define(({ menu: m }) => m.useDefaults());
        ctx.expect(ctx.manager.menu.findItem('em:check-for-updates')).toBeTruthy();

        const removed = ctx.manager.menu.removeItem('em:check-for-updates');
        ctx.expect(removed).toBe(true);
        ctx.expect(ctx.manager.menu.findItem('em:check-for-updates')).toBe(null);

        // Restore for subsequent tests.
        ctx.manager.menu.define(({ menu: m }) => m.useDefaults());
      },
    },
    {
      name: 'auto-updater status updates the menu item label',
      run: async (ctx) => {
        ctx.manager.menu.define(({ menu: m }) => m.useDefaults());

        // Force a known state and trigger menu update.
        ctx.manager.autoUpdater._state = {
          code: 'downloaded', version: '5.0.0', percent: 100, error: null, downloadedAt: Date.now(), lastCheckedAt: null,
        };
        ctx.manager.autoUpdater._updateMenuItem();

        const item = ctx.manager.menu.findItem('em:check-for-updates');
        ctx.expect(item.label).toContain('Restart to Update');
        ctx.expect(item.label).toContain('5.0.0');
        ctx.expect(item.enabled).toBe(true);
      },
    },
    {
      name: 'auto-updater downloading status disables item',
      run: (ctx) => {
        ctx.manager.menu.define(({ menu: m }) => m.useDefaults());

        ctx.manager.autoUpdater._state = {
          code: 'downloading', version: '5.0.0', percent: 42, error: null, downloadedAt: null, lastCheckedAt: null,
        };
        ctx.manager.autoUpdater._updateMenuItem();

        const item = ctx.manager.menu.findItem('em:check-for-updates');
        ctx.expect(item.label).toContain('42%');
        ctx.expect(item.enabled).toBe(false);
      },
    },
    {
      name: 'consumer function receives manager + menu builder + defaults',
      run: (ctx) => {
        let received;
        ctx.manager.menu.define((arg) => {
          received = arg;
          arg.menu.menu('probe', []);
        });
        ctx.expect(received.manager).toBe(ctx.manager);
        ctx.expect(typeof received.menu.menu).toBe('function');
        ctx.expect(typeof received.menu.useDefaults).toBe('function');
        ctx.expect(typeof received.menu.clear).toBe('function');
        ctx.expect(typeof received.menu.append).toBe('function');
        ctx.expect(Array.isArray(received.defaults)).toBe(true);
      },
    },
  ],
};
