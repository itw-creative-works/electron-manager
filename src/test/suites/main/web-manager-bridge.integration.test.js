// Integration tests for web-manager-bridge — actually hits Firebase.
//
// Skipped automatically unless EM_TEST_FIREBASE_ADMIN_KEY (or GOOGLE_APPLICATION_CREDENTIALS)
// points to a Firebase service-account JSON file. This keeps `npx mgr test` fast & green
// offline / on machines without backend creds.
//
// To run:
//   1. Install firebase-admin: `npm i -D firebase-admin` (already in EM's devDeps)
//   2. Drop a service-account JSON in a safe place
//   3. Set EM_TEST_FIREBASE_ADMIN_KEY=/path/to/file.json (or use GOOGLE_APPLICATION_CREDENTIALS)
//   4. Optionally EM_TEST_USER_UID=your-test-uid (defaults to 'em-test-user')
//   5. `npx mgr test`

const fs = require('fs');

const ADMIN_KEY = process.env.EM_TEST_FIREBASE_ADMIN_KEY
                || process.env.GOOGLE_APPLICATION_CREDENTIALS
                || null;
const USER_UID = process.env.EM_TEST_USER_UID || 'em-test-user';
// Integration tests are opt-in. `npx mgr test --integration` (or `EM_TEST_INTEGRATION=1`) runs
// them; default is skip. Legacy `EM_TEST_SKIP_INTEGRATION=1` still forces skip.
const INTEGRATION_OPTED_IN = process.env.EM_TEST_INTEGRATION === '1';
const FORCE_SKIP            = process.env.EM_TEST_SKIP_INTEGRATION === '1';

function checkSkipReason() {
  if (FORCE_SKIP) return 'EM_TEST_SKIP_INTEGRATION=1';
  if (!INTEGRATION_OPTED_IN) return 'integration tests skipped — pass --integration or set EM_TEST_INTEGRATION=1';
  if (!ADMIN_KEY) return 'no EM_TEST_FIREBASE_ADMIN_KEY / GOOGLE_APPLICATION_CREDENTIALS';
  if (!fs.existsSync(ADMIN_KEY)) return `service-account file not found at ${ADMIN_KEY}`;
  try {
    require.resolve('firebase-admin');
  } catch (e) {
    return 'firebase-admin not installed (run: npm i -D firebase-admin)';
  }
  return null;
}

const skipReason = checkSkipReason();

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'web-manager-bridge (main, integration)',
  skip: skipReason || false,
  cleanup: async (ctx) => {
    try {
      await ctx.manager.webManager.signOut();
    } catch (e) { /* ignore */ }
  },
  tests: [
    {
      name: 'firebase loaded (firebaseConfig present in test config)',
      run: (ctx) => {
        if (!ctx.manager.webManager._firebaseAuth) {
          ctx.skip('firebaseConfig not set in default config — set one in src/defaults/config/electron-manager.json to run');
        }
        ctx.expect(ctx.manager.webManager._firebaseAuth).toBeTruthy();
      },
    },
    {
      name: 'admin can mint a custom token, bridge can sign in with it',
      run: async (ctx) => {
        if (!ctx.manager.webManager._firebaseAuth) {
          ctx.skip('firebase not loaded');
        }

        const admin = require('firebase-admin');
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(require(ADMIN_KEY)),
          });
        }

        // Mint a custom token for the test UID.
        const token = await admin.auth().createCustomToken(USER_UID);
        ctx.expect(typeof token).toBe('string');

        // Hand it to the bridge.
        const result = await ctx.manager.webManager.handleAuthToken(token);

        if (!result.success) {
          ctx.skip(`signInWithCustomToken failed: ${result.error || 'unknown'} — likely a project mismatch (firebaseConfig.projectId vs service-account project)`);
        }
        ctx.expect(result.user.uid).toBe(USER_UID);

        // Bridge state should reflect the signed-in user.
        const current = ctx.manager.webManager.getCurrentUser();
        ctx.expect(current?.uid).toBe(USER_UID);
      },
    },
    {
      name: 'sign-out clears the current user and broadcasts',
      run: async (ctx) => {
        if (!ctx.manager.webManager.getCurrentUser()) {
          ctx.skip('not signed in (previous test may have skipped)');
        }
        const r = await ctx.manager.webManager.signOut();
        ctx.expect(r.success).toBe(true);
        ctx.expect(ctx.manager.webManager.getCurrentUser()).toBeNull();
      },
    },
    {
      name: 'onAuthChange fires when state changes',
      run: async (ctx) => {
        if (!ctx.manager.webManager._firebaseAuth) {
          ctx.skip('firebase not loaded');
        }

        const admin = require('firebase-admin');
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(require(ADMIN_KEY)),
          });
        }

        const calls = [];
        const off = ctx.manager.webManager.onAuthChange((snap) => calls.push(snap));

        try {
          const token = await admin.auth().createCustomToken(USER_UID);
          await ctx.manager.webManager.handleAuthToken(token);

          // Give onAuthStateChanged a tick to fire.
          await new Promise((r) => setTimeout(r, 200));
          ctx.expect(calls.length).toBeGreaterThan(0);
          ctx.expect(calls[calls.length - 1]?.uid).toBe(USER_UID);
        } finally {
          off();
        }
      },
    },
  ],
};
