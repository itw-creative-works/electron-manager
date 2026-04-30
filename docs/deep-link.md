# Deep Links

Cross-platform deep-link handling that's simple to use and hard to get wrong. EM owns all the OS plumbing (single-instance lock, scheme registration, argv parsing, second-instance routing, focus-on-warm-start) and gives you one unified event API regardless of how the link arrived.

## Config

```jsonc
"deepLinks": {
  "schemes": ["myapp"]      // urls like myapp://...
}
```

EM registers each scheme with the OS via `app.setAsDefaultProtocolClient` so the system routes matching URLs to your app.

## How it works (so you don't have to think about it)

| Platform | Cold-start (app not running) | Warm-start (app already running) |
|---|---|---|
| **macOS** | `app.on('open-url')` — queued before `whenReady`, drained after | `app.on('open-url')` |
| **Windows** | URL appended to `process.argv`; EM extracts it | OS forwards argv to the existing instance via `app.on('second-instance')` |
| **Linux** | Same as Windows | Same as Windows |

EM handles all of these and dispatches them through the same `manager.deepLink.on()` event registry. Your code looks identical regardless of platform or cold/warm start. Single-instance lock is acquired automatically (via `lib/protocol.js`); duplicate launches exit cleanly and forward their argv to the original instance.

## Public API

```js
manager.deepLink.on(pattern, handler)    // register a handler. Returns unsubscribe fn.
manager.deepLink.off(pattern, handler)
manager.deepLink.dispatch(url)           // manually fire (testing, custom triggers)
manager.deepLink.getColdStartUrl()       // the URL the app was launched with, or null
```

## Patterns

```
'auth/token'             // exact match
'user/profile/:id'       // named param → ctx.params.id
'org/:slug/repo/:repo'   // multiple params
'*'                      // wildcard catch-all (only fires when no concrete handler matched)
```

## Handler signature

```js
manager.deepLink.on('user/profile/:id', (ctx) => {
  ctx.url       // 'myapp://user/profile/42?ref=tray'
  ctx.scheme    // 'myapp'
  ctx.route     // 'user/profile/42'
  ctx.pattern   // 'user/profile/:id'
  ctx.params    // { id: '42' }
  ctx.query     // { ref: 'tray' }
  ctx.source    // 'cold-start' | 'warm-start' | 'manual'
  ctx.argv      // process.argv (cold) or second-instance argv (warm)
  ctx.cwd       // working directory
  ctx.handled   // mutable: set true to suppress remaining handlers (including built-ins)
});
```

## Built-in routes

EM ships with handlers for common patterns. They run AFTER consumer handlers, so you can shadow any of them by registering your own handler at the same pattern.

| Route | Default behavior |
|---|---|
| `auth/token` | Calls `manager.webManager.handleAuthToken(query.token)` (used by web-manager auth flow) |
| `app/show` | `manager.windows.show(query.window || 'main')` |
| `app/quit` | `app.quit()` |

### Overriding a built-in

```js
// Replace the built-in app/show with custom logic.
manager.deepLink.on('app/show', (ctx) => {
  if (ctx.query.window === 'admin' && !manager.appState.isAdminUser()) {
    showError('not authorized');
    ctx.handled = true;       // suppress built-in
    return;
  }
  // Otherwise let the built-in run normally.
});
```

## Resolution order

For each incoming URL, EM walks handlers in this order:

1. **Consumer concrete handlers** (any non-wildcard pattern you registered with `.on()`)
2. **Built-in concrete handlers** (`auth/token`, `app/show`, `app/quit`)
3. **Wildcard handlers** (`'*'`) — only if NO concrete handler matched

Setting `ctx.handled = true` in any handler stops the cascade. Within a single tier, handlers fire in registration order. Errors in a handler are caught and logged — they don't stop subsequent handlers.

## Common patterns

### Route to a window + send IPC

```js
manager.deepLink.on('user/profile/:id', (ctx) => {
  manager.windows.show('main');
  manager.windows.get('main').webContents.send('navigate', {
    to: `/profile/${ctx.params.id}`,
  });
});
```

### Catch-all logger

```js
manager.deepLink.on('*', (ctx) => {
  manager.logger.warn(`Unrouted deep link: ${ctx.url}`);
});
```

### Cold-start branching

```js
const coldUrl = manager.deepLink.getColdStartUrl();
if (coldUrl) {
  manager.logger.log(`Launched from deep link: ${coldUrl}`);
  // appState.launchedFromDeepLink() is also set automatically
}
```

### Manually dispatching (e.g. from a tray click)

```js
tray.item({
  label: 'Open Profile',
  click: () => manager.deepLink.dispatch('myapp://user/profile/me'),
});
```

## Single-instance behavior

EM acquires the OS-level single-instance lock during `protocol.initialize()` (boot step 5, before deep-link inits). If another copy of the app is already running:

1. The new instance loses the lock.
2. The OS forwards its argv to the original instance.
3. The new instance's `Manager.initialize()` returns early (after `protocol.hasSingleInstanceLock() === false`).
4. The original instance's `app.on('second-instance')` fires with the new argv.
5. EM extracts the deep-link URL from that argv and dispatches normally — but as `source: 'warm-start'`.
6. EM also focuses the existing main window automatically (consumer can override by registering a route handler that does its own thing).

## Linking with `appState`

When a deep link is detected at cold-start, EM calls `manager.appState.setLaunchedFromDeepLink(true)`. This means:

```js
if (manager.appState.launchedFromDeepLink()) {
  // user clicked a link to launch the app — handle differently than a tray click or login launch
}
```

Combine with `appState.isFirstLaunch()` to detect "first launch via deep link" (e.g. from an onboarding flow on your website).

## Testing

The dispatch pipeline is unit-testable without actually triggering an OS event:

```js
manager.deepLink.dispatch('myapp://auth/token?token=test');
// Fires source='manual'. Handlers run synchronously.
```

See `src/test/suites/main/deep-link.test.js` for the full coverage.

## Implementation notes

- `lib/protocol.js` owns the single-instance lock + scheme registration; `lib/deep-link.js` owns the dispatch pipeline. They're separate modules but tightly coupled.
- On Windows/Linux, scheme registration uses `app.setAsDefaultProtocolClient(scheme, process.execPath, [process.cwd()])` so dev-mode `app.exe scheme://...` invocations work.
- macOS open-url events that arrive before `whenReady` are queued internally and drained on `deepLink.initialize()`.
- Argv extraction walks backward from the end of argv (where the URL typically sits) and matches against registered schemes.
