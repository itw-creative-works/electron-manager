// Main-process tests for lib/web-manager-bridge.js — unit-level coverage that doesn't hit Firebase.
//
// Real Firebase integration tests live in web-manager-bridge.integration.test.js
// (gated on EM_TEST_FIREBASE_ADMIN_KEY presence).

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'web-manager-bridge (main, unit)',
  cleanup: async (ctx) => {
    await ctx.manager.webManager._resetForTests();
  },
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.webManager._initialized).toBe(true);
      },
    },
    {
      name: 'IPC handlers are registered',
      run: (ctx) => {
        ctx.expect(ctx.manager.ipc.hasHandler('em:auth:sync-request')).toBe(true);
        ctx.expect(ctx.manager.ipc.hasHandler('em:auth:sign-out')).toBe(true);
        ctx.expect(ctx.manager.ipc.hasHandler('em:auth:get-user')).toBe(true);
      },
    },
    {
      name: 'getCurrentUser returns null when nothing is signed in',
      run: (ctx) => {
        // The harness boots without auth; either firebase isn't loaded (no firebaseConfig
        // in default config) or it is and there's no user. Either way, currentUser is null.
        ctx.expect(ctx.manager.webManager.getCurrentUser()).toBeNull();
      },
    },
    {
      name: 'handleAuthToken returns no-op result when firebase not loaded',
      run: async (ctx) => {
        // Default config has empty firebaseConfig → firebase fails to init → _firebaseAuth=null.
        if (ctx.manager.webManager._firebaseAuth) {
          ctx.skip('firebase did load (firebaseConfig was set) — covered by integration tests');
        }
        const r = await ctx.manager.webManager.handleAuthToken('whatever');
        ctx.expect(r.success).toBe(false);
        ctx.expect(r.reason).toBe('firebase-not-loaded');
      },
    },
    {
      name: 'handleAuthToken with empty token returns no-token failure',
      run: async (ctx) => {
        // Stub _firebaseAuth so we hit the "no token" branch instead of "firebase-not-loaded."
        const origAuth = ctx.manager.webManager._firebaseAuth;
        ctx.manager.webManager._firebaseAuth = { currentUser: null }; // truthy so we pass the firebase check
        try {
          const r = await ctx.manager.webManager.handleAuthToken('');
          ctx.expect(r.success).toBe(false);
          ctx.expect(r.reason).toBe('no-token');
        } finally {
          ctx.manager.webManager._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: same UID → no sync needed',
      run: async (ctx) => {
        // Stub the auth so we control bgUid.
        const origAuth = ctx.manager.webManager._firebaseAuth;
        ctx.manager.webManager._firebaseAuth = { currentUser: { uid: 'abc' } };
        try {
          const result = await ctx.manager.ipc.invoke('em:auth:sync-request', { contextUid: 'abc' });
          ctx.expect(result.needsSync).toBe(false);
        } finally {
          ctx.manager.webManager._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: main signed out, renderer signed in → tells renderer to sign out',
      run: async (ctx) => {
        const origAuth = ctx.manager.webManager._firebaseAuth;
        ctx.manager.webManager._firebaseAuth = { currentUser: null };
        try {
          const result = await ctx.manager.ipc.invoke('em:auth:sync-request', { contextUid: 'someone' });
          ctx.expect(result.needsSync).toBe(true);
          ctx.expect(result.signOut).toBe(true);
        } finally {
          ctx.manager.webManager._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: firebase not loaded → no sync',
      run: async (ctx) => {
        const origAuth = ctx.manager.webManager._firebaseAuth;
        ctx.manager.webManager._firebaseAuth = null;
        try {
          const result = await ctx.manager.ipc.invoke('em:auth:sync-request', { contextUid: null });
          ctx.expect(result.needsSync).toBe(false);
          ctx.expect(result.reason).toBe('firebase-not-loaded');
        } finally {
          ctx.manager.webManager._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sign-out IPC succeeds when nothing is signed in',
      run: async (ctx) => {
        const result = await ctx.manager.ipc.invoke('em:auth:sign-out');
        ctx.expect(result.success).toBe(true);
      },
    },
    {
      name: 'get-user IPC returns null when no current user',
      run: async (ctx) => {
        const result = await ctx.manager.ipc.invoke('em:auth:get-user');
        ctx.expect(result).toBeNull();
      },
    },
    {
      name: 'onAuthChange returns an unsubscribe fn',
      run: (ctx) => {
        const fn = () => {};
        const off = ctx.manager.webManager.onAuthChange(fn);
        ctx.expect(ctx.manager.webManager._stateSubs.has(fn)).toBe(true);
        off();
        ctx.expect(ctx.manager.webManager._stateSubs.has(fn)).toBe(false);
      },
    },
    {
      name: '_snapshotUser returns the public user shape (no token)',
      run: (ctx) => {
        const snap = ctx.manager.webManager._snapshotUser({
          uid: 'u1',
          email: 'a@b.com',
          displayName: 'Bob',
          photoURL: 'http://x/p.png',
          emailVerified: true,
          // sensitive stuff that should NOT be exposed
          stsTokenManager: { accessToken: 'SECRET' },
          providerData: ['xxx'],
        });
        ctx.expect(snap).toEqual({
          uid: 'u1',
          email: 'a@b.com',
          displayName: 'Bob',
          photoURL: 'http://x/p.png',
          emailVerified: true,
        });
      },
    },
    {
      name: 'deep-link auth/token route is wired to handleAuthToken',
      run: async (ctx) => {
        // We've already tested the deep-link side in deep-link.test.js. Here we verify
        // the integration is actually live: dispatching the route triggers our spy.
        let received = null;
        const orig = ctx.manager.webManager.handleAuthToken;
        ctx.manager.webManager.handleAuthToken = async (token) => {
          received = token;
          return { success: true };
        };
        try {
          ctx.manager.deepLink.dispatch('myapp://auth/token?token=BRIDGE-TEST-TOKEN');
          // Built-in handler is sync up to the await — give it a tick.
          await new Promise((r) => setImmediate(r));
          ctx.expect(received).toBe('BRIDGE-TEST-TOKEN');
        } finally {
          ctx.manager.webManager.handleAuthToken = orig;
        }
      },
    },
  ],
};
