// Web Manager Bridge — main-process Firebase Auth, source of truth for renderers.
//
// This is EM's analogue of BXM's background-service-worker auth role. The pattern:
//
//   1. Main runs its own Firebase Auth instance and is the source of truth.
//   2. When a deep-link auth/token arrives, main calls signInWithCustomToken with that token,
//      then BROADCASTS the token to all renderer windows so their web-manager Firebase
//      instances can sign in with the SAME token.
//   3. On every renderer load, the renderer asks main "I'm at UID X (or null)" via the
//      em:auth:sync-request IPC. Main compares with its own UID and either does nothing,
//      tells the renderer to sign out, or fetches a fresh custom token from /backend-manager
//      and sends it to the renderer.
//   4. Sign-out: any renderer can request sign-out via em:auth:sign-out. Main signs out
//      its own Firebase + broadcasts em:auth:sign-out to all renderers.
//
// Firebase is loaded LAZILY via dynamic import. If `firebase` isn't installed, the bridge
// stays in no-op mode and logs a warning. Consumers who don't need auth pay zero cost.

const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('web-manager-bridge');

const FIREBASE_APP_NAME = 'em-auth';

const bridge = {
  _initialized:    false,
  _manager:        null,
  _firebase:       null,    // firebase/app
  _firebaseAuth:   null,    // auth instance
  _firebaseModule: null,    // firebase/auth namespace (signInWithCustomToken, signOut, ...)
  _stateSubs:      new Set(), // main-side subscribers fn(user)
  _ipcRegistered:  false,

  async initialize(manager) {
    if (bridge._initialized) {
      return;
    }

    bridge._manager = manager;

    // Try to load firebase. If it's not installed, run in no-op mode.
    const ok = await bridge._tryLoadFirebase();
    if (!ok) {
      logger.warn('firebase not installed — web-manager-bridge running in no-op mode. `npm i firebase` to enable auth.');
    }

    bridge._registerIpc();

    if (ok) {
      // Boot Firebase Auth — restores any persisted session from disk.
      try {
        bridge._firebaseAuth = bridge._getFirebaseAuth();
        // onAuthStateChanged is the source of truth listener.
        bridge._firebaseModule.onAuthStateChanged(bridge._firebaseAuth, (user) => {
          bridge._handleAuthStateChange(user);
        });
        logger.log(`initialize — firebase loaded${bridge._firebaseAuth?.currentUser ? ` (restored session: ${bridge._firebaseAuth.currentUser.email})` : ' (no persisted session)'}`);
      } catch (e) {
        logger.error('firebase init failed:', e.message);
      }
    }

    bridge._initialized = true;
  },

  // Try to dynamically import firebase. Returns true on success. The /* webpackIgnore: true */
  // magic comments tell webpack to leave these dynamic imports alone — Node resolves them at
  // runtime via the standard module-resolution algorithm (firebase is the consumer's dep, not EM's).
  async _tryLoadFirebase() {
    try {
      const appMod  = await import(/* webpackIgnore: true */ 'firebase/app');
      const authMod = await import(/* webpackIgnore: true */ 'firebase/auth');

      bridge._firebase       = appMod;
      bridge._firebaseModule = authMod;
      return true;
    } catch (e) {
      return false;
    }
  },

  _getFirebaseAuth() {
    if (bridge._firebaseAuth) return bridge._firebaseAuth;

    const firebaseConfig = bridge._manager?.config?.firebaseConfig;
    if (!firebaseConfig || !Object.keys(firebaseConfig).length) {
      throw new Error('firebaseConfig is empty — cannot initialize auth.');
    }

    const { initializeApp, getApp } = bridge._firebase;
    const { getAuth } = bridge._firebaseModule;

    let app;
    try { app = getApp(FIREBASE_APP_NAME); }
    catch (e) { app = initializeApp(firebaseConfig, FIREBASE_APP_NAME); }

    bridge._firebaseAuth = getAuth(app);
    return bridge._firebaseAuth;
  },

  _registerIpc() {
    if (bridge._ipcRegistered) return;
    const ipc = bridge._manager?.ipc;
    if (!ipc?.handle) return;

    // Renderer asks main: "I'm at UID X (or null). Are we in sync?"
    ipc.handle('em:auth:sync-request', async ({ contextUid }) => {
      return bridge._handleSyncRequest(contextUid);
    });

    // Renderer asks main to sign out.
    ipc.handle('em:auth:sign-out', async () => {
      return bridge._handleSignOut();
    });

    // Renderer asks main for the current user (uid + email + displayName, no token).
    ipc.handle('em:auth:get-user', () => {
      const u = bridge._firebaseAuth?.currentUser;
      return u ? bridge._snapshotUser(u) : null;
    });

    bridge._ipcRegistered = true;
  },

  _handleAuthStateChange(user) {
    logger.log(`auth state → ${user ? user.email : 'signed out'}`);

    // Notify any main-side subscribers (consumer code that called manager.webManager.onAuthChange).
    const snap = user ? bridge._snapshotUser(user) : null;
    bridge._stateSubs.forEach((fn) => {
      try { fn(snap); } catch (e) { logger.error('onAuthChange subscriber threw:', e); }
    });

    // Tell renderers about the change so they can update UI / refresh menu items.
    bridge._manager?.ipc?.broadcast?.('em:auth:state-changed', snap);

    // Attribute Sentry events to the signed-in user (or clear on sign-out).
    try { bridge._manager?.sentry?.setUser?.(snap); } catch (e) { /* sentry off */ }
  },

  // BXM's syncAuth pattern, ported to Electron.
  async _handleSyncRequest(contextUid) {
    if (!bridge._firebaseAuth) {
      return { needsSync: false, reason: 'firebase-not-loaded' };
    }

    const bgUser = bridge._firebaseAuth.currentUser;
    const bgUid = bgUser?.uid || null;

    // Already in sync.
    if (contextUid === bgUid) {
      return { needsSync: false };
    }

    // Renderer signed in but main signed out → tell renderer to sign out.
    if (!bgUser && contextUid) {
      return { needsSync: true, signOut: true };
    }

    // Main signed in, renderer not (or different user) → fetch a fresh custom token + send.
    try {
      const token = await bridge._fetchCustomToken(bgUser);
      return {
        needsSync: true,
        customToken: token,
        user: bridge._snapshotUser(bgUser),
      };
    } catch (e) {
      logger.error('sync-request: failed to fetch custom token:', e.message);
      return { needsSync: false, error: e.message };
    }
  },

  async _handleSignOut() {
    try {
      if (bridge._firebaseAuth?.currentUser) {
        await bridge._firebaseModule.signOut(bridge._firebaseAuth);
      }
      bridge._manager?.ipc?.broadcast?.('em:auth:sign-out', {});
      return { success: true };
    } catch (e) {
      logger.error('sign-out failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  // Public API ──────────────────────────────────────────────────────────────────

  // Called by lib/deep-link's auth/token built-in.
  async handleAuthToken(token) {
    if (!bridge._firebaseAuth) {
      logger.warn('handleAuthToken called but firebase not loaded — ignoring.');
      return { success: false, reason: 'firebase-not-loaded' };
    }
    if (!token) {
      logger.warn('handleAuthToken called with no token — ignoring.');
      return { success: false, reason: 'no-token' };
    }

    try {
      const cred = await bridge._firebaseModule.signInWithCustomToken(bridge._firebaseAuth, token);
      logger.log(`signed in: ${cred.user.email || cred.user.uid}`);

      // Broadcast the token to renderers so they can sign in with the SAME token.
      // Tokens expire in 1 hour and aren't stored.
      bridge._manager?.ipc?.broadcast?.('em:auth:sign-in-with-token', { token });

      return { success: true, user: bridge._snapshotUser(cred.user) };
    } catch (e) {
      logger.error('signInWithCustomToken failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  // Subscribe to auth state changes on the main side (e.g. for menu/tray refresh).
  onAuthChange(fn) {
    bridge._stateSubs.add(fn);
    return () => bridge._stateSubs.delete(fn);
  },

  // Snapshot of the current user (sync), or null.
  getCurrentUser() {
    const u = bridge._firebaseAuth?.currentUser;
    return u ? bridge._snapshotUser(u) : null;
  },

  // Force sign-out from main code.
  async signOut() {
    return bridge._handleSignOut();
  },

  // ─── Internals ────────────────────────────────────────────────────────────

  _snapshotUser(user) {
    return {
      uid:           user.uid,
      email:         user.email,
      displayName:   user.displayName,
      photoURL:      user.photoURL,
      emailVerified: user.emailVerified,
    };
  },

  // Fetch a fresh custom token for the currently-signed-in user.
  // Mirrors BXM: POST <apiUrl>/backend-manager with command 'user:create-custom-token'.
  async _fetchCustomToken(user) {
    const apiUrl = bridge._manager?.getApiUrl?.();
    if (!apiUrl) {
      throw new Error('manager.getApiUrl() not available — cannot fetch custom token.');
    }

    const idToken = await user.getIdToken(true);

    const res = await fetch(`${apiUrl}/backend-manager`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        command: 'user:create-custom-token',
        payload: {},
      }),
    });

    if (!res.ok) {
      throw new Error(`backend-manager responded with ${res.status}`);
    }

    const data = await res.json();
    const token = data?.response?.token;
    if (!token) {
      throw new Error('backend-manager response missing token.');
    }
    return token;
  },

  // Tear-down used by tests — wipes state but keeps registered IPC handlers
  // (they're idempotent via `ipc.handle` duplicate-detection).
  async _resetForTests() {
    try {
      if (bridge._firebaseAuth?.currentUser && bridge._firebaseModule?.signOut) {
        await bridge._firebaseModule.signOut(bridge._firebaseAuth);
      }
    } catch (e) { /* ignore */ }
    bridge._stateSubs.clear();
  },
};

module.exports = bridge;
