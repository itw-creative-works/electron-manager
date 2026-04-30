// Main-process tests for lib/tray.js — file-based tray definition + builder API.
//
// The harness boots in EM's repo root, where there's no consumer `src/tray/index.js`,
// so the tray initializes empty. We test the builder API by calling `tray.define()`
// at runtime (same code path the consumer's file-based definition uses).
//
// We don't assert on the actual macOS Tray rendering — we'd need a real icon file
// and would pop UI during tests. Instead we verify the API state surface.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'tray (main)',
  cleanup: (ctx) => {
    ctx.manager.tray.destroy();
  },
  tests: [
    {
      name: 'initialize ran (enabled by default)',
      run: (ctx) => {
        ctx.expect(ctx.manager.tray._initialized).toBe(true);
      },
    },
    {
      name: 'tray init result depends on whether a consumer src/tray/index.js exists',
      run: (ctx) => {
        const path = require('path');
        const fs   = require('fs');
        const consumerFile = path.join(process.cwd(), 'src', 'tray', 'index.js');
        const hasConsumer = fs.existsSync(consumerFile);

        if (hasConsumer) {
          // When the consumer file exists, the framework calls it and the items array reflects what
          // the consumer declared. We just assert the builder ran (items is an array).
          ctx.expect(Array.isArray(ctx.manager.tray.getItems())).toBe(true);
        } else {
          // Without a consumer file, items are empty and nothing renders.
          ctx.expect(ctx.manager.tray.getItems()).toEqual([]);
          ctx.expect(ctx.manager.tray.isRendered()).toBe(false);
        }
      },
    },
    {
      name: 'define() runs the builder fn and stores items',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => {
          tray.tooltip('TestApp');
          tray.item({ label: 'Hello', click: () => {} });
          tray.separator();
          tray.item({ label: 'World', click: () => {} });
        });

        const items = ctx.manager.tray.getItems();
        ctx.expect(items.length).toBe(3);
        ctx.expect(items[0].label).toBe('Hello');
        ctx.expect(items[1].type).toBe('separator');
        ctx.expect(items[2].label).toBe('World');
        ctx.expect(ctx.manager.tray.getTooltip()).toBe('TestApp');
      },
    },
    {
      name: 'define() throws on non-function input',
      run: (ctx) => {
        ctx.expect(() => ctx.manager.tray.define(null)).toThrow(/must be a function/);
        ctx.expect(() => ctx.manager.tray.define('nope')).toThrow(/must be a function/);
      },
    },
    {
      name: 'define() replaces previous items (not append)',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => {
          tray.item({ label: 'First' });
        });
        ctx.expect(ctx.manager.tray.getItems().length).toBe(1);

        ctx.manager.tray.define(({ tray }) => {
          tray.item({ label: 'Second' });
          tray.item({ label: 'Third' });
        });
        const items = ctx.manager.tray.getItems();
        ctx.expect(items.length).toBe(2);
        ctx.expect(items[0].label).toBe('Second');
      },
    },
    {
      name: 'addItem appends without nuking existing items',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => {
          tray.item({ label: 'A' });
          tray.item({ label: 'B' });
        });
        ctx.manager.tray.addItem({ label: 'C' });
        const labels = ctx.manager.tray.getItems().map((i) => i.label);
        ctx.expect(labels).toEqual(['A', 'B', 'C']);
      },
    },
    {
      name: 'clearItems empties the list',
      run: (ctx) => {
        ctx.manager.tray.addItem({ label: 'X' });
        ctx.manager.tray.clearItems();
        ctx.expect(ctx.manager.tray.getItems()).toEqual([]);
      },
    },
    {
      name: 'setIcon / setTooltip update state',
      run: (ctx) => {
        ctx.manager.tray.setIcon('/tmp/some-icon.png');
        ctx.manager.tray.setTooltip('Hover me');
        ctx.expect(ctx.manager.tray.getIcon()).toBe('/tmp/some-icon.png');
        ctx.expect(ctx.manager.tray.getTooltip()).toBe('Hover me');
      },
    },
    {
      name: 'dynamic label functions are evaluated on refresh',
      run: (ctx) => {
        let count = 0;
        ctx.manager.tray.define(({ tray }) => {
          tray.item({ label: () => `Count: ${count}` });
        });

        // Resolve internally to confirm the fn is called.
        const resolved1 = ctx.manager.tray._resolveItem(ctx.manager.tray.getItems()[0]);
        ctx.expect(resolved1.label).toBe('Count: 0');

        count = 5;
        const resolved2 = ctx.manager.tray._resolveItem(ctx.manager.tray.getItems()[0]);
        ctx.expect(resolved2.label).toBe('Count: 5');
      },
    },
    {
      name: 'click handlers are wrapped to catch errors',
      run: (ctx) => {
        let called = false;
        ctx.manager.tray.define(({ tray }) => {
          tray.item({ label: 'Boom', click: () => { called = true; throw new Error('boom'); } });
        });

        const resolved = ctx.manager.tray._resolveItem(ctx.manager.tray.getItems()[0]);
        ctx.expect(typeof resolved.click).toBe('function');

        // Invoking the wrapped click must NOT throw, even though the handler does.
        resolved.click(null, null, null);
        ctx.expect(called).toBe(true);
      },
    },
    {
      name: 'separator descriptor resolves to {type:"separator"}',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => {
          tray.separator();
        });
        const resolved = ctx.manager.tray._resolveItem(ctx.manager.tray.getItems()[0]);
        ctx.expect(resolved).toEqual({ type: 'separator' });
      },
    },
    {
      name: 'submenu items are recursively resolved',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => {
          tray.item({
            label: 'Parent',
            submenu: [
              { label: () => 'Dyn child', click: () => {} },
              { type: 'separator' },
            ],
          });
        });
        const resolved = ctx.manager.tray._resolveItem(ctx.manager.tray.getItems()[0]);
        ctx.expect(resolved.label).toBe('Parent');
        ctx.expect(Array.isArray(resolved.submenu)).toBe(true);
        ctx.expect(resolved.submenu[0].label).toBe('Dyn child');
        ctx.expect(resolved.submenu[1].type).toBe('separator');
      },
    },
    {
      name: 'refresh() re-renders without throwing when no icon set',
      run: (ctx) => {
        // Currently no icon (we cleared between tests). refresh() should be safe.
        ctx.manager.tray._icon = null;
        ctx.manager.tray.refresh();
        ctx.expect(ctx.manager.tray.isRendered()).toBe(false);
      },
    },
    {
      name: 'consumer function receives manager + tray builder',
      run: (ctx) => {
        let receivedManager;
        let receivedTray;
        ctx.manager.tray.define((arg) => {
          receivedManager = arg.manager;
          receivedTray = arg.tray;
          arg.tray.item({ label: 'probe' });
        });
        ctx.expect(receivedManager).toBe(ctx.manager);
        ctx.expect(typeof receivedTray.icon).toBe('function');
        ctx.expect(typeof receivedTray.tooltip).toBe('function');
        ctx.expect(typeof receivedTray.item).toBe('function');
        ctx.expect(typeof receivedTray.separator).toBe('function');
        ctx.expect(typeof receivedTray.submenu).toBe('function');
      },
    },
  ],
};
