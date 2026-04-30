// Tray — file-based tray definition.
//
// EM looks for the consumer's `src/tray/index.js` and calls it with a builder API:
//
//   // src/tray/index.js
//   module.exports = ({ manager, tray }) => {
//     tray.icon('src/assets/icons/tray-Template.png');
//     tray.tooltip('MyApp');
//     tray.item({ label: 'Open',  click: () => manager.windows.show('main') });
//     tray.item({ type: 'separator' });
//     tray.item({
//       label: () => manager.appState.get('user') ? 'Sign out' : 'Sign in',
//       click: () => manager.webManager.signInOrOut(),
//     });
//   };
//
// Items support dynamic labels (function) and dynamic enabled/visible/checked.
// Call `manager.tray.refresh()` after mutating state to re-render the menu.
//
// Config knobs (in `config/electron-manager.json`):
//   tray.enabled (default true) — set to false to disable tray entirely
//   tray.definition (default 'src/tray/index.js') — alternative path

const path = require('path');
const fs   = require('fs');
const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('tray');

const tray = {
  _initialized: false,
  _manager:     null,
  _tray:        null,    // electron Tray instance
  _items:       [],      // raw item descriptors
  _icon:        null,    // resolved abs path
  _tooltip:     null,
  _electron:    null,
  _definitionFn: null,   // consumer's exported fn (or null)

  initialize(manager) {
    if (tray._initialized) {
      return;
    }

    tray._manager = manager;

    const enabled = manager?.config?.tray?.enabled !== false;
    if (!enabled) {
      logger.log('initialize — disabled via config.tray.enabled=false');
      tray._initialized = true;
      return;
    }

    try {
      tray._electron = require('electron');
    } catch (e) {
      logger.warn(`electron not available — tray running in no-op mode. (${e.message})`);
      tray._initialized = true;
      return;
    }

    // Locate the consumer's tray definition file. Default: <projectRoot>/src/tray/index.js.
    const relPath = manager?.config?.tray?.definition || 'src/tray/index.js';
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath);

    if (fs.existsSync(absPath)) {
      const loadConsumerFile = require('../utils/load-consumer-file.js');
      const loaded = loadConsumerFile(absPath, logger);
      if (typeof loaded === 'function') {
        tray._definitionFn = loaded;
      } else if (loaded != null) {
        logger.warn(`tray definition at ${absPath} did not export a function — ignoring.`);
        tray._definitionFn = null;
      }
    } else {
      logger.log(`no tray definition at ${absPath} — tray will be empty until manager.tray.define() is called.`);
    }

    // Build the API object the consumer calls.
    const api = tray._buildApi();

    if (tray._definitionFn) {
      try {
        tray._definitionFn({ manager, tray: api });
      } catch (e) {
        logger.error('tray definition fn threw:', e);
      }
    }

    // Create the Tray now that items/icon/tooltip are in place.
    tray._render();

    logger.log(`initialize — items=${tray._items.length} icon=${tray._icon || '(none)'}`);
    tray._initialized = true;
  },

  // Builder API exposed to the consumer's tray/index.js.
  _buildApi() {
    return {
      icon:    (p) => { tray._icon = path.isAbsolute(p) ? p : path.join(process.cwd(), p); },
      tooltip: (t) => { tray._tooltip = t; },
      item:    (descriptor) => { tray._items.push(descriptor); },
      separator: () => { tray._items.push({ type: 'separator' }); },
      submenu: (label, items) => { tray._items.push({ label, submenu: items }); },
      clear:   () => { tray._items = []; },
    };
  },

  // Render or re-render the Tray + ContextMenu from the current item list.
  _render() {
    if (!tray._electron) return;

    const { Tray, Menu, nativeImage } = tray._electron;
    if (!Tray || !Menu) {
      logger.warn('Tray / Menu not available in this electron build.');
      return;
    }

    if (!tray._icon) {
      logger.warn('no icon set — tray will not be rendered. Call tray.icon(path) in your tray definition.');
      return;
    }

    if (!fs.existsSync(tray._icon)) {
      logger.warn(`tray icon file not found at ${tray._icon} — tray will not be rendered.`);
      return;
    }

    if (!tray._tray) {
      const image = nativeImage.createFromPath(tray._icon);
      tray._tray = new Tray(image);
    } else {
      // Re-render: just swap the icon + menu in place.
      tray._tray.setImage(nativeImage.createFromPath(tray._icon));
    }

    if (tray._tooltip) {
      tray._tray.setToolTip(tray._tooltip);
    }

    const template = tray._items.map((item) => tray._resolveItem(item));
    const menu = Menu.buildFromTemplate(template);
    tray._tray.setContextMenu(menu);
  },

  // Resolve a raw descriptor into an Electron MenuItemConstructorOptions.
  // Functions for label / enabled / visible / checked are evaluated *now*
  // (so refresh() re-evaluates dynamic state).
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
      out.submenu = item.submenu.map((sub) => tray._resolveItem(sub));
    }

    if (typeof item.click === 'function') {
      out.click = (menuItem, browserWindow, event) => {
        try { item.click(menuItem, browserWindow, event); }
        catch (e) { logger.error('item.click handler threw:', e); }
      };
    }

    return out;
  },

  // Public runtime API — for consumers who want to mutate the tray after init.

  // Re-evaluate dynamic labels/enabled/visible and re-render the context menu.
  refresh() {
    tray._render();
  },

  // Replace the entire definition at runtime (e.g. after auth state change).
  define(fn) {
    if (typeof fn !== 'function') {
      throw new Error('tray.define: fn must be a function');
    }
    tray._items = [];
    fn({ manager: tray._manager, tray: tray._buildApi() });
    tray._render();
  },

  // Direct mutators — handy for incremental updates.
  setIcon(p) {
    tray._icon = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    tray._render();
  },
  setTooltip(t) {
    tray._tooltip = t;
    if (tray._tray) tray._tray.setToolTip(t);
  },
  addItem(descriptor) {
    tray._items.push(descriptor);
    tray._render();
  },
  clearItems() {
    tray._items = [];
    tray._render();
  },

  // Inspection helpers (used by tests + consumer diagnostics).
  getItems()   { return tray._items.slice(); },
  getIcon()    { return tray._icon; },
  getTooltip() { return tray._tooltip; },
  isRendered() { return Boolean(tray._tray); },

  // Tear down (used by tests).
  destroy() {
    if (tray._tray && !tray._tray.isDestroyed?.()) {
      try { tray._tray.destroy(); } catch (e) { /* ignore */ }
    }
    tray._tray = null;
    tray._items = [];
    tray._icon = null;
    tray._tooltip = null;
  },
};

module.exports = tray;
