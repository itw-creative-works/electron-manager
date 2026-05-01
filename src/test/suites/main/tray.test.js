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
      name: 'tray init populates items (consumer file or default template)',
      run: (ctx) => {
        // With or without a consumer file, items is a non-empty array — consumer file
        // declares what it wants; absent consumer → EM ships its default template
        // (title, open, check-for-updates, quit, ...).
        const items = ctx.manager.tray.getItems();
        ctx.expect(Array.isArray(items)).toBe(true);
        ctx.expect(items.length).toBeGreaterThan(0);
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
      name: 'refresh() does not throw when no icon set',
      run: (ctx) => {
        // Clear the icon. refresh() should be safe (warns + early-returns inside _render).
        // We don't assert isRendered() because EM auto-resolves an icon at init time, so
        // tray._tray may already exist from earlier — refresh() with null _icon just
        // skips the re-render but leaves the existing Tray instance alone.
        ctx.manager.tray._icon = null;
        // Should not throw.
        ctx.manager.tray.refresh();
      },
    },
    {
      name: 'consumer function receives manager + tray builder (incl. id-path API)',
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
        ctx.expect(typeof receivedTray.useDefaults).toBe('function');
        ctx.expect(typeof receivedTray.find).toBe('function');
        ctx.expect(typeof receivedTray.update).toBe('function');
        ctx.expect(typeof receivedTray.remove).toBe('function');
        ctx.expect(typeof receivedTray.insertAfter).toBe('function');
      },
    },
    {
      name: 'useDefaults() ships an id-tagged template (open, quit, ...)',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => { tray.useDefaults(); });
        ctx.expect(ctx.manager.tray.find('open')).toBeTruthy();
        ctx.expect(ctx.manager.tray.find('quit')).toBeTruthy();
        ctx.expect(ctx.manager.tray.find('check-for-updates')).toBeTruthy();
      },
    },
    {
      name: 'tray.update patches an item by id-path',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => { tray.useDefaults(); });
        const ok = ctx.manager.tray.update('quit', { label: 'GOODBYE' });
        ctx.expect(ok).toBe(true);
        ctx.expect(ctx.manager.tray.find('quit').label).toBe('GOODBYE');
      },
    },
    {
      name: 'tray.remove deletes an item by id-path',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => { tray.useDefaults(); });
        ctx.expect(ctx.manager.tray.find('check-for-updates')).toBeTruthy();
        const ok = ctx.manager.tray.remove('check-for-updates');
        ctx.expect(ok).toBe(true);
        ctx.expect(ctx.manager.tray.find('check-for-updates')).toBe(null);
      },
    },
    {
      name: 'tray.insertAfter splices a new sibling',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => { tray.useDefaults(); });
        const ok = ctx.manager.tray.insertAfter('open', { id: 'probe', label: 'PROBE' });
        ctx.expect(ok).toBe(true);
        const items = ctx.manager.tray.getItems();
        const openIdx = items.findIndex((i) => i.id === 'open');
        ctx.expect(items[openIdx + 1].id).toBe('probe');
      },
    },
    {
      name: 'tray.hide / tray.enable / tray.show are sugar over update',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => { tray.useDefaults(); });
        ctx.manager.tray.hide('quit');
        ctx.expect(ctx.manager.tray.find('quit').visible).toBe(false);
        ctx.manager.tray.show('quit');
        ctx.expect(ctx.manager.tray.find('quit').visible).toBe(true);
        ctx.manager.tray.enable('quit', false);
        ctx.expect(ctx.manager.tray.find('quit').enabled).toBe(false);
        ctx.manager.tray.enable('quit');
        ctx.expect(ctx.manager.tray.find('quit').enabled).toBe(true);
      },
    },
    {
      name: 'tray.has reports presence',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => { tray.useDefaults(); });
        ctx.expect(ctx.manager.tray.has('quit')).toBe(true);
        ctx.expect(ctx.manager.tray.has('does-not-exist')).toBe(false);
      },
    },
    {
      name: 'tray.insertBefore splices a new sibling',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => { tray.useDefaults(); });
        const ok = ctx.manager.tray.insertBefore('quit', { id: 'before-quit', label: 'BEFORE' });
        ctx.expect(ok).toBe(true);
        const items = ctx.manager.tray.getItems();
        const quitIdx = items.findIndex((i) => i.id === 'quit');
        ctx.expect(items[quitIdx - 1].id).toBe('before-quit');
      },
    },
    {
      name: 'tray.appendTo pushes into a submenu (creates one if absent)',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => {
          tray.item({ id: 'parent', label: 'Parent' });
        });
        const ok = ctx.manager.tray.appendTo('parent', { id: 'child', label: 'Child' });
        ctx.expect(ok).toBe(true);
        const parent = ctx.manager.tray.find('parent');
        ctx.expect(Array.isArray(parent.submenu)).toBe(true);
        ctx.expect(parent.submenu[0].id).toBe('child');
        // Resolves a nested id-path too:
        ctx.expect(ctx.manager.tray.find('parent/child').label).toBe('Child');
      },
    },
    {
      name: 'tray submenu items resolvable by parent/child path',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => {
          tray.item({ id: 'account', label: 'Account', submenu: [
            { id: 'sign-out', label: 'Sign out' },
          ]});
        });
        ctx.expect(ctx.manager.tray.find('account/sign-out').label).toBe('Sign out');
        ctx.manager.tray.update('account/sign-out', { label: 'Bye' });
        ctx.expect(ctx.manager.tray.find('account/sign-out').label).toBe('Bye');
      },
    },
    {
      name: 'auto-updater status updates the tray check-for-updates label',
      run: (ctx) => {
        ctx.manager.tray.define(({ tray }) => { tray.useDefaults(); });

        ctx.manager.autoUpdater._state = {
          code: 'downloaded', version: '7.0.0', percent: 100, error: null, downloadedAt: Date.now(), lastCheckedAt: null,
        };
        ctx.manager.autoUpdater._updateTrayItem();

        const item = ctx.manager.tray.find('check-for-updates');
        ctx.expect(item.label).toContain('Restart to Update');
        ctx.expect(item.label).toContain('7.0.0');
        ctx.expect(item.enabled).toBe(true);
      },
    },
  ],
};
