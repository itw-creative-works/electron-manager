// Startup — open-at-login + launch-mode management.
//
// Two independent things this lib controls:
//
// 1. `startup.mode` — how the app launches when the USER opens it directly:
//      normal — default. Dock icon visible on macOS, taskbar entry on Windows.
//      hidden — packaged builds get LSUIElement=true on macOS (zero dock bounce, no
//               dock icon, not in Cmd+Tab). Tray/notifications/networking still work.
//               Consumer surfaces UI later via `manager.windows.create('main')`, which
//               calls app.dock.show() automatically so the icon appears alongside the
//               window. Use this for menubar apps, agent apps, anything that should
//               be invisible until the user explicitly asks for UI.
//
// 2. `startup.openAtLogin` — what the OS does at user login:
//      enabled (default true)     — register the app to auto-launch at login.
//      mode    (default 'hidden') — what mode the app launches in WHEN OS-launched.
//                                   Independent from the user-launch mode above.
//
// EM does NOT auto-create any windows anymore — the consumer's main.js drives that.
// So "isLaunchHidden" no longer needs to gate window creation; we just expose the
// raw mode and let the consumer decide whether to call `manager.windows.create()`.
//
// Detection: macOS sets `getLoginItemSettings().wasOpenedAtLogin = true`. On Windows we
// register the login item with `--em-launched-at-login` arg and check process.argv.
// On Linux there's no standard signal, so we treat all launches as user-launches.

const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('startup');

// Valid startup modes. `tray-only` is now folded into `hidden` (they were always the
// same idea — LSUIElement on macOS — so we collapse to a single name).
const VALID_MODES = ['normal', 'hidden'];
const LOGIN_ARG   = '--em-launched-at-login';   // marker for Windows + Linux login-launch detection

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

    const mode         = startup.getMode();
    const loginEnabled = startup._loginEnabled();
    const loginMode    = startup._loginMode();
    const isDev        = startup._isDev();

    // In dev, force open-at-login OFF regardless of config. And actively UNSET any prior
    // registration so a dev run that previously ran with config:enabled=true doesn't leave
    // electron.app (or worse, a stale dev binary path) trying to launch every login.
    // Otherwise: sync the OS open-at-login flag with config. Pass --em-launched-at-login
    // in args so we can detect login launches reliably on Windows/Linux (macOS exposes
    // wasOpenedAtLogin natively).
    if (startup._electron.app?.setLoginItemSettings) {
      try {
        if (isDev) {
          startup._electron.app.setLoginItemSettings({
            openAtLogin:  false,
            openAsHidden: false,
            args:         [],
          });
        } else {
          startup._electron.app.setLoginItemSettings({
            openAtLogin:  loginEnabled,
            openAsHidden: loginMode === 'hidden',
            args:         loginEnabled ? [LOGIN_ARG] : [],
          });
        }
      } catch (e) {
        logger.error('setLoginItemSettings threw:', e);
      }
    }

    logger.log(`initialize — mode=${mode}, openAtLogin=${isDev ? 'OFF (dev — config ignored)' : `{enabled:${loginEnabled}, mode:${loginMode}}`}, launchedAtLogin=${startup.wasLaunchedAtLogin()}`);
    startup._initialized = true;
  },

  // Dev detection: app.isPackaged is the canonical "are we running a packaged build" flag.
  // Set EM_FORCE_LOGIN_ITEM=1 to override (e.g. for testing the login-item flow in dev intentionally).
  _isDev() {
    if (process.env.EM_FORCE_LOGIN_ITEM === '1') return false;
    try {
      return startup._electron?.app?.isPackaged === false;
    } catch (e) {
      return false;
    }
  },

  // Returns the resolved user-launch mode, defaulting to 'normal' for unknown values.
  getMode() {
    const raw = startup._manager?.config?.startup?.mode || 'normal';
    return VALID_MODES.includes(raw) ? raw : 'normal';
  },

  // openAtLogin block reads. `_loginEnabled` defaults to true; `_loginMode` defaults to 'hidden'.
  _loginEnabled() {
    const v = startup._manager?.config?.startup?.openAtLogin;
    if (typeof v === 'boolean') return v;                          // back-compat for boolean form
    if (v && typeof v === 'object') return v.enabled !== false;    // object form: default true
    return true;                                                   // unset → true (apps open at login by default)
  },

  _loginMode() {
    const v = startup._manager?.config?.startup?.openAtLogin;
    if (v && typeof v === 'object' && VALID_MODES.includes(v.mode)) return v.mode;
    return 'hidden';                                               // default: launch hidden at login
  },

  // True if this launch is hidden — combines user-launch mode (always honored) with
  // login-launch mode (only honored when the app was launched at login). Consumers can
  // read this to decide whether to call manager.windows.create() during boot.
  isLaunchHidden() {
    if (startup.getMode() === 'hidden') return true;
    if (startup.wasLaunchedAtLogin() && startup._loginMode() === 'hidden') return true;
    return false;
  },

  // Did the OS launch us at login (vs the user opening the app directly)?
  // macOS: getLoginItemSettings().wasOpenedAtLogin.
  // Windows/Linux: we registered with LOGIN_ARG, look for it in argv.
  wasLaunchedAtLogin() {
    if (process.argv.includes(LOGIN_ARG)) return true;
    if (process.platform === 'darwin' && startup._electron?.app?.getLoginItemSettings) {
      try {
        return Boolean(startup._electron.app.getLoginItemSettings().wasOpenedAtLogin);
      } catch (e) { /* ignore */ }
    }
    return false;
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

  // Toggle the OS open-at-login flag. Pass a boolean for back-compat, or an object
  // { enabled, mode } to control both. Persists via setLoginItemSettings; does not mutate config.
  // No-op in dev (no packaged build = no point registering electron.app for login-launch).
  setOpenAtLogin(input) {
    if (!startup._electron?.app?.setLoginItemSettings) return;
    if (startup._isDev()) {
      logger.log('setOpenAtLogin ignored — running in dev mode (set EM_FORCE_LOGIN_ITEM=1 to override)');
      return;
    }

    let enabled;
    let openAsHidden;
    if (typeof input === 'boolean') {
      enabled      = input;
      openAsHidden = startup._loginMode() !== 'normal';
    } else if (input && typeof input === 'object') {
      enabled      = input.enabled !== false;
      const mode   = VALID_MODES.includes(input.mode) ? input.mode : startup._loginMode();
      openAsHidden = mode === 'hidden';
    } else {
      enabled      = true;
      openAsHidden = startup._loginMode() !== 'normal';
    }

    try {
      startup._electron.app.setLoginItemSettings({
        openAtLogin:  enabled,
        openAsHidden,
        args:         enabled ? [LOGIN_ARG] : [],
      });
      logger.log(`setOpenAtLogin → enabled=${enabled} openAsHidden=${openAsHidden}`);
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
