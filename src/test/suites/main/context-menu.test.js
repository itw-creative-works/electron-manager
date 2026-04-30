// Main-process tests for lib/context-menu.js — file-based right-click menus.
//
// We can't actually trigger a real right-click event in tests, so we exercise
// the surface that gets called when one fires: the definition fn, the items
// builder, and the resolver. `buildItems(params)` is the test entry point.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'context-menu (main)',
  cleanup: (ctx) => {
    // Reset to the built-in default fn so subsequent test runs aren't affected.
    ctx.manager.contextMenu._definitionFn = null;
  },
  tests: [
    {
      name: 'initialize ran (enabled by default)',
      run: (ctx) => {
        ctx.expect(ctx.manager.contextMenu._initialized).toBe(true);
      },
    },
    {
      name: 'definition presence reflects whether src/context-menu/index.js exists',
      run: (ctx) => {
        const path = require('path');
        const fs   = require('fs');
        const consumerFile = path.join(process.cwd(), 'src', 'context-menu', 'index.js');
        const hasConsumer = fs.existsSync(consumerFile);
        ctx.expect(ctx.manager.contextMenu.hasCustomDefinition()).toBe(hasConsumer);
      },
    },
    {
      name: 'default fn: editable params produce cut/copy/paste',
      run: (ctx) => {
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        });
        const roles = items.filter((i) => i.role).map((i) => i.role);
        ctx.expect(roles).toContain('cut');
        ctx.expect(roles).toContain('copy');
        ctx.expect(roles).toContain('paste');
      },
    },
    {
      name: 'default fn: text selection produces copy only',
      run: (ctx) => {
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: false,
          selectionText: 'hello world',
        });
        const roles = items.filter((i) => i.role).map((i) => i.role);
        ctx.expect(roles).toContain('copy');
        ctx.expect(roles).not.toContain('cut');
        ctx.expect(roles).not.toContain('paste');
      },
    },
    {
      name: 'default fn: link adds Open / Copy Address items',
      run: (ctx) => {
        const items = ctx.manager.contextMenu.buildItems({
          linkURL: 'https://example.com',
        });
        const labels = items.filter((i) => i.label).map((i) => i.label);
        ctx.expect(labels).toContain('Open Link in Browser');
        ctx.expect(labels).toContain('Copy Link Address');
      },
    },
    {
      name: 'default fn: empty params → no items, popup suppressed',
      run: (ctx) => {
        // Force isDevelopment false so the dev-only inspect items don't appear.
        const orig = ctx.manager.isDevelopment;
        ctx.manager.isDevelopment = () => false;
        try {
          const items = ctx.manager.contextMenu.buildItems({});
          ctx.expect(items.length).toBe(0);
        } finally {
          ctx.manager.isDevelopment = orig;
        }
      },
    },
    {
      name: 'define() replaces the fn',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu, params }) => {
          menu.item({ label: `Selected: ${params.selectionText}` });
        });
        ctx.expect(ctx.manager.contextMenu.hasCustomDefinition()).toBe(true);

        const items = ctx.manager.contextMenu.buildItems({ selectionText: 'foo' });
        ctx.expect(items.length).toBe(1);
        ctx.expect(items[0].label).toBe('Selected: foo');
      },
    },
    {
      name: 'define() throws on non-function input',
      run: (ctx) => {
        ctx.expect(() => ctx.manager.contextMenu.define(null)).toThrow(/must be a function/);
      },
    },
    {
      name: 'menu.separator() pushes a separator descriptor',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => {
          menu.item({ label: 'A' });
          menu.separator();
          menu.item({ label: 'B' });
        });
        const items = ctx.manager.contextMenu.buildItems({});
        ctx.expect(items.length).toBe(3);
        ctx.expect(items[1].type).toBe('separator');
      },
    },
    {
      name: 'menu.submenu() builds a nested submenu',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => {
          menu.submenu('More', [{ label: 'X' }, { label: 'Y' }]);
        });
        const items = ctx.manager.contextMenu.buildItems({});
        ctx.expect(items[0].label).toBe('More');
        ctx.expect(items[0].submenu.length).toBe(2);
      },
    },
    {
      name: 'definition fn receives manager, params, webContents',
      run: (ctx) => {
        let received;
        ctx.manager.contextMenu.define((arg) => {
          received = arg;
          arg.menu.item({ label: 'probe' });
        });
        ctx.manager.contextMenu.buildItems({ x: 100, y: 200 }, { id: 'fake-wc' });
        ctx.expect(received.manager).toBe(ctx.manager);
        ctx.expect(received.params).toEqual({ x: 100, y: 200 });
        ctx.expect(received.webContents).toEqual({ id: 'fake-wc' });
        ctx.expect(typeof received.menu.item).toBe('function');
        ctx.expect(typeof received.menu.separator).toBe('function');
        ctx.expect(typeof received.menu.submenu).toBe('function');
      },
    },
    {
      name: '_resolveItem evaluates dynamic labels',
      run: (ctx) => {
        let n = 0;
        const resolved = ctx.manager.contextMenu._resolveItem({
          label: () => `Items: ${n}`,
        });
        ctx.expect(resolved.label).toBe('Items: 0');
        n = 4;
        const resolved2 = ctx.manager.contextMenu._resolveItem({ label: () => `Items: ${n}` });
        ctx.expect(resolved2.label).toBe('Items: 4');
      },
    },
    {
      name: '_resolveItem wraps click handlers to swallow errors',
      run: (ctx) => {
        let called = false;
        const resolved = ctx.manager.contextMenu._resolveItem({
          label: 'X',
          click: () => { called = true; throw new Error('nope'); },
        });
        resolved.click(null, null, null);
        ctx.expect(called).toBe(true);
      },
    },
    {
      name: 'attach is idempotent per webContents',
      run: (ctx) => {
        // Mock webContents — minimal surface used by attach().
        const calls = [];
        const mockWC = {
          on: (evt, fn) => { calls.push({ evt, fn }); },
        };
        ctx.manager.contextMenu.attach(mockWC);
        ctx.manager.contextMenu.attach(mockWC); // second call should be a no-op
        ctx.expect(calls.length).toBe(1);
        ctx.expect(calls[0].evt).toBe('context-menu');
      },
    },
  ],
};
