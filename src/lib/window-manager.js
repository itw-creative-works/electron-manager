// Window manager — named-window registry over BrowserWindow.
//
// **Lazy creation.** EM does NOT auto-create any windows. Consumers call
// `manager.windows.create('main', opts?)` from their main.js when they want UI
// to surface — typically right after `manager.initialize()` resolves, but may
// be deferred (e.g. agent apps that only show UI when the user clicks the tray).
//
// Defaults baked in (no JSON config required):
//   main      → { width: 1024, height: 720, hideOnClose: true,  view: 'main' }
//   any other → { width: 800,  height: 600, hideOnClose: false, view: name   }
//
// Override at the call site:
//   manager.windows.create('main',     { width: 1280, height: 800 });
//   manager.windows.create('settings', { width: 600,  height: 480 });
//
// `view` resolves to `<projectRoot>/dist/views/<view>/index.html`.
//
// Optional config (only if you need to override defaults persistently):
//   "windows": { "main": { "width": 1280, "height": 800 } }
// — overrides flow into create() unless overridden again at call site.
//
// macOS dock auto-show: when `LSUIElement: true` is baked at build time
// (`startup.mode = 'hidden'`), the app launches with NO dock icon. The first
// time `create()` or `show()` runs, EM calls `app.dock.show()` so the icon
// appears alongside the window.
//
// Bounds persistence: every named window's position + size is saved to storage
// on resize/move/close and restored on the next create(). Disable per-window
// with `persistBounds: false`. Storage key: `windows.<name>.bounds`.

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

    // macOS: when the user clicks the dock icon or double-clicks the running app
    // (e.g. CleanMyMac-style: launches hidden at login as tray-only, but double-clicking
    // opens the main window), surface `main`. We only show — never create — so EM's "no
    // auto-create" contract holds. The consumer is expected to have called
    // `windows.create('main', { show: !startup.isLaunchHidden() })` at boot, which puts
    // the window in the registry but invisible in hidden-mode launches.
    if (process.platform === 'darwin') {
      windowManager._electron.app.on('activate', () => {
        const main = windowManager.get('main');
        if (!main) {
          logger.log('activate (macOS) — no main window in registry; ignoring. (consumer should call windows.create(\'main\', { show: false }) at boot to enable hidden-mode reopen)');
          return;
        }
        logger.log(`activate (macOS) — surfacing main (visible=${main.isVisible()}, minimized=${main.isMinimized()})`);
        if (main.isMinimized()) main.restore();
        windowManager._ensureDockVisible();
        main.show();
        main.focus();
      });
    }

    logger.log('initialize');
  },

  // Public create() — canonical name. Accepts (name, overrides?) so consumers
  // can configure entirely from main.js without touching JSON. Falls through to
  // createNamed which does the heavy lifting.
  async create(name, overrides) {
    return windowManager.createNamed(name, windowManager._manager, overrides);
  },

  // Create or focus a named window. Args:
  //   name      — registry key + default view name + storage key for bounds.
  //   manager   — Manager instance (defaults to the one passed to initialize()).
  //   overrides — optional opts that take precedence over config.windows.<name>.
  async createNamed(name, manager, overrides) {
    manager = manager || windowManager._manager;
    overrides = overrides || {};

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

    // Resolve final per-window config: framework defaults < JSON config < call-site overrides.
    // Defaults are split: `main` gets a wider default + hideOnClose; everything else gets a
    // smaller default + close-actually-closes.
    const isMain = name === 'main';
    const defaults = isMain
      ? { width: 1024, height: 720, view: 'main', hideOnClose: true }
      : { width: 800,  height: 600, view: name,   hideOnClose: false };
    const jsonConfig = manager?.config?.windows?.[name] || {};
    const config = { ...defaults, ...jsonConfig, ...overrides };

    logger.log(`createNamed: building "${name}" (show=${config.show !== false}, hideOnClose=${config.hideOnClose})`);

    const persistBounds = config.persistBounds !== false;
    const appRoot = require('../utils/app-root.js')();
    const viewName = config.view || name;
    // Built outputs live under dist/. window-manager always loads from there;
    // the gulp pipeline produces them.
    const htmlPath = path.join(appRoot, 'dist', 'views', viewName, 'index.html');
    const preloadPath = path.join(appRoot, 'dist', 'preload.bundle.js');

    // Resolve initial bounds: saved bounds (if any + valid + persistBounds enabled)
    // override config defaults. `x` and `y` are passed through from config when set
    // (so call-site overrides like `{ x: 100, y: 100 }` actually take effect).
    const defaultBounds = {
      width:  config.width  || 1024,
      height: config.height || 720,
    };
    if (typeof config.x === 'number') defaultBounds.x = config.x;
    if (typeof config.y === 'number') defaultBounds.y = config.y;
    const savedBounds = persistBounds ? windowManager._loadBounds(name, manager) : null;
    const bounds = savedBounds
      ? windowManager._clampToDisplays(savedBounds)
      : defaultBounds;

    // skipTaskbar is per-window now. The old startup-mode 'tray-only' has been folded
    // into 'hidden' (LSUIElement on macOS) — visibility in the dock is handled by the
    // Info.plist flag, not by skipTaskbar on individual windows.
    const skipTaskbar = config.skipTaskbar === true;

    // Inset titlebar by default. Mac → traffic lights inset into the window, Windows →
    // native min/max/close overlay drawn by the OS in the corner of our chrome region,
    // Linux → native frame (no override). Override per-window via config.windows.<name>.
    //   titleBar: 'inset' (default) | 'native' (frame:true everywhere)
    // Consumers needing finer control (custom overlay color, frame:false everywhere)
    // can pass `electronBuilder`-style options via config.windows.<name>.titleBarOverlay
    // / config.windows.<name>.frame.
    const titleBarMode = config.titleBar || 'inset';
    const isMac        = process.platform === 'darwin';
    const isWin        = process.platform === 'win32';

    const titleBarOpts = {};
    if (titleBarMode === 'inset') {
      if (isMac) {
        titleBarOpts.titleBarStyle = 'hiddenInset';
      } else if (isWin) {
        titleBarOpts.titleBarStyle    = 'hidden';
        titleBarOpts.titleBarOverlay  = config.titleBarOverlay || {
          color:        config.backgroundColor || '#ffffff',
          symbolColor:  '#000000',
          height:       36,
        };
      }
      // Linux → native frame, no override.
    }

    const winOpts = {
      width:  bounds.width,
      height: bounds.height,
      minWidth:  config.minWidth  || 400,
      minHeight: config.minHeight || 300,
      show: false, // flicker prevention — show on ready-to-show
      // Tray-only apps suppress all taskbar/dock representation for their windows.
      skipTaskbar,
      title: config.title || manager?.config?.app?.productName || name,
      backgroundColor: config.backgroundColor || '#ffffff',
      ...titleBarOpts,
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

    // ALL event listeners must attach BEFORE `await loadFile()` below — otherwise the
    // window can be in the registry but missing close/resize/etc. listeners during the
    // ~ms window between BrowserWindow construction and load completion. Boot tests +
    // any code that inspects/interacts with the window via the registry before await
    // resolves would see an inconsistent state.

    // Show when ready (unless config says otherwise).
    win.once('ready-to-show', () => {
      if (config.show !== false) {
        logger.log(`window "${name}": ready-to-show — surfacing`);
        windowManager._ensureDockVisible();
        win.show();
      } else {
        logger.log(`window "${name}": ready-to-show — staying invisible (show:false at create)`);
      }
    });

    // Visibility lifecycle — high-signal for debugging hidden-mode + hide-on-close.
    win.on('show', () => logger.log(`window "${name}": show event`));
    win.on('hide', () => logger.log(`window "${name}": hide event`));
    win.on('focus', () => logger.log(`window "${name}": focus event`));
    win.on('minimize', () => logger.log(`window "${name}": minimize event`));
    win.on('restore', () => logger.log(`window "${name}": restore event`));
    win.on('closed', () => logger.log(`window "${name}": closed (destroyed)`));

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

    // Hide-on-close vs quit-on-close.
    //
    // Default `hideOnClose: true` for the `main` window — Discord-style behavior on
    // every platform (X = hide, real quit only via Cmd+Q / menu Quit / tray Quit /
    // auto-updater install). Other named windows default to `false` (X = close).
    // Consumers override per-window via config.windows.<name>.hideOnClose.
    //
    // Three escape hatches let a close-event ACTUALLY close:
    //   1. `manager._allowQuit` — set by manager.quit({ force: true }) and by the
    //      auto-updater before installNow().
    //   2. `manager._isQuitting` — set by app.on('before-quit'), so any quit path
    //      Electron knows about (Cmd+Q, role:'quit' menu, app.quit() programmatic,
    //      OS shutdown) flows through naturally.
    //   3. `win._emForceClose` — per-window override for one-off "close this for
    //      real" scenarios.
    const hideOnClose = config.hideOnClose === true;

    win.on('close', (event) => {
      const allowQuit  = manager?._allowQuit  === true;
      const isQuitting = manager?._isQuitting === true;
      const force      = win._emForceClose === true;

      if (hideOnClose && !allowQuit && !isQuitting && !force) {
        event.preventDefault();
        logger.log(`window "${name}": close intercepted (hide-on-close) — hiding instead`);
        win.hide();
      } else {
        logger.log(`window "${name}": close allowed (hideOnClose=${hideOnClose}, allowQuit=${allowQuit}, isQuitting=${isQuitting}, force=${force})`);
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

    // Load the HTML *after* all listeners are attached, so the window is fully observable
    // by the time loadFile completes. This also means createNamed's returned promise
    // resolves with a fully-wired window, which is what consumers + tests expect.
    try {
      await win.loadFile(htmlPath);
      logger.log(`createNamed: loaded ${htmlPath} for "${name}"`);
    } catch (e) {
      logger.error(`createNamed: failed to load ${htmlPath}`, e);
    }

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
    logger.log(`show("${name}") — visible=${win.isVisible()} → showing`);
    windowManager._ensureDockVisible();
    win.show();
    win.focus();
  },

  // Internal: make the macOS dock icon appear if it's currently hidden (LSUIElement
  // mode). No-op on Windows/Linux. Idempotent. Called automatically by show()/create()
  // whenever we surface a window — apps that ship with LSUIElement=true (mode='hidden')
  // are completely invisible until UI is requested, then dock + window appear together.
  _ensureDockVisible() {
    if (process.platform !== 'darwin') return;
    const dock = windowManager._electron?.app?.dock;
    if (!dock || typeof dock.show !== 'function') return;
    try {
      // dock.isVisible() exists from Electron 13+; fall back to always-call for older.
      if (typeof dock.isVisible === 'function' && dock.isVisible()) {
        logger.log('_ensureDockVisible — dock already visible');
        return;
      }
      logger.log('_ensureDockVisible — calling dock.show()');
      dock.show();
    } catch (e) {
      logger.warn(`_ensureDockVisible — failed: ${e.message}`);
    }
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
