# Web Manager Bridge — Auth State Sync

EM keeps Firebase auth state in sync across all processes (main + every renderer window). The pattern mirrors BXM's background/foreground architecture: **main is the source of truth**, renderers reflect.

## Why this exists

In Electron, you can't just initialize Firebase in the renderer and forget about it:

- Multiple renderer windows would each have their own Firebase instance with no coordination.
- Main-process code (tray, menu, deep-link routes) needs to know who's signed in.
- A deep-link auth-token (`myapp://auth/token?token=...`) arrives in main, but the user's UI lives in the renderer — somebody has to bridge them.

The bridge handles all three.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│  MAIN (web-manager-bridge.js)                               │
│  - Owns Firebase Auth instance ("em-auth" app)              │
│  - Source of truth for auth state                           │
│  - Listens for em:auth:* IPC from renderers                 │
│  - Broadcasts em:auth:* IPC to all renderers on changes     │
└─────────────────────────────────────────────────────────────┘
              ▲                     │ broadcasts
              │ sync-request        ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│  RENDERER (window 1)     │  │  RENDERER (window 2)     │
│  web-manager + Firebase  │  │  web-manager + Firebase  │
└──────────────────────────┘  └──────────────────────────┘
```

### Auth flow: deep-link → all processes signed in

1. User signs in on the website. Web-manager generates a custom token. Website opens `myapp://auth/token?token=XYZ` (deep link).
2. EM's deep-link `auth/token` built-in fires `manager.webManager.handleAuthToken(token)`.
3. Main calls `signInWithCustomToken(auth, token)` against its own Firebase Auth → main is now signed in.
4. Main broadcasts `em:auth:sign-in-with-token` IPC with the same token to all renderer windows.
5. Each renderer receives the broadcast, calls `webManager.auth().signInWithCustomToken(token)` against its own (web-manager-managed) Firebase Auth → all renderers signed in with the same user.
6. Tokens are NOT stored — they expire in 1 hour. Auth state persists via Firebase's built-in IndexedDB persistence.

### Auth flow: renderer load → sync with main

When a renderer window opens (cold or warm), it asks main for the current state:

1. Renderer sends `em:auth:sync-request` IPC with its current UID (or null).
2. Main compares with its own UID:
   - **Same UID** → no sync needed, returns `{ needsSync: false }`.
   - **Main signed out, renderer signed in** → returns `{ needsSync: true, signOut: true }`. Renderer signs out.
   - **Main signed in, renderer not (or different user)** → main fetches a fresh custom token from `${apiUrl}/backend-manager` (command `user:create-custom-token`) and returns `{ needsSync: true, customToken, user }`. Renderer signs in with that token.

### Sign-out flow

Any renderer (or main code) calls `manager.webManager.signOut()`:

1. Main signs out its own Firebase.
2. Main broadcasts `em:auth:sign-out` IPC to all renderers.
3. Each renderer signs out its own Firebase.

## Public API

### Main process (`manager.webManager`)

```js
// Sign in via a custom token (called automatically by the auth/token deep-link route).
await manager.webManager.handleAuthToken(token);

// Read the currently signed-in user (snapshot, no sensitive fields).
manager.webManager.getCurrentUser();
//   → { uid, email, displayName, photoURL, emailVerified } | null

// Subscribe to auth state changes (e.g. to refresh tray/menu items).
const off = manager.webManager.onAuthChange((user) => {
  manager.tray.refresh();
  manager.menu.refresh();
});
off();   // unsubscribe

// Sign out from any process.
await manager.webManager.signOut();
```

### Renderer process (the EM Manager you `initialize()`)

```js
// Read the user from main (always returns main's authoritative state).
const user = await renderer.getMainUser();

// Sign out (goes through main; broadcasts to all other renderers).
await renderer.signOut();
```

The renderer's `Manager.initialize()` automatically:
- Boots web-manager (so renderer-side Firebase is available).
- Wires the auth bridge (`em:auth:sync-request` on load + listens for broadcasts).

You don't write any of this — it just works.

## Config

```jsonc
{
  "firebaseConfig": {
    "apiKey":            "...",
    "authDomain":        "myapp.firebaseapp.com",
    "projectId":         "myapp",
    // ... etc.
  }
}
```

If `firebaseConfig` is empty/missing, the bridge logs a warning and runs in no-op mode (everything returns harmless defaults).

## Firebase as a peer dep

Firebase is **not bundled** in EM — consumers who don't need auth pay zero cost. EM lazy-loads `firebase/app` and `firebase/auth` via dynamic `import()`. Web-manager (your renderer auth library) already pulls firebase in transitively, so consumers using EM's auth bridge get firebase via web-manager.

If you're building a no-auth Electron app and don't want firebase at all, just leave `firebaseConfig` empty — the bridge is a clean no-op.

## Common patterns

### Refresh tray when auth state changes

```js
// In src/tray/index.js or wherever you have access to manager:
manager.webManager.onAuthChange((user) => {
  manager.tray.refresh();   // re-evaluates dynamic labels
});
```

```js
// In src/tray/index.js:
tray.item({
  label: () => {
    const user = manager.webManager.getCurrentUser();
    return user ? `Signed in as ${user.email}` : 'Sign in';
  },
  click: () => {
    if (manager.webManager.getCurrentUser()) {
      manager.webManager.signOut();
    } else {
      require('electron').shell.openExternal(`${manager.config.brand.url}/sign-in?em=true`);
    }
  },
});
```

### Gate a deep-link route on auth

```js
manager.deepLink.on('user/profile/:id', (ctx) => {
  if (!manager.webManager.getCurrentUser()) {
    require('electron').shell.openExternal(`${manager.config.brand.url}/sign-in?return=profile/${ctx.params.id}`);
    ctx.handled = true;
    return;
  }
  manager.windows.show('main');
  manager.windows.get('main').webContents.send('navigate', { to: `/profile/${ctx.params.id}` });
});
```

### Sign-out button in a renderer

```html
<button id="signout">Sign out</button>
<script>
  document.getElementById('signout').addEventListener('click', async () => {
    await emManager.signOut();   // goes through main, propagates everywhere
  });
</script>
```

## IPC channels

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `em:auth:sync-request` | renderer → main | `{ contextUid }` | "I'm at this UID, are we in sync?" |
| `em:auth:sign-out` | renderer → main | (none) | "Sign me (and everyone) out." |
| `em:auth:get-user` | renderer → main | (none) | Read main's current user. |
| `em:auth:sign-in-with-token` | main → all renderers | `{ token }` | "Sign in with this custom token now." |
| `em:auth:sign-out` | main → all renderers | `{}` | "Sign out now." |
| `em:auth:state-changed` | main → all renderers | `{ uid, email, ... } \| null` | Auth state changed (informational). |

## Testing

### Unit tests (always run)

`web-manager-bridge.test.js` covers the dispatch logic, IPC handler shape, sync-request comparison, and the `auth/token` deep-link integration — all without hitting Firebase.

### Integration tests (skip without creds)

`web-manager-bridge.integration.test.js` actually mints custom tokens via `firebase-admin` and signs in. To run:

```bash
npm i -D firebase-admin                                   # already in EM's devDeps
export EM_TEST_FIREBASE_ADMIN_KEY=/path/to/service-account.json
export EM_TEST_USER_UID=em-test-user                      # optional, defaults to em-test-user
npx mgr test
```

If `EM_TEST_FIREBASE_ADMIN_KEY` (or `GOOGLE_APPLICATION_CREDENTIALS`) isn't set, the suite skips cleanly with a clear reason. CI without creds → tests stay green.

`EM_TEST_SKIP_INTEGRATION=1` forces skip even when creds are present.

## Implementation notes

- Firebase app name in main is `em-auth` (avoids clashes if a consumer's main code also wants its own Firebase instance).
- The bridge does NOT persist user info to EM storage — Firebase's IndexedDB persistence handles session restoration. Matches BXM.
- Custom tokens are NEVER stored. Renderers receive them once via broadcast, sign in, discard. Fresh tokens are minted on demand from `/backend-manager` with command `user:create-custom-token`.
- `manager.getApiUrl()` (already on main Manager) returns the dev or prod URL, so the bridge automatically hits the right backend.
- All sensitive Firebase user fields (`stsTokenManager`, `providerData`, etc.) are stripped before sending over IPC. Only `{uid, email, displayName, photoURL, emailVerified}` cross the bridge.
