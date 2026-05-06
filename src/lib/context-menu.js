// Context Menu — file-based right-click menu definition.
//
// EM looks for the consumer's `src/integrations/context-menu/index.js` and calls it FOR EACH
// context-menu event with a builder API plus the event's `params`:
//
//   // src/integrations/context-menu/index.js
//   module.exports = ({ manager, menu, params, webContents }) => {
//     // Start from EM's default template (undo/redo, cut/copy/paste, link items,
//     // reload, dev-only inspect):
//     menu.useDefaults();
//
//     // Mutate by id within this event's items:
//     menu.remove('toggle-devtools');                        // hide dev tools
//     menu.insertAfter('copy', { id: 'search-google',
//       label: `Search "${params.selectionText.slice(0,20)}"`,
//       click: () => require('electron').shell.openExternal(...) });
//
//     // Or build entirely from scratch — useDefaults() is optional:
//     // menu.item({ id: 'copy', role: 'copy' });
//     // menu.separator();
//     // menu.item({ id: 'mine', label: 'Custom', click: ... });
//   };
//
// Builder API (per event):
//   menu.item(descriptor)
//   menu.separator()
//   menu.submenu(label, items)
//   menu.useDefaults()           — populate with EM's default template based on params
//   menu.clear()                 — wipe items added so far this event
//
// Id-path API (per event, same shape as menu/tray):
//   .find / .has / .update / .remove / .enable / .show / .hide /
//   .insertBefore / .insertAfter / .appendTo
//
// Default template ids (flat — no `context/` prefix; the lib namespace is implicit):
//   undo, redo                                   — when params.editFlags allow
//   cut, copy, paste, paste-and-match-style,
//   select-all                                   — when params.isEditable
//   copy                                          — when params.selectionText (read-only)
//   open-link, copy-link                          — when params.linkURL
//   reload                                        — always (page reload)
//   inspect, toggle-devtools                      — dev mode only
//
// Building no items (calling no menu.* methods) suppresses the popup entirely.
//
// EM auto-attaches the handler to every BrowserWindow's webContents that
// goes through `manager.windows.createNamed()`. To attach manually:
//   manager.contextMenu.attach(webContents)
//
// Disabling at runtime: call `manager.contextMenu.disable()`. Idempotent. After
// disable() the lib stops responding to context-menu events on already-attached
// webContents — no new menus are shown. No config flag.

const path = require('path');
const fs   = require('fs');
const LoggerLite = require('./logger-lite.js');
const { buildIdApi } = require('./_menu-mixin.js');

const logger = new LoggerLite('context-menu');

const contextMenu = {
  _initialized:  false,
  _manager:      null,
  _electron:     null,
  _definitionFn: null,
  _attached:     new WeakSet(), // webContents that already have the listener

  initialize(manager) {
    if (contextMenu._initialized) {
      return;
    }

    contextMenu._manager = manager;

    if (contextMenu._disabled) {
      logger.log('initialize — disabled via manager.contextMenu.disable() called pre-init');
      contextMenu._initialized = true;
      return;
    }

    try {
      contextMenu._electron = require('electron');
    } catch (e) {
      logger.warn(`electron not available — context-menu running in no-op mode. (${e.message})`);
      contextMenu._initialized = true;
      return;
    }

    // Conventional path. No config knob — disable() at runtime if you don't want a context menu.
    // appRoot resolves to project dir in dev and asar mount in packaged apps — both contain
    // src/integrations/* (electron-builder's `files: ['**/*']` packs the consumer's src/
    // into the asar), so the existsSync + require below works in both modes.
    const absPath = path.join(require('../utils/app-root.js')(), 'src', 'integrations', 'context-menu', 'index.js');

    if (fs.existsSync(absPath)) {
      const loadConsumerFile = require('../utils/load-consumer-file.js');
      const loaded = loadConsumerFile(absPath, logger);
      if (typeof loaded === 'function') {
        contextMenu._definitionFn = loaded;
      } else if (loaded != null) {
        logger.warn(`context-menu definition at ${absPath} did not export a function — using default.`);
        contextMenu._definitionFn = null;
      }
    } else {
      logger.log(`no context-menu definition at ${absPath} — using default (copy/paste based on params).`);
    }

    logger.log(`initialize — definition=${contextMenu._definitionFn ? 'consumer' : 'default'}`);
    contextMenu._initialized = true;
  },

  // Attach the context-menu listener to a webContents (idempotent per webContents).
  attach(webContents) {
    if (!webContents || contextMenu._attached.has(webContents)) {
      return;
    }
    if (!contextMenu._electron) {
      return;
    }

    contextMenu._attached.add(webContents);

    webContents.on('context-menu', (event, params) => {
      contextMenu._popup(webContents, params);
    });
  },

  // Build the menu for the given (webContents, params) and pop it up.
  _popup(webContents, params) {
    if (contextMenu._disabled) return;             // disabled at runtime → no menu
    const { Menu } = contextMenu._electron;
    if (!Menu) return;

    const items = contextMenu._buildItemsForEvent(params, webContents);
    if (items.length === 0) return; // suppress popup

    const template = items.map((item) => contextMenu._resolveItem(item));
    const builtMenu = Menu.buildFromTemplate(template);
    builtMenu.popup({ window: webContents.getOwnerBrowserWindow?.() || undefined });
  },

  // Construct the per-event builder + run the consumer's (or default) definition fn.
  // Returns the items array (live — but per-event, so post-event mutations are pointless).
  _buildItemsForEvent(params, webContents) {
    const items = [];

    const idApi = buildIdApi({
      getItems: () => items,
      // Per-event: nothing to re-render. The popup happens after definition returns.
      render: () => {},
      logger,
    });

    const builder = {
      item:        (d)            => { items.push(d); },
      separator:   ()             => { items.push({ type: 'separator' }); },
      submenu:     (label, subs)  => { items.push({ label, submenu: subs }); },
      useDefaults: ()             => { contextMenu._populateDefaults(items, params); },
      clear:       ()             => { items.length = 0; },
      ...idApi,
    };

    const fn = contextMenu._definitionFn || contextMenu._defaultFn;
    try {
      fn({ manager: contextMenu._manager, menu: builder, params, webContents });
    } catch (e) {
      logger.error('context-menu definition fn threw:', e);
      return [];
    }

    return items;
  },

  // Populate `items` with EM's default template based on context-menu params.
  // Used by both `_defaultFn` (when no consumer file) and `menu.useDefaults()` (consumer opt-in).
  // Item set + visibility gates mirror the legacy electron-manager context-menu behavior:
  // undo/redo gated on canUndo/canRedo, edit ops gated on params.isEditable, etc.
  _populateDefaults(items, params) {
    const m = contextMenu._manager;
    const flags = params.editFlags || {};

    // Undo / redo — only when applicable. Hidden when canUndo/canRedo is false (matches legacy).
    if (flags.canUndo) {
      items.push({ id: 'undo', role: 'undo' });
    }
    if (flags.canRedo) {
      items.push({ id: 'redo', role: 'redo' });
    }
    if (flags.canUndo || flags.canRedo) {
      items.push({ type: 'separator' });
    }

    if (params.isEditable) {
      items.push({ id: 'cut',                   role: 'cut',                enabled: flags.canCut   !== false });
      items.push({ id: 'copy',                  role: 'copy',               enabled: flags.canCopy  !== false });
      items.push({ id: 'paste',                 role: 'paste',              enabled: flags.canPaste !== false });
      items.push({ id: 'paste-and-match-style', role: 'pasteAndMatchStyle', enabled: flags.canPaste !== false });
      items.push({ id: 'select-all',            role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ id: 'copy', role: 'copy' });
    }

    if (params.linkURL) {
      if (items.length > 0) items.push({ type: 'separator' });
      items.push({
        id: 'open-link',
        label: 'Open Link in Browser',
        click: () => {
          const { shell } = require('electron');
          shell.openExternal(params.linkURL);
        },
      });
      items.push({
        id: 'copy-link',
        label: 'Copy Link Address',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.linkURL);
        },
      });
    }

    // Reload — useful for both dev and prod. Separator only if there's already content above.
    if (items.length > 0) items.push({ type: 'separator' });
    items.push({ id: 'reload', role: 'reload' });

    if (m?.isDevelopment?.()) {
      items.push({ type: 'separator' });
      items.push({ id: 'inspect',         role: 'inspectElement' });
      items.push({ id: 'toggle-devtools', role: 'toggleDevTools' });
    }
  },

  // Default behavior when no consumer definition exists — sensible baseline.
  _defaultFn({ menu, params }) {
    menu.useDefaults();
  },

  // Same resolver pattern as tray/menu — supports dynamic label/enabled/etc.
  _resolveItem(item) {
    if (item.type === 'separator') {
      return { type: 'separator' };
    }

    const out = { ...item };

    if (typeof item.label === 'function') {
      try { out.label = String(item.label()); }
      catch (e) { logger.error('item.label() threw:', e); out.label = ''; }
    }
    if (typeof item.enabled === 'function') {
      try { out.enabled = Boolean(item.enabled()); } catch (e) { out.enabled = true; }
    }
    if (typeof item.visible === 'function') {
      try { out.visible = Boolean(item.visible()); } catch (e) { out.visible = true; }
    }
    if (typeof item.checked === 'function') {
      try { out.checked = Boolean(item.checked()); } catch (e) { out.checked = false; }
    }

    if (Array.isArray(item.submenu)) {
      out.submenu = item.submenu.map((sub) => contextMenu._resolveItem(sub));
    }

    if (typeof item.click === 'function') {
      out.click = (menuItem, browserWindow, event) => {
        try { item.click(menuItem, browserWindow, event); }
        catch (e) { logger.error('item.click handler threw:', e); }
      };
    }

    return out;
  },

  // Public runtime API — replace the definition fn at runtime.
  define(fn) {
    if (typeof fn !== 'function') {
      throw new Error('contextMenu.define: fn must be a function');
    }
    contextMenu._definitionFn = fn;
  },

  // Test/inspection helpers — build the items list for given params without popping a menu.
  buildItems(params, webContents) {
    return contextMenu._buildItemsForEvent(params || {}, webContents);
  },

  hasCustomDefinition() {
    return Boolean(contextMenu._definitionFn);
  },

  // Disable the context menu entirely. Idempotent. Safe pre- or post-init.
  // After this, _popup() short-circuits — already-attached webContents stop
  // showing menus on right-click. No way to re-enable; call manager.contextMenu.define()
  // and clear _disabled if you really need to.
  disable() {
    contextMenu._disabled = true;
    contextMenu._definitionFn = null;
    if (contextMenu._initialized) {
      logger.log('disabled at runtime — context-menu events will be ignored');
    }
  },

  isDisabled() { return Boolean(contextMenu._disabled); },
};

module.exports = contextMenu;
