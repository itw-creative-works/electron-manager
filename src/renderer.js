// Renderer-process Manager singleton.
// Consumer entry (per view): `new (require('electron-manager/renderer'))().initialize()`.
// Reads window.EM_BUILD_JSON.config (injected by webpack DefinePlugin), bootstraps web-manager + auth.
//
// Auth bridge:
//   - On init, asks main "I'm at UID X (or null), are we in sync?" via em:auth:sync-request.
//     If main returns a custom token, this renderer calls webManager.auth().signInWithCustomToken(token).
//     If main says "sign out," this renderer signs out.
//   - Listens for em:auth:sign-in-with-token broadcasts (fired when ANY renderer or main signs in)
//     and signs in with the provided token.
//   - Listens for em:auth:sign-out broadcasts and signs out.
//
// Pattern mirrors BXM: main is the source of truth, renderers reflect.

const LoggerLite = require('./lib/logger-lite.js');

function Manager() {
  const self = this;

  self.config = null;
  self.logger = new LoggerLite('renderer');
  self.webManager = null;

  // Bridges exposed by preload contextBridge (window.em.*)
  self.ipc     = (typeof window !== 'undefined' && window.em?.ipc)     || null;
  self.storage = (typeof window !== 'undefined' && window.em?.storage) || null;

  return self;
}

Manager.prototype.initialize = async function (overrides) {
  const self = this;

  // Merge runtime overrides on top of build-time config.
  // EM_BUILD_JSON is injected by webpack DefinePlugin; the BannerPlugin also makes it
  // available on globalThis.EM_BUILD_JSON for DevTools introspection.
  const buildJson = (typeof EM_BUILD_JSON !== 'undefined' && EM_BUILD_JSON) || {};
  self.config = Object.assign({}, buildJson.config || {}, overrides || {});

  self.logger.log('Initializing electron-manager (renderer)...');

  // Boot web-manager so Firebase Auth is available in this renderer.
  try {
    self.webManager = require('web-manager').default || require('web-manager');
    if (self.webManager?.initialize) {
      await self.webManager.initialize(self.config);
    }
  } catch (e) {
    self.logger.warn('web-manager not available — auth bridge running in no-op mode.', e?.message);
  }

  // Wire the auth bridge: sync with main, listen for broadcasts.
  await self._wireAuthBridge();

  self.logger.log('electron-manager (renderer) initialized.');

  return self;
};

// Bridge between renderer's web-manager and main's web-manager-bridge.
// Mirrors BXM's foreground sync logic.
Manager.prototype._wireAuthBridge = async function () {
  const self = this;
  if (!self.ipc) return;

  const auth = self.webManager?.auth?.();
  const getCurrentUid = () => {
    try { return auth?.user?.()?.uid || null; }
    catch (e) { return null; }
  };

  // Listen for sign-in-with-token broadcasts (main signed in via deep link, or another renderer signed in).
  self.ipc.on?.('em:auth:sign-in-with-token', async ({ token }) => {
    if (!token || !auth?.signInWithCustomToken) return;
    try {
      await auth.signInWithCustomToken(token);
      self.logger.log('signed in via broadcast token.');
    } catch (e) {
      self.logger.error('signInWithCustomToken (broadcast) failed:', e?.message);
    }
  });

  // Listen for sign-out broadcasts.
  self.ipc.on?.('em:auth:sign-out', async () => {
    if (!auth?.signOut) return;
    try {
      await auth.signOut();
      self.logger.log('signed out via broadcast.');
    } catch (e) {
      self.logger.error('signOut (broadcast) failed:', e?.message);
    }
  });

  // Sync with main on load. If main has a different state, it'll send back instructions.
  try {
    const result = await self.ipc.invoke?.('em:auth:sync-request', {
      contextUid: getCurrentUid(),
    });

    if (!result?.needsSync) return;

    if (result.signOut && auth?.signOut) {
      await auth.signOut();
      self.logger.log('synced: signed out (main was signed out).');
    } else if (result.customToken && auth?.signInWithCustomToken) {
      await auth.signInWithCustomToken(result.customToken);
      self.logger.log(`synced: signed in as ${result.user?.email || result.user?.uid}.`);
    }
  } catch (e) {
    self.logger.warn('auth sync failed (non-fatal):', e?.message);
  }
};

// Sign-out helper for renderer code (UI button etc.). Goes through main so all
// renderers + main stay in sync via the broadcast.
Manager.prototype.signOut = async function () {
  if (!this.ipc?.invoke) return { success: false, error: 'no-ipc' };
  return this.ipc.invoke('em:auth:sign-out');
};

// Read main's current user (sync answer from main, not the renderer's local Firebase).
Manager.prototype.getMainUser = async function () {
  if (!this.ipc?.invoke) return null;
  return this.ipc.invoke('em:auth:get-user');
};

module.exports = Manager;
