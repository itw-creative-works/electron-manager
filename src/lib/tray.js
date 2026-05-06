// Tray — file-based tray definition.
//
// EM looks for the consumer's `src/integrations/tray/index.js` and calls it with a builder API:
//
//   // src/integrations/tray/index.js
//   module.exports = ({ manager, tray }) => {
//     tray.icon('src/assets/icons/tray-Template.png');
//     tray.tooltip('MyApp');
//
//     // Start from EM's default template:
//     tray.useDefaults();
//
//     // ...or build from scratch:
//     tray.item({ id: 'open', label: 'Open', click: () => manager.windows.show('main') });
//     tray.separator();
//     tray.item({ id: 'quit', label: 'Quit', click: () => require('electron').app.quit() });
//
//     // Mutate by id (works during definition AND at runtime via `manager.tray.*`):
//     tray.insertAfter('open', { id: 'preferences', label: 'Preferences...', click: ... });
//     tray.update('check-for-updates', { label: 'Updates' });
//     tray.remove('website');
//     tray.hide('website');
//   };
//
// Builder API (during definition):
//   tray.icon(path) / tray.tooltip(text)
//   tray.item(descriptor) / tray.separator() / tray.submenu(label, items)
//   tray.useDefaults()        — populate with EM's default template
//   tray.clear()              — start over
//
// Id-path API (during definition AND at runtime via `manager.tray.*`):
//   .find / .has / .update / .remove / .enable / .show / .hide /
//   .insertBefore / .insertAfter / .appendTo
//
// Items support dynamic labels (function) and dynamic enabled/visible/checked.
// Call `manager.tray.refresh()` after mutating state to re-render the menu.
//
// Default template ids (flat — no `tray/` prefix; the lib namespace is implicit):
//   title              — disabled label showing the app name
//   open               — "Open <app>"
//   check-for-updates  — wired to autoUpdater
//   website            — opens brand.url in external browser (only if configured)
//   quit               — quits the app
//
// Disabling at runtime: call `manager.tray.disable()` from anywhere in main —
// idempotent, tears down any existing Tray + clears items. There is no config
// flag for this; default is "enabled, looks at the conventional path."

const path = require('path');
const fs   = require('fs');
const LoggerLite = require('./logger-lite.js');
const { buildIdApi } = require('./_menu-mixin.js');

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

    if (tray._disabled) {
      logger.log('initialize — disabled via manager.tray.disable() called pre-init');
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

    // Conventional path. No config knob — disable() at runtime if you don't want a tray.
    // appRoot resolves to project dir in dev and asar mount in packaged apps — both contain
    // src/integrations/* (electron-builder's `files: ['**/*']` packs the consumer's src/
    // into the asar), so the existsSync + require below works in both modes.
    const absPath = path.join(require('../utils/app-root.js')(), 'src', 'integrations', 'tray', 'index.js');

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
      logger.log(`no tray definition at ${absPath} — using default template.`);
    }

    // Build the API object the consumer calls.
    const builder = tray._buildBuilder();

    if (tray._definitionFn) {
      try {
        tray._definitionFn({ manager, tray: builder });
      } catch (e) {
        logger.error('tray definition fn threw:', e);
      }
    } else {
      // No file → ship the default template as a sensible baseline.
      tray._items = tray._defaultTemplate();
    }

    // Apply defaults for any field the consumer didn't explicitly set. These ALL fall
    // back to sensible framework defaults so a consumer file is truly optional —
    // someone with no `src/integrations/tray/index.js` still gets a working tray.
    if (!tray._icon)    tray._icon    = tray._defaultIconPath();
    if (!tray._tooltip) tray._tooltip = manager?.config?.app?.productName || 'App';

    // Create the Tray now that items/icon/tooltip are in place.
    tray._render();

    // Reflect current auto-updater state into the tray check-for-updates item if present.
    if (manager?.autoUpdater?._updateTrayItem) {
      try { manager.autoUpdater._updateTrayItem(); } catch (e) { /* ignore */ }
    }

    logger.log(`initialize — items=${tray._items.length} icon=${tray._icon || '(none)'}`);
    tray._initialized = true;
  },

  // Builder exposed to the consumer's tray/index.js. Includes both construction helpers
  // and the full id-path API (so mutations during definition work).
  _buildBuilder() {
    const idApi = buildIdApi({
      getItems: () => tray._items,
      // During definition, render is a no-op — initialize() will render once at the end.
      render: () => {
        if (tray._initialized) tray._render();
      },
      logger,
    });

    return {
      icon:       (p) => { tray._icon = path.isAbsolute(p) ? p : path.join(require('../utils/app-root.js')(), p); },
      tooltip:    (t) => { tray._tooltip = t; },
      item:       (descriptor) => { tray._items.push(descriptor); },
      separator:  () => { tray._items.push({ type: 'separator' }); },
      submenu:    (label, items) => { tray._items.push({ label, submenu: items }); },
      useDefaults: () => { tray._items = tray._defaultTemplate(); },
      clear:      () => { tray._items = []; },
      ...idApi,
    };
  },

  // Resolve the runtime tray icon path. Reads from `<projectRoot>/dist/build/icons/<platform>/`
  // which is populated by `gulp/build-config` using its 3-tier waterfall (consumer config →
  // consumer convention → EM bundled). So at runtime we just consume what build-config
  // already resolved — no need to re-walk the chain (and `__dirname` is unreliable inside
  // webpack-bundled main.bundle.js anyway).
  //
  // For consumers who skip the gulp build (rare — testing scenarios), we also fall back to
  // the consumer convention `<projectRoot>/config/icons/<platform>/<file>` directly, matching
  // tier 2 of the build-time resolver.
  //
  // Returns null if nothing is found (caller logs).
  _defaultIconPath() {
    const platform = process.platform === 'darwin' ? 'macos'
      : process.platform === 'win32' ? 'windows'
      : 'linux';
    const file = platform === 'macos' ? 'trayTemplate.png' : 'tray.png';
    const fallbackFile = 'icon.png'; // tray → app icon if absent

    const projectRoot = require('../utils/app-root.js')();
    const m = tray._manager;

    // 1. Consumer config explicit path.
    const slotKey = `tray${platform === 'macos' ? 'Mac' : platform === 'windows' ? 'Windows' : 'Linux'}`;
    const cfgVal = m?.config?.app?.icons?.[slotKey];
    if (cfgVal && typeof cfgVal === 'string') {
      const abs = path.isAbsolute(cfgVal) ? cfgVal : path.join(projectRoot, cfgVal);
      if (fs.existsSync(abs)) return abs;
    }

    // 2. dist/build/icons — populated by gulp/build-config (consumes the build-time waterfall).
    const linuxFallbackPlatform = platform === 'linux' ? 'windows' : platform;
    const tryDistBuild = (plat, name) => path.join(projectRoot, 'dist', 'build', 'icons', plat, name);
    if (fs.existsSync(tryDistBuild(linuxFallbackPlatform, file))) {
      return tryDistBuild(linuxFallbackPlatform, file);
    }
    // tray slot missing → fall back to app icon.
    if (fs.existsSync(tryDistBuild(linuxFallbackPlatform, fallbackFile))) {
      return tryDistBuild(linuxFallbackPlatform, fallbackFile);
    }

    // 3. Consumer file convention (skipped-build fallback).
    const tryConventional = (name) => path.join(projectRoot, 'config', 'icons', platform, name);
    if (fs.existsSync(tryConventional(file))) return tryConventional(file);
    if (fs.existsSync(tryConventional(fallbackFile))) return tryConventional(fallbackFile);

    return null;
  },

  // Default template — id-tagged so consumers can target each item.
  _defaultTemplate() {
    const m = tray._manager;
    const productName = m?.config?.app?.productName || 'App';
    const brandUrl    = m?.config?.brand?.url || null;

    const items = [
      { id: 'title', label: productName, enabled: false },
      { type: 'separator' },
      {
        id: 'open',
        label: `Open ${productName}`,
        click: () => {
          if (m?.windows?.show) m.windows.show('main');
        },
      },
      {
        id: 'check-for-updates',
        label: 'Check for Updates...',
        click: () => {
          if (!m || !m.autoUpdater) return;
          const status = m.autoUpdater.getStatus();
          if (status.code === 'downloaded') m.autoUpdater.installNow();
          else m.autoUpdater.checkNow({ userInitiated: true });
        },
      },
    ];

    if (brandUrl) {
      items.push({
        id: 'website',
        label: 'Visit Website',
        click: () => {
          const { shell } = require('electron');
          shell.openExternal(brandUrl);
        },
      });
    }

    items.push({ type: 'separator' });
    items.push({
      id: 'quit',
      label: 'Quit',
      accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Alt+F4',
      click: () => {
        const { app } = require('electron');
        app.quit();
      },
    });

    return items;
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
    const ctxMenu = Menu.buildFromTemplate(template);
    tray._tray.setContextMenu(ctxMenu);
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

  // Public runtime API --------------------------------------------------------

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
    fn({ manager: tray._manager, tray: tray._buildBuilder() });
    tray._render();
  },

  // Direct mutators — handy for incremental updates.
  setIcon(p) {
    tray._icon = path.isAbsolute(p) ? p : path.join(require('../utils/app-root.js')(), p);
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

  // Tear down (used by tests + by `disable()` below).
  destroy() {
    if (tray._tray && !tray._tray.isDestroyed?.()) {
      try { tray._tray.destroy(); } catch (e) { /* ignore */ }
    }
    tray._tray = null;
    tray._items = [];
    tray._icon = null;
    tray._tooltip = null;
  },

  // Disable the tray entirely. Idempotent. Safe to call before OR after initialize:
  //   - Pre-init: marks the lib as disabled, initialize() short-circuits.
  //   - Post-init: tears down the live Tray + clears items.
  // No way to re-enable after disable() — call manager.tray.define() if you want a fresh
  // tray, then it'll re-render on next refresh.
  disable() {
    tray._disabled = true;
    tray._definitionFn = null;
    if (tray._initialized) {
      tray.destroy();
      logger.log('disabled at runtime — Tray torn down');
    }
  },

  isDisabled() { return Boolean(tray._disabled); },
};

// Mix the id-path API onto the singleton so `manager.tray.update(...)` works at runtime.
Object.assign(tray, buildIdApi({
  getItems: () => tray._items,
  render:   () => tray._render(),
  logger,
}));

module.exports = tray;
