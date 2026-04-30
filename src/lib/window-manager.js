// Window manager — named-window registry over BrowserWindow.
//
// Purpose: framework default for the common case (named, persistent, integrated windows).
// Consumers can still `new BrowserWindow()` directly for one-off windows; the manager doesn't get in the way.
//
// Common case:
//   await manager.windows.createNamed('settings');
//   manager.windows.show('settings');
//
// Config (in config/electron-manager.json):
//   "windows": {
//     "main":     { "view": "main",     "width": 1024, "height": 720, "show": true,  "hideOnClose": false },
//     "settings": { "view": "settings", "width": 600,  "height": 480, "show": false, "hideOnClose": true  }
//   }
//
// `view` matches a folder under src/views/ (so `view: "main"` loads src/views/main/index.html).
//
// Bounds persistence: every named window's position + size is saved to storage on
// resize/move/close and restored on createNamed. Disable per-window with
// `persistBounds: false` in the window config. Storage key: `windows.<name>.bounds`.

const path = require('path');
const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('window-manager');

const SAVE_DEBOUNCE_MS = 250;

const windowManager = {
  _initialized: false,
  _manager:     null,
  _windows:     {}, // name -> BrowserWindow
  _saveTimers:  {}, // name -> debounce timer
  _electron:    null,

  initialize(manager) {
    windowManager._manager = manager;
    windowManager._initialized = true;

    try {
      windowManager._electron = require('electron');
    } catch (e) {
      logger.warn('electron not available — window-manager running in test mode.');
      return;
    }

    // Quit when all windows close on win/linux. macOS is sticky (apps stay running).
    if (process.platform !== 'darwin') {
      windowManager._electron.app.on('window-all-closed', () => {
        windowManager._electron.app.quit();
      });
    }

    logger.log('initialize');
  },

  // Create or focus a named window.
  async createNamed(name, manager) {
    manager = manager || windowManager._manager;

    // Single-instance dedup
    const existing = windowManager._windows[name];
    if (existing && !existing.isDestroyed()) {
      logger.log(`createNamed: focusing existing window "${name}"`);
      existing.show();
      existing.focus();
      return existing;
    }

    if (!windowManager._electron) {
      logger.warn(`createNamed: electron not available, cannot create "${name}"`);
      return null;
    }

    const { BrowserWindow } = windowManager._electron;
    const config = manager?.config?.windows?.[name] || {};
    const persistBounds = config.persistBounds !== false;
    const projectRoot = process.cwd();
    const viewName = config.view || name;
    // Built outputs live under dist/. window-manager always loads from there;
    // the gulp pipeline produces them.
    const htmlPath = path.join(projectRoot, 'dist', 'views', viewName, 'index.html');
    const preloadPath = path.join(projectRoot, 'dist', 'preload.bundle.js');

    // Resolve initial bounds: saved bounds (if any + valid + persistBounds enabled) override config defaults.
    const defaultBounds = {
      width:  config.width  || 1024,
      height: config.height || 720,
    };
    const savedBounds = persistBounds ? windowManager._loadBounds(name, manager) : null;
    const bounds = savedBounds
      ? windowManager._clampToDisplays(savedBounds)
      : defaultBounds;

    const isTrayOnly = manager?.startup?.isTrayOnly?.() === true;

    const winOpts = {
      width:  bounds.width,
      height: bounds.height,
      minWidth:  config.minWidth  || 400,
      minHeight: config.minHeight || 300,
      show: false, // flicker prevention — show on ready-to-show
      // Tray-only apps suppress all taskbar/dock representation for their windows.
      skipTaskbar: isTrayOnly || config.skipTaskbar === true,
      title: config.title || manager?.config?.app?.productName || name,
      backgroundColor: config.backgroundColor || '#ffffff',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: false, // preload uses require()
        nodeIntegration: false,
        devTools: true,
      },
    };

    if (typeof bounds.x === 'number' && typeof bounds.y === 'number') {
      winOpts.x = bounds.x;
      winOpts.y = bounds.y;
    }

    const win = new BrowserWindow(winOpts);

    windowManager._windows[name] = win;

    // Restore maximized/fullscreen state if it was saved.
    if (persistBounds && savedBounds) {
      if (savedBounds.maximized) win.maximize();
      if (savedBounds.fullscreen) win.setFullScreen(true);
    }

    // Attach the context-menu listener so right-click works in this window.
    if (manager?.contextMenu?.attach) {
      manager.contextMenu.attach(win.webContents);
    }

    // Load the HTML
    try {
      await win.loadFile(htmlPath);
      logger.log(`createNamed: loaded ${htmlPath} for "${name}"`);
    } catch (e) {
      logger.error(`createNamed: failed to load ${htmlPath}`, e);
    }

    // Show when ready (unless config or startup mode says otherwise).
    // - config.show: false  → never auto-show (consumer drives visibility)
    // - hidden / tray-only mode → never auto-show on launch; consumer drives visibility
    win.once('ready-to-show', () => {
      const launchHidden = manager?.startup?.isLaunchHidden?.() === true;
      const shouldShow = config.show !== false && !launchHidden;
      if (shouldShow) {
        win.show();
      }
    });

    // Bounds persistence — save on resize/move/maximize/unmaximize/enter|leave-fullscreen.
    if (persistBounds) {
      const saveDebounced = () => windowManager._scheduleSave(name);
      win.on('resize', saveDebounced);
      win.on('move',   saveDebounced);
      win.on('maximize',          saveDebounced);
      win.on('unmaximize',        saveDebounced);
      win.on('enter-full-screen', saveDebounced);
      win.on('leave-full-screen', saveDebounced);
      // Also flush on close so the final state lands even if a debounce is pending.
      win.on('close', () => windowManager._saveBoundsNow(name));
    }

    // Hide-on-close vs quit-on-close
    win.on('close', (event) => {
      if (config.hideOnClose && !win._emForceClose) {
        event.preventDefault();
        win.hide();
      }
    });

    // Cleanup on real close
    win.on('closed', () => {
      delete windowManager._windows[name];
      if (windowManager._saveTimers[name]) {
        clearTimeout(windowManager._saveTimers[name]);
        delete windowManager._saveTimers[name];
      }
    });

    return win;
  },

  // Bounds persistence ──────────────────────────────────────────────────────────

  _scheduleSave(name) {
    if (windowManager._saveTimers[name]) {
      clearTimeout(windowManager._saveTimers[name]);
    }
    windowManager._saveTimers[name] = setTimeout(() => {
      delete windowManager._saveTimers[name];
      windowManager._saveBoundsNow(name);
    }, SAVE_DEBOUNCE_MS);
  },

  _saveBoundsNow(name) {
    const win = windowManager._windows[name];
    if (!win || win.isDestroyed()) return;

    const storage = windowManager._manager?.storage;
    if (!storage?.set) return;

    // Use getNormalBounds when maximized/fullscreen so we restore to the underlying size on next launch.
    const isMaximized  = win.isMaximized?.()  || false;
    const isFullScreen = win.isFullScreen?.() || false;
    const rawBounds = (isMaximized || isFullScreen) && win.getNormalBounds
      ? win.getNormalBounds()
      : win.getBounds();

    const bounds = {
      x:      rawBounds.x,
      y:      rawBounds.y,
      width:  rawBounds.width,
      height: rawBounds.height,
      maximized:  isMaximized,
      fullscreen: isFullScreen,
    };

    storage.set(`windows.${name}.bounds`, bounds);
  },

  _loadBounds(name, manager) {
    const storage = manager?.storage || windowManager._manager?.storage;
    if (!storage?.get) return null;

    const saved = storage.get(`windows.${name}.bounds`);
    if (!saved || typeof saved !== 'object') return null;
    if (typeof saved.width !== 'number' || typeof saved.height !== 'number') return null;
    if (saved.width < 100 || saved.height < 100) return null; // sanity floor

    return saved;
  },

  // Keep the window on a real display. If saved bounds put the top-left off-screen
  // (monitor unplugged, resolution changed), discard the position and just keep the size.
  _clampToDisplays(bounds) {
    if (!windowManager._electron?.screen) {
      return bounds;
    }

    const out = { ...bounds };

    if (typeof out.x !== 'number' || typeof out.y !== 'number') {
      return out;
    }

    const displays = windowManager._electron.screen.getAllDisplays();
    const onScreen = displays.some((d) => {
      const wa = d.workArea;
      // Require at least 100x50px of overlap with this display so a barely-visible window doesn't pass.
      const overlapX = Math.max(0, Math.min(out.x + out.width,  wa.x + wa.width)  - Math.max(out.x, wa.x));
      const overlapY = Math.max(0, Math.min(out.y + out.height, wa.y + wa.height) - Math.max(out.y, wa.y));
      return overlapX >= 100 && overlapY >= 50;
    });

    if (!onScreen) {
      delete out.x;
      delete out.y;
    }

    return out;
  },

  // Public API ──────────────────────────────────────────────────────────────────

  get(name) {
    const win = windowManager._windows[name];
    if (!win || win.isDestroyed()) {
      return null;
    }
    return win;
  },

  show(name) {
    const win = windowManager.get(name);
    if (!win) {
      logger.warn(`show: no window named "${name}"`);
      return;
    }
    win.show();
    win.focus();
  },

  hide(name) {
    const win = windowManager.get(name);
    if (!win) return;
    win.hide();
  },

  close(name) {
    const win = windowManager.get(name);
    if (!win) return;
    win._emForceClose = true;
    win.close();
  },

  // List all currently-open named windows
  list() {
    return Object.keys(windowManager._windows).filter((name) => {
      const w = windowManager._windows[name];
      return w && !w.isDestroyed();
    });
  },
};

module.exports = windowManager;
