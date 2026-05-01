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
      name: 'definition presence reflects whether src/integrations/context-menu/index.js exists',
      run: (ctx) => {
        const path = require('path');
        const fs   = require('fs');
        const consumerFile = path.join(process.cwd(), 'src', 'integrations', 'context-menu', 'index.js');
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
      name: 'default fn: empty params → only the always-on items (reload)',
      run: (ctx) => {
        // Force isDevelopment false so dev-only items don't appear.
        const orig = ctx.manager.isDevelopment;
        ctx.manager.isDevelopment = () => false;
        try {
          const items = ctx.manager.contextMenu.buildItems({});
          // With no editFlags, no selection, no link → only `reload` is always-on.
          const ids = items.filter((i) => i.id).map((i) => i.id);
          ctx.expect(ids).toEqual(['reload']);
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
    {
      name: 'menu.useDefaults() ships id-tagged items (cut, copy, paste, ...)',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => { menu.useDefaults(); });
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        });
        const ids = items.filter((i) => i.id).map((i) => i.id);
        ctx.expect(ids).toContain('cut');
        ctx.expect(ids).toContain('copy');
        ctx.expect(ids).toContain('paste');
      },
    },
    {
      name: 'menu.remove() drops an item by id within the event',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => {
          menu.useDefaults();
          menu.remove('paste');
        });
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        });
        const ids = items.filter((i) => i.id).map((i) => i.id);
        ctx.expect(ids).toContain('cut');
        ctx.expect(ids).toContain('copy');
        ctx.expect(ids).not.toContain('paste');
      },
    },
    {
      name: 'menu.insertAfter splices a new item by id',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => {
          menu.useDefaults();
          menu.insertAfter('copy', { id: 'search', label: 'Search...' });
        });
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: false,
          selectionText: 'foo',
        });
        const ids = items.filter((i) => i.id).map((i) => i.id);
        const copyIdx   = ids.indexOf('copy');
        const searchIdx = ids.indexOf('search');
        ctx.expect(copyIdx >= 0).toBe(true);
        ctx.expect(searchIdx).toBe(copyIdx + 1);
      },
    },
    {
      name: 'menu.update() patches a default item before popup',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => {
          menu.useDefaults();
          menu.update('copy', { label: 'CUSTOM COPY' });
        });
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: false,
          selectionText: 'foo',
        });
        const copy = items.find((i) => i.id === 'copy');
        ctx.expect(copy).toBeTruthy();
        ctx.expect(copy.label).toBe('CUSTOM COPY');
      },
    },
    {
      name: 'defaults: undo/redo appear when canUndo/canRedo flags set',
      run: (ctx) => {
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: true,
          editFlags: { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true },
        });
        const ids = items.filter((i) => i.id).map((i) => i.id);
        ctx.expect(ids).toContain('undo');
        ctx.expect(ids).toContain('redo');
      },
    },
    {
      name: 'defaults: paste-and-match-style appears in editable contexts',
      run: (ctx) => {
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        });
        const ids = items.filter((i) => i.id).map((i) => i.id);
        ctx.expect(ids).toContain('paste-and-match-style');
      },
    },
    {
      name: 'defaults: reload always present',
      run: (ctx) => {
        const orig = ctx.manager.isDevelopment;
        ctx.manager.isDevelopment = () => false;
        try {
          const items = ctx.manager.contextMenu.buildItems({ selectionText: 'hi' });
          const ids = items.filter((i) => i.id).map((i) => i.id);
          ctx.expect(ids).toContain('reload');
        } finally {
          ctx.manager.isDevelopment = orig;
        }
      },
    },
    {
      name: 'menu.find / menu.has work within event builder',
      run: (ctx) => {
        let foundCopy, hasCut, hasNope;
        ctx.manager.contextMenu.define(({ menu }) => {
          menu.useDefaults();
          foundCopy = menu.find('copy');
          hasCut    = menu.has('cut');
          hasNope   = menu.has('does-not-exist');
        });
        ctx.manager.contextMenu.buildItems({
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        });
        ctx.expect(foundCopy).toBeTruthy();
        ctx.expect(hasCut).toBe(true);
        ctx.expect(hasNope).toBe(false);
      },
    },
    {
      name: 'menu.insertBefore splices a new item by id',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => {
          menu.useDefaults();
          menu.insertBefore('copy', { id: 'pre-copy', label: 'BEFORE COPY' });
        });
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: false,
          selectionText: 'foo',
        });
        const ids = items.filter((i) => i.id).map((i) => i.id);
        const copyIdx    = ids.indexOf('copy');
        const preCopyIdx = ids.indexOf('pre-copy');
        ctx.expect(preCopyIdx).toBe(copyIdx - 1);
      },
    },
    {
      name: 'menu.hide / menu.enable / menu.show within event',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => {
          menu.useDefaults();
          menu.hide('copy');
          menu.enable('paste', false);
        });
        const items = ctx.manager.contextMenu.buildItems({
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        });
        const copy  = items.find((i) => i.id === 'copy');
        const paste = items.find((i) => i.id === 'paste');
        ctx.expect(copy.visible).toBe(false);
        ctx.expect(paste.enabled).toBe(false);
      },
    },
    {
      name: 'menu.appendTo pushes into a submenu created via menu.submenu(...)',
      run: (ctx) => {
        ctx.manager.contextMenu.define(({ menu }) => {
          // Build a parent submenu with an id.
          menu.item({ id: 'more', label: 'More', submenu: [] });
          menu.appendTo('more', { id: 'extra', label: 'Extra' });
        });
        const items = ctx.manager.contextMenu.buildItems({});
        const more = items.find((i) => i.id === 'more');
        ctx.expect(more).toBeTruthy();
        ctx.expect(more.submenu[0].id).toBe('extra');
      },
    },
  ],
};
