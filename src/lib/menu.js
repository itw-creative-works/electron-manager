// Menu — file-based application menu definition.
//
// EM looks for the consumer's `src/integrations/menu/index.js` and calls it with a builder API:
//
//   // src/integrations/menu/index.js
//   module.exports = ({ manager, menu, defaults }) => {
//     // Use the platform-aware default template as a starting point...
//     menu.useDefaults();
//
//     // ...or build from scratch:
//     menu.menu('File', [
//       { id: 'file/new', label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => manager.windows.show('main') },
//       { type: 'separator' },
//       { role: 'quit' },
//     ]);
//     menu.menu('Edit', [{ role: 'undo' }, { role: 'redo' }]);
//
//     // Mutate by id-path AFTER the structure is in place:
//     menu.insertAfter('main/check-for-updates', { id: 'main/preferences', label: 'Preferences...', click: ... });
//     menu.update('main/check-for-updates', { label: 'Updates' });
//     menu.remove('view/reload');
//     menu.hide('main/services');
//   };
//
// Builder API (during definition):
//   menu.menu(label, items)   // add a top-level menu bar entry
//   menu.useDefaults()        // populate with the platform-appropriate default template
//   menu.clear()              // start over
//   menu.append(item)         // append a top-level descriptor (rare; prefer menu())
//
// Id-path API (during definition AND at runtime via `manager.menu.*`):
//   .find(idPath) / .has(idPath)
//   .update(idPath, patch)        — Object.assign + re-render
//   .remove(idPath)               — splice + re-render
//   .enable(idPath, bool)         — sugar over update
//   .show(idPath, bool) / .hide(idPath)
//   .insertBefore(idPath, item) / .insertAfter(idPath, item)
//   .appendTo(idPath, item)       — push into a submenu
//
// Item descriptors mirror Electron's MenuItemConstructorOptions, plus the same
// dynamic conveniences as tray: label/enabled/visible/checked may be functions,
// click handlers are wrapped to catch errors.
//
// Default template ids (path scheme — `parent/child/...`):
//   main/about, main/check-for-updates, main/preferences, main/services, main/hide,
//   main/hide-others, main/show-all, main/relaunch, main/quit
//   file/close, file/quit
//   edit/undo, edit/redo, edit/cut, edit/copy, edit/paste, edit/paste-and-match-style,
//   edit/delete, edit/select-all
//   view/reload, view/force-reload, view/reset-zoom, view/zoom-in, view/zoom-out,
//   view/toggle-fullscreen
//   view/developer (submenu, dev-mode only): view/developer/toggle-devtools,
//     view/developer/inspect-elements, view/developer/force-reload
//   window/minimize, window/zoom, window/close, window/front
//   help/check-for-updates (win/linux only — mac places it under main/), help/website (when brand.url)
//   development (top-level, dev-mode only): development/open-exe-folder,
//     development/open-user-data, development/open-logs, development/open-app-config,
//     development/test-error
//
// Disabling at runtime: call `manager.menu.disable()` from anywhere in main —
// idempotent, calls Menu.setApplicationMenu(null) (or null on Windows/Linux to hide
// the menu bar). No config flag.

const path = require('path');
const fs   = require('fs');
const LoggerLite = require('./logger-lite.js');
const { buildIdApi } = require('./_menu-mixin.js');

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

    if (menu._disabled) {
      logger.log('initialize — disabled via manager.menu.disable() called pre-init');
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

    // Conventional path. No config knob — disable() at runtime if you don't want a menu.
    // appRoot resolves to project dir in dev and asar mount in packaged apps — both contain
    // src/integrations/* (electron-builder's `files: ['**/*']` packs the consumer's src/
    // into the asar), so the existsSync + require below works in both modes.
    const absPath = path.join(require('../utils/app-root.js')(), 'src', 'integrations', 'menu', 'index.js');

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

    const builder = menu._buildBuilder();

    if (menu._definitionFn) {
      try {
        menu._definitionFn({ manager, menu: builder, defaults: menu._defaultTemplate() });
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

  // Builder exposed to the consumer's definition fn. Includes both construction helpers
  // (menu/append/useDefaults/clear) and the full id-path API (find/update/remove/insertX/etc.)
  // so consumers can mutate during definition, not just at runtime.
  _buildBuilder() {
    const idApi = buildIdApi({
      getItems: () => menu._items,
      // During definition the menu hasn't rendered yet — render is a no-op so we don't
      // double-render between definition mutations. Consumer's done-with-definition hook
      // (initialize) will render once at the end.
      render: () => {
        if (menu._initialized) menu._render();
      },
      logger,
    });

    return {
      menu:        (label, items) => { menu._items.push({ label, submenu: items || [] }); },
      append:      (item)         => { menu._items.push(item); },
      useDefaults: ()             => { menu._items = menu._defaultTemplate(); },
      clear:       ()             => { menu._items = []; },
      ...idApi,
    };
  },

  // Default template — platform-aware. macOS gets the standard app menu prepended.
  // Every item carries a stable path-id so consumers can target it. The set of items
  // is informed by the legacy electron-manager template (preferences, relaunch,
  // dev tools nested under view/developer, top-level development menu).
  _defaultTemplate() {
    const m = menu._manager;
    const isMac        = process.platform === 'darwin';
    const productName  = m?.config?.app?.productName || 'App';
    const brandUrl     = m?.config?.brand?.url || null;
    const brandName    = m?.config?.brand?.name || productName;
    const isDev        = !!(m?.isDevelopment?.());

    // EM's built-in "Check for Updates..." item. Click defaults to invoking auto-updater
    // check; auto-updater hook updates label/enabled dynamically based on status.
    // ID is platform-dependent because the item lives under the App menu on macOS but the
    // Help menu on win/linux — same FUNCTION, different LOCATION → different id-path.
    const updateItem = (idPath) => ({
      id: idPath,
      label: 'Check for Updates...',
      click: () => {
        if (!m || !m.autoUpdater) return;
        const status = m.autoUpdater.getStatus();
        if (status.code === 'downloaded') m.autoUpdater.installNow();
        else m.autoUpdater.checkNow({ userInitiated: true });
      },
    });

    // Preferences — visible:false by default so consumers can flip it on with one
    // line if they have a settings window. (Matches legacy.)
    const preferencesItem = {
      id: 'main/preferences',
      label: 'Preferences...',
      accelerator: 'CommandOrControl+,',
      visible: false,
      click: () => {
        if (m?.windows?.show) m.windows.show('settings');
      },
    };

    // Relaunch — restart the app. Useful escape hatch.
    const relaunchItem = {
      id: 'main/relaunch',
      label: 'Relaunch',
      accelerator: isMac ? 'Command+Option+R' : 'Ctrl+Shift+W',
      click: () => {
        const { app } = require('electron');
        app.relaunch();
        app.exit(0);
      },
    };

    const template = [];

    if (isMac) {
      template.push({
        id: 'main',
        label: productName,
        submenu: [
          { id: 'main/about', role: 'about' },
          updateItem('main/check-for-updates'),
          { type: 'separator' },
          preferencesItem,
          { type: 'separator' },
          { id: 'main/services',     role: 'services' },
          { type: 'separator' },
          { id: 'main/hide',         role: 'hide' },
          { id: 'main/hide-others',  role: 'hideOthers' },
          { id: 'main/show-all',     role: 'unhide' },
          { type: 'separator' },
          relaunchItem,
          { id: 'main/quit', role: 'quit' },
        ],
      });
    }

    template.push({
      id: 'file',
      label: 'File',
      submenu: isMac
        ? [{ id: 'file/close', role: 'close' }]
        : [
          // win/linux: preferences + relaunch live under File since there's no App menu.
          preferencesItem,
          { type: 'separator' },
          relaunchItem,
          { id: 'file/quit', role: 'quit' },
        ],
    });

    template.push({
      id: 'edit',
      label: 'Edit',
      submenu: [
        { id: 'edit/undo',  role: 'undo' },
        { id: 'edit/redo',  role: 'redo' },
        { type: 'separator' },
        { id: 'edit/cut',   role: 'cut' },
        { id: 'edit/copy',  role: 'copy' },
        { id: 'edit/paste', role: 'paste' },
        ...(isMac ? [
          { id: 'edit/paste-and-match-style', role: 'pasteAndMatchStyle' },
          { id: 'edit/delete',                role: 'delete' },
          { id: 'edit/select-all',            role: 'selectAll' },
        ] : [
          { id: 'edit/delete',     role: 'delete' },
          { type: 'separator' },
          { id: 'edit/select-all', role: 'selectAll' },
        ]),
      ],
    });

    // View — basic items always; dev tools nested under view/developer (dev-only).
    const viewSubmenu = [
      { id: 'view/reload',           role: 'reload' },
      { id: 'view/reset-zoom',       role: 'resetZoom' },
      { id: 'view/zoom-in',          role: 'zoomIn' },
      { id: 'view/zoom-out',         role: 'zoomOut' },
      { type: 'separator' },
      { id: 'view/toggle-fullscreen', role: 'togglefullscreen' },
    ];
    if (isDev) {
      viewSubmenu.push({ type: 'separator' });
      viewSubmenu.push({
        id: 'view/developer',
        label: 'Developer',
        submenu: [
          { id: 'view/developer/toggle-devtools',   role: 'toggleDevTools' },
          { id: 'view/developer/inspect-elements', label: 'Inspect Element', accelerator: isMac ? 'Command+Shift+C' : 'Ctrl+Shift+C',
            click: (item, win) => {
              if (win?.webContents) win.webContents.inspectElement(0, 0);
            },
          },
          { id: 'view/developer/force-reload',     role: 'forceReload' },
        ],
      });
    }
    template.push({ id: 'view', label: 'View', submenu: viewSubmenu });

    template.push({
      id: 'window',
      label: 'Window',
      submenu: isMac ? [
        { id: 'window/minimize', role: 'minimize' },
        { id: 'window/zoom',     role: 'zoom' },
        { type: 'separator' },
        { id: 'window/front',    role: 'front' },
      ] : [
        { id: 'window/minimize', role: 'minimize' },
        { id: 'window/close',    role: 'close' },
      ],
    });

    // Help menu — exists on all platforms. On win/linux it carries the updater item;
    // on mac it's optional content only (updater is under App menu). Adds a Visit Website
    // entry when brand.url is configured (mirrors legacy `help/website`).
    const helpSubmenu = [];
    if (!isMac) helpSubmenu.push(updateItem('help/check-for-updates'));
    if (brandUrl) {
      helpSubmenu.push({
        id: 'help/website',
        label: `${brandName} Home`,
        click: () => {
          const { shell } = require('electron');
          shell.openExternal(brandUrl);
        },
      });
    }
    if (helpSubmenu.length > 0) {
      template.push({ id: 'help', label: 'Help', role: 'help', submenu: helpSubmenu });
    }

    // Development — top-level menu, dev mode only. Mirrors legacy with FS shortcuts
    // for inspecting where the app, user data, logs, and update cache live.
    if (isDev) {
      template.push({
        id: 'development',
        label: 'Development',
        submenu: [
          {
            id: 'development/open-exe-folder',
            label: 'Open exe folder',
            click: () => {
              const { app, shell } = require('electron');
              shell.showItemInFolder(app.getPath('exe'));
            },
          },
          {
            id: 'development/open-user-data',
            label: 'Open user data folder',
            click: () => {
              const { app, shell } = require('electron');
              shell.openPath(app.getPath('userData'));
            },
          },
          {
            id: 'development/open-logs',
            label: 'Open logs folder',
            click: () => {
              const { app, shell } = require('electron');
              shell.openPath(app.getPath('logs'));
            },
          },
          {
            id: 'development/open-app-config',
            label: 'Open app config folder',
            click: () => {
              const { app, shell } = require('electron');
              shell.openPath(app.getPath('appData'));
            },
          },
          { type: 'separator' },
          {
            id: 'development/test-error',
            label: 'Throw test error',
            click: () => {
              setTimeout(() => { throw new Error('EM test error (development menu)'); }, 0);
            },
          },
        ],
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

  // Public runtime API ---------------------------------------------------------

  refresh() {
    menu._render();
  },

  define(fn) {
    if (typeof fn !== 'function') {
      throw new Error('menu.define: fn must be a function');
    }
    menu._items = [];
    fn({ manager: menu._manager, menu: menu._buildBuilder(), defaults: menu._defaultTemplate() });
    menu._render();
  },

  // Inspection
  getItems()    { return menu._items.slice(); },
  isRendered()  { return Boolean(menu._menu); },
  getMenu()     { return menu._menu; },

  // Tear down (used by tests + by `disable()`).
  destroy() {
    menu._items = [];
    menu._menu = null;
    if (menu._electron?.Menu?.setApplicationMenu) {
      try { menu._electron.Menu.setApplicationMenu(null); } catch (e) { /* ignore */ }
    }
  },

  // Disable the application menu entirely. Idempotent. Safe pre- or post-init:
  //   - Pre-init: marks the lib as disabled, initialize() short-circuits.
  //   - Post-init: clears items + Menu.setApplicationMenu(null).
  // On Windows/Linux this also hides the menu bar (no menu set → no bar).
  disable() {
    menu._disabled = true;
    menu._definitionFn = null;
    if (menu._initialized) {
      menu.destroy();
      logger.log('disabled at runtime — application menu cleared');
    }
  },

  isDisabled() { return Boolean(menu._disabled); },
};

// Mix the id-path API directly onto the singleton so `manager.menu.update(...)` works at runtime.
Object.assign(menu, buildIdApi({
  getItems: () => menu._items,
  render:   () => menu._render(),
  logger,
}));

module.exports = menu;
