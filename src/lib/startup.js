// Startup — open-at-login + launch-mode management.
//
// Modes (config.startup.mode):
//   normal     — default. Main window shows on launch, dock visible.
//   hidden     — dock visible (briefly bounces on macOS launch — unavoidable without LSUIElement),
//                but no window is auto-shown. Consumer calls manager.windows.show() to surface UI.
//   tray-only  — packaged builds get LSUIElement=true in Info.plist (zero dock bounce on macOS).
//                All windows get skipTaskbar: true. App is tray/menubar-resident.
//
// `app.dock.hide()` is called for hidden/tray-only as a runtime fallback (and for dev where the
// packaged plist isn't in effect). The build-time plist injection happens in gulp/build-config.
//
// `app.setLoginItemSettings({ openAtLogin })` syncs the OS open-at-login flag with the config.

const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('startup');

const VALID_MODES = ['normal', 'hidden', 'tray-only'];

const startup = {
  _initialized: false,
  _manager:     null,
  _electron:    null,

  initialize(manager) {
    if (startup._initialized) {
      return;
    }

    startup._manager = manager;

    try {
      startup._electron = require('electron');
    } catch (e) {
      logger.warn(`electron not available — startup running in no-op mode. (${e.message})`);
      startup._initialized = true;
      return;
    }

    const cfg = manager?.config?.startup || {};
    const mode = startup.getMode();
    const openAtLogin = !!cfg.openAtLogin;

    // Sync OS open-at-login with config.
    if (startup._electron.app?.setLoginItemSettings) {
      try {
        startup._electron.app.setLoginItemSettings({ openAtLogin });
      } catch (e) {
        logger.error('setLoginItemSettings threw:', e);
      }
    }

    logger.log(`initialize — mode=${mode} openAtLogin=${openAtLogin}`);
    startup._initialized = true;
  },

  // Returns the resolved mode, defaulting to 'normal' for unknown values.
  getMode() {
    const raw = startup._manager?.config?.startup?.mode || 'normal';
    return VALID_MODES.includes(raw) ? raw : 'normal';
  },

  // True if the app should launch without auto-showing a window.
  isLaunchHidden() {
    const m = startup.getMode();
    return m === 'hidden' || m === 'tray-only';
  },

  // True for tray-only mode — used by window-manager to set skipTaskbar.
  isTrayOnly() {
    return startup.getMode() === 'tray-only';
  },

  // Apply the runtime side of the mode (dock.hide for macOS). Called from main.js
  // BEFORE whenReady so the dock animation is suppressed as early as JS allows.
  // Note: in packaged tray-only builds the plist already prevents the dock entry,
  // so this call is a no-op there. In dev or hidden mode it shaves the visible time.
  applyEarly() {
    if (!startup._electron) return;
    if (process.platform !== 'darwin') return;
    if (!startup.isLaunchHidden()) return;

    try { startup._electron.app?.dock?.hide?.(); }
    catch (e) { /* ignore */ }
  },

  // Public mutators

  setOpenAtLogin(enabled) {
    if (!startup._electron?.app?.setLoginItemSettings) return;
    try {
      startup._electron.app.setLoginItemSettings({ openAtLogin: !!enabled });
      logger.log(`setOpenAtLogin → ${!!enabled}`);
    } catch (e) {
      logger.error('setOpenAtLogin threw:', e);
    }
  },

  // Read the current OS open-at-login state (may differ from config if user changed it
  // via System Settings; useful for keeping a settings UI in sync).
  isOpenAtLogin() {
    if (!startup._electron?.app?.getLoginItemSettings) return null;
    try {
      return Boolean(startup._electron.app.getLoginItemSettings().openAtLogin);
    } catch (e) {
      return null;
    }
  },
};

module.exports = startup;
