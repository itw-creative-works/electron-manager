// Context Menu — file-based right-click menu definition.
//
// EM looks for the consumer's `src/context-menu/index.js` and calls it FOR EACH
// context-menu event with a builder API plus the event's `params`:
//
//   // src/context-menu/index.js
//   module.exports = ({ manager, menu, params, webContents }) => {
//     // params has selectionText, isEditable, linkURL, srcURL, mediaType, etc.
//     if (params.isEditable) {
//       menu.item({ role: 'cut' });
//       menu.item({ role: 'copy' });
//       menu.item({ role: 'paste' });
//     } else if (params.selectionText) {
//       menu.item({ role: 'copy' });
//       menu.item({
//         label: `Search "${params.selectionText.slice(0, 20)}"`,
//         click: () => require('electron').shell.openExternal(`https://google.com/search?q=${encodeURIComponent(params.selectionText)}`),
//       });
//     }
//
//     if (params.linkURL) {
//       menu.separator();
//       menu.item({
//         label: 'Open Link in Browser',
//         click: () => require('electron').shell.openExternal(params.linkURL),
//       });
//     }
//
//     // Always add an Inspect option in dev.
//     if (manager.isDevelopment()) {
//       menu.separator();
//       menu.item({ role: 'toggleDevTools' });
//     }
//   };
//
// Builder API per event:
//   menu.item(descriptor)
//   menu.separator()
//   menu.submenu(label, items)
//
// Returning an empty item list suppresses the menu (no popup).
//
// EM auto-attaches the handler to every BrowserWindow's webContents that
// goes through `manager.windows.createNamed()`. To attach manually:
//   manager.contextMenu.attach(webContents)
//
// Config knobs:
//   contextMenu.enabled (default true)
//   contextMenu.definition (default 'src/context-menu/index.js')

const path = require('path');
const fs   = require('fs');
const LoggerLite = require('./logger-lite.js');

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

    const enabled = manager?.config?.contextMenu?.enabled !== false;
    if (!enabled) {
      logger.log('initialize — disabled via config.contextMenu.enabled=false');
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

    const relPath = manager?.config?.contextMenu?.definition || 'src/context-menu/index.js';
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath);

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
    const { Menu } = contextMenu._electron;
    if (!Menu) return;

    const items = [];
    const api = {
      item:      (d)             => { items.push(d); },
      separator: ()              => { items.push({ type: 'separator' }); },
      submenu:   (label, subs)   => { items.push({ label, submenu: subs }); },
    };

    const fn = contextMenu._definitionFn || contextMenu._defaultFn;
    try {
      fn({ manager: contextMenu._manager, menu: api, params, webContents });
    } catch (e) {
      logger.error('context-menu definition fn threw:', e);
      return;
    }

    if (items.length === 0) {
      return; // suppress popup
    }

    const template = items.map((item) => contextMenu._resolveItem(item));
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: webContents.getOwnerBrowserWindow?.() || undefined });
  },

  // Default behavior when no consumer definition exists — provides sensible
  // baseline copy/paste/inspect for editable fields, text selection, links.
  _defaultFn({ manager, menu, params }) {
    if (params.isEditable) {
      menu.item({ role: 'cut',   enabled: params.editFlags?.canCut !== false });
      menu.item({ role: 'copy',  enabled: params.editFlags?.canCopy !== false });
      menu.item({ role: 'paste', enabled: params.editFlags?.canPaste !== false });
    } else if (params.selectionText) {
      menu.item({ role: 'copy' });
    }

    if (params.linkURL) {
      menu.separator();
      menu.item({
        label: 'Open Link in Browser',
        click: () => {
          const { shell } = require('electron');
          shell.openExternal(params.linkURL);
        },
      });
      menu.item({
        label: 'Copy Link Address',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.linkURL);
        },
      });
    }

    if (manager?.isDevelopment?.()) {
      menu.separator();
      menu.item({ role: 'toggleDevTools' });
    }
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
    const items = [];
    const api = {
      item:      (d)             => { items.push(d); },
      separator: ()              => { items.push({ type: 'separator' }); },
      submenu:   (label, subs)   => { items.push({ label, submenu: subs }); },
    };
    const fn = contextMenu._definitionFn || contextMenu._defaultFn;
    fn({ manager: contextMenu._manager, menu: api, params, webContents });
    return items;
  },

  hasCustomDefinition() {
    return Boolean(contextMenu._definitionFn);
  },
};

module.exports = contextMenu;
