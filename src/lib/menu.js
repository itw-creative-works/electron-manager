// Menu — file-based application menu definition.
//
// EM looks for the consumer's `src/menu/index.js` and calls it with a builder API:
//
//   // src/menu/index.js
//   module.exports = ({ manager, menu, defaults }) => {
//     // Use the platform-aware default template as a starting point...
//     menu.useDefaults();
//
//     // ...or build from scratch:
//     menu.menu('File', [
//       { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => manager.windows.show('main') },
//       { type: 'separator' },
//       { role: 'quit' },
//     ]);
//     menu.menu('Edit', [{ role: 'undo' }, { role: 'redo' }]);
//   };
//
// Builder API:
//   menu.menu(label, items)   // add a top-level menu bar entry
//   menu.useDefaults()        // populate with the platform-appropriate default template
//   menu.clear()              // start over
//   menu.append(item)         // append a top-level descriptor (rare; prefer menu())
//
// Item descriptors mirror Electron's MenuItemConstructorOptions, plus the same
// dynamic conveniences as tray: label/enabled/visible/checked may be functions,
// click handlers are wrapped to catch errors.
//
// On macOS the first menu is automatically prefixed with the app menu (About / Hide / Quit / etc.)
// when useDefaults() is called.
//
// Config knobs:
//   menu.enabled (default true) — set false to skip menu setup entirely
//   menu.definition (default 'src/menu/index.js')

const path = require('path');
const fs   = require('fs');
const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('menu');

const menu = {
  _initialized: false,
  _manager:     null,
  _menu:        null,    // electron Menu instance (after _render)
  _items:       [],      // top-level descriptors
  _electron:    null,
  _definitionFn: null,

  initialize(manager) {
    if (menu._initialized) {
      return;
    }

    menu._manager = manager;

    const enabled = manager?.config?.menu?.enabled !== false;
    if (!enabled) {
      logger.log('initialize — disabled via config.menu.enabled=false');
      menu._initialized = true;
      return;
    }

    try {
      menu._electron = require('electron');
    } catch (e) {
      logger.warn(`electron not available — menu running in no-op mode. (${e.message})`);
      menu._initialized = true;
      return;
    }

    const relPath = manager?.config?.menu?.definition || 'src/menu/index.js';
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath);

    if (fs.existsSync(absPath)) {
      const loadConsumerFile = require('../utils/load-consumer-file.js');
      const loaded = loadConsumerFile(absPath, logger);
      if (typeof loaded === 'function') {
        menu._definitionFn = loaded;
      } else if (loaded != null) {
        logger.warn(`menu definition at ${absPath} did not export a function — using defaults.`);
        menu._definitionFn = null;
      }
    } else {
      logger.log(`no menu definition at ${absPath} — using default template.`);
    }

    const api = menu._buildApi();

    if (menu._definitionFn) {
      try {
        menu._definitionFn({ manager, menu: api, defaults: menu._defaultTemplate() });
      } catch (e) {
        logger.error('menu definition fn threw:', e);
      }
    } else {
      // No file → ship the default template as a sensible baseline.
      menu._items = menu._defaultTemplate();
    }

    menu._render();

    // Reflect current auto-updater state into the menu item now that the menu exists.
    // (The auto-updater initializes before menu in the boot sequence, so its initial state
    // wasn't reflected in the menu yet.)
    if (manager?.autoUpdater?._updateMenuItem) {
      try { manager.autoUpdater._updateMenuItem(); } catch (e) { /* ignore */ }
    }

    logger.log(`initialize — top-level menus=${menu._items.length}`);
    menu._initialized = true;
  },

  // Builder API
  _buildApi() {
    return {
      menu:        (label, items) => { menu._items.push({ label, submenu: items || [] }); },
      append:      (item)         => { menu._items.push(item); },
      useDefaults: ()             => { menu._items = menu._defaultTemplate(); },
      clear:       ()             => { menu._items = []; },
    };
  },

  // Default template — platform-aware. macOS gets the standard app menu prepended.
  _defaultTemplate() {
    const isMac = process.platform === 'darwin';
    const productName = menu._manager?.config?.app?.productName || 'App';

    // EM's built-in "Check for Updates..." item. Tagged with id 'em:check-for-updates' so
    // consumer menu code (or EM internals like auto-updater) can find/modify/remove it.
    // Click defaults to invoking auto-updater check; auto-updater hook updates label/enabled
    // dynamically based on status.
    const updateItem = {
      id: 'em:check-for-updates',
      label: 'Check for Updates...',
      click: () => {
        const m = menu._manager;
        if (!m || !m.autoUpdater) return;
        const status = m.autoUpdater.getStatus();
        if (status.code === 'downloaded') m.autoUpdater.installNow();
        else m.autoUpdater.checkNow({ userInitiated: true });
      },
    };

    const template = [];

    if (isMac) {
      template.push({
        label: productName,
        submenu: [
          { role: 'about' },
          updateItem,
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      });
    }

    template.push({
      label: 'File',
      submenu: isMac ? [{ role: 'close' }] : [{ role: 'quit' }],
    });

    template.push({
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' },
        ]),
      ],
    });

    template.push({
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    });

    template.push({
      label: 'Window',
      submenu: isMac ? [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ] : [
        { role: 'minimize' },
        { role: 'close' },
      ],
    });

    // On Windows / Linux, the app menu doesn't exist — EM puts the updater item
    // in a "Help" submenu instead.
    if (!isMac) {
      template.push({
        label: 'Help',
        submenu: [updateItem],
      });
    }

    return template;
  },

  // Render or re-render the application menu from the current item list.
  _render() {
    if (!menu._electron) return;

    const { Menu } = menu._electron;
    if (!Menu) {
      logger.warn('Menu not available in this electron build.');
      return;
    }

    const template = menu._items.map((item) => menu._resolveItem(item));
    menu._menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu._menu);
  },

  // Resolve a raw descriptor into MenuItemConstructorOptions.
  // Functions for label / enabled / visible / checked are evaluated now.
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
      out.submenu = item.submenu.map((sub) => menu._resolveItem(sub));
    }

    if (typeof item.click === 'function') {
      out.click = (menuItem, browserWindow, event) => {
        try { item.click(menuItem, browserWindow, event); }
        catch (e) { logger.error('item.click handler threw:', e); }
      };
    }

    return out;
  },

  // Public runtime API

  refresh() {
    menu._render();
  },

  define(fn) {
    if (typeof fn !== 'function') {
      throw new Error('menu.define: fn must be a function');
    }
    menu._items = [];
    fn({ manager: menu._manager, menu: menu._buildApi(), defaults: menu._defaultTemplate() });
    menu._render();
  },

  // Find an item by id anywhere in the menu tree (top-level or nested submenu).
  // Returns the actual descriptor (live reference into _items), or null.
  findItem(id) {
    return findInItems(menu._items, id);
  },

  // Patch an item by id (label / enabled / visible / accelerator / etc.) and re-render.
  // Returns true if the item was found and updated, false otherwise.
  updateItem(id, patch) {
    const item = menu.findItem(id);
    if (!item) return false;
    Object.assign(item, patch || {});
    menu._render();
    return true;
  },

  // Remove an item by id from wherever it lives. Returns true if removed.
  removeItem(id) {
    const removed = removeFromItems(menu._items, id);
    if (removed) menu._render();
    return removed;
  },

  // Inspection
  getItems()    { return menu._items.slice(); },
  isRendered()  { return Boolean(menu._menu); },
  getMenu()     { return menu._menu; },

  // Tear down (used by tests).
  destroy() {
    menu._items = [];
    menu._menu = null;
    if (menu._electron?.Menu?.setApplicationMenu) {
      try { menu._electron.Menu.setApplicationMenu(null); } catch (e) { /* ignore */ }
    }
  },
};

function findInItems(items, id) {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (item && item.id === id) return item;
    if (item && Array.isArray(item.submenu)) {
      const nested = findInItems(item.submenu, id);
      if (nested) return nested;
    }
  }
  return null;
}

function removeFromItems(items, id) {
  if (!Array.isArray(items)) return false;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] && items[i].id === id) {
      items.splice(i, 1);
      return true;
    }
    if (items[i] && Array.isArray(items[i].submenu)) {
      if (removeFromItems(items[i].submenu, id)) return true;
    }
  }
  return false;
}

module.exports = menu;
