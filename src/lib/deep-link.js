// Deep Link — unified cross-platform deep-link handler.
//
// Cross-platform plumbing handled internally:
//   - macOS: the OS routes `<scheme>://...` URLs via `app.on('open-url')`. Cold-start opens may queue
//            them before whenReady; we drain them after.
//   - Windows/Linux: deep links arrive as the LAST entry in `process.argv` on cold-start, and as the
//            `argv` arg of `app.on('second-instance')` on warm-start.
//
// Public API on manager.deepLink:
//
//   manager.deepLink.on(routeOrPattern, fn)    // register a handler. Returns unsubscribe fn.
//   manager.deepLink.off(routeOrPattern, fn)
//   manager.deepLink.dispatch(url)             // manually fire (for testing or custom triggers)
//   manager.deepLink.getColdStartUrl()         // the deep-link URL the app was launched with, or null
//
// Handler signature:
//
//   manager.deepLink.on('user/profile/:id', (ctx) => {
//     ctx.url      // 'myapp://user/profile/42?ref=abc'
//     ctx.scheme   // 'myapp'
//     ctx.route    // 'user/profile/42'
//     ctx.pattern  // 'user/profile/:id' — the matching pattern
//     ctx.params   // { id: '42' }
//     ctx.query    // { ref: 'abc' }
//     ctx.source   // 'cold-start' | 'warm-start' | 'manual'
//     ctx.argv     // process.argv (cold) or second-instance argv
//     ctx.cwd      // process.cwd() or second-instance cwd
//     ctx.handled  // mutate: set true to suppress fall-through to '*' catch-all
//   });
//
// Patterns:
//   - Exact: 'auth/token'
//   - Param: 'user/profile/:id', 'org/:slug/repo/:repo'
//   - Wildcard: '*' (catch-all, runs only if no concrete handler claimed the event)
//
// Multiple handlers per pattern run in registration order. Setting ctx.handled = true stops
// the fall-through to wildcard handlers (concrete-pattern handlers always run).
//
// Built-in routes (registered by EM, can be overridden by registering your own handler):
//   auth/token   → manager.webManager.handleAuthToken(query.token)  [Pass 2.12 wires this up]
//   app/show     → manager.windows.show(query.window || 'main')
//   app/quit     → app.quit()
//
// Built-in handlers run AFTER consumer handlers, so a consumer can shadow any built-in
// by registering their own handler for the same route and setting ctx.handled = true.

const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('deep-link');

const deepLink = {
  _initialized:    false,
  _manager:        null,
  _electron:       null,
  _handlers:       [],          // [{ pattern, fn, builtin: bool }]
  _coldStartUrl:   null,        // the URL the app was launched with (if any)
  _wired:          false,       // open-url + second-instance + queueing wired?
  _pendingUrls:    [],          // urls received before whenReady — drained on init

  initialize(manager) {
    if (deepLink._initialized) {
      return;
    }

    deepLink._manager = manager;

    try {
      deepLink._electron = require('electron');
    } catch (e) {
      logger.warn(`electron not available — deep-link running in no-op mode. (${e.message})`);
      deepLink._initialized = true;
      return;
    }

    deepLink._wireElectronEvents();
    deepLink._registerBuiltins();

    // Cold-start argv parse. On Windows/Linux the deep link arrives in argv;
    // on macOS it arrives via open-url (already wired above).
    const coldUrl = deepLink._extractUrlFromArgv(process.argv);
    if (coldUrl) {
      deepLink._coldStartUrl = coldUrl;
      manager.appState?.setLaunchedFromDeepLink?.(true);
      // Defer dispatch so the rest of init can finish.
      setImmediate(() => deepLink._handle(coldUrl, 'cold-start', { argv: process.argv, cwd: process.cwd() }));
    }

    // Drain anything that came in via open-url before initialize ran.
    if (deepLink._pendingUrls.length > 0) {
      const urls = deepLink._pendingUrls.slice();
      deepLink._pendingUrls = [];
      if (!deepLink._coldStartUrl) {
        deepLink._coldStartUrl = urls[0];
        manager.appState?.setLaunchedFromDeepLink?.(true);
      }
      urls.forEach((u) => setImmediate(() => deepLink._handle(u, 'cold-start', { argv: process.argv, cwd: process.cwd() })));
    }

    logger.log(`initialize — coldStartUrl=${deepLink._coldStartUrl || '(none)'} handlers=${deepLink._handlers.length}`);
    deepLink._initialized = true;
  },

  _wireElectronEvents() {
    if (deepLink._wired) return;
    deepLink._wired = true;

    const { app } = deepLink._electron || {};
    if (!app) return;

    // macOS: open-url. Fires for both cold-start and warm-start opens.
    app.on('open-url', (event, url) => {
      event.preventDefault();
      // Before whenReady: queue.
      if (!app.isReady()) {
        deepLink._pendingUrls.push(url);
        return;
      }
      // Post-whenReady: dispatch as warm-start (the app is already running).
      deepLink._handle(url, 'warm-start', { argv: process.argv, cwd: process.cwd() });
    });

    // Windows/Linux warm-start: another instance launched with our scheme. The OS gave
    // us the lock, killed the duplicate, and forwarded its argv here.
    app.on('second-instance', (_event, argv, cwd) => {
      // Focus the existing main window if present (standard pattern; consumer can override
      // by registering a handler for the route and calling whatever they want).
      const main = deepLink._manager?.windows?.get?.('main');
      if (main) {
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
      }

      const url = deepLink._extractUrlFromArgv(argv);
      if (url) {
        deepLink._handle(url, 'warm-start', { argv, cwd });
      }
    });
  },

  _registerBuiltins() {
    // auth/token — hand off to web-manager-bridge (Pass 2.12 fills in the actual call).
    deepLink._handlers.push({
      pattern: 'auth/token',
      builtin: true,
      fn: (ctx) => {
        const token = ctx.query?.token;
        if (!token) {
          logger.warn('auth/token: no token in query string.');
          return;
        }
        const bridge = deepLink._manager?.webManager;
        if (bridge?.handleAuthToken) {
          bridge.handleAuthToken(token);
        } else {
          logger.warn('auth/token received but web-manager-bridge.handleAuthToken not available yet (Pass 2.12 wires this).');
        }
      },
    });

    // app/show — surface a named window.
    deepLink._handlers.push({
      pattern: 'app/show',
      builtin: true,
      fn: (ctx) => {
        const name = ctx.query?.window || 'main';
        deepLink._manager?.windows?.show?.(name);
      },
    });

    // app/quit — graceful quit.
    deepLink._handlers.push({
      pattern: 'app/quit',
      builtin: true,
      fn: () => {
        deepLink._electron?.app?.quit?.();
      },
    });
  },

  // Pull a `<scheme>://...` URL out of an argv array. Returns null if none of our schemes match.
  _extractUrlFromArgv(argv) {
    if (!Array.isArray(argv)) return null;
    const schemes = deepLink._manager?.protocol?.getSchemes?.() || [];
    if (schemes.length === 0) return null;

    // Walk argv backward — the URL is typically the last meaningful arg.
    for (let i = argv.length - 1; i >= 0; i -= 1) {
      const a = argv[i];
      if (typeof a !== 'string') continue;
      if (schemes.some((s) => a.startsWith(`${s}://`))) {
        return a;
      }
    }
    return null;
  },

  // Parse a `<scheme>://route?query` URL into a route object.
  _parseUrl(url) {
    try {
      const u = new URL(url);
      const scheme = u.protocol.replace(/:$/, '');
      // host + pathname together form the "route." Strip leading/trailing slashes.
      // myapp://auth/token        → host='auth', pathname='/token' → route='auth/token'
      // myapp://user/profile/42   → host='user', pathname='/profile/42' → route='user/profile/42'
      const host = u.host || u.hostname || '';
      const path = (u.pathname || '').replace(/^\/+|\/+$/g, '');
      const route = [host, path].filter(Boolean).join('/');

      const query = {};
      u.searchParams.forEach((v, k) => { query[k] = v; });

      return { scheme, route, query };
    } catch (e) {
      logger.warn(`failed to parse URL "${url}":`, e.message);
      return null;
    }
  },

  // Match a parsed route against a registered pattern. Returns the params object on match,
  // or null on miss. Wildcard '*' matches anything and yields {}.
  _matchPattern(route, pattern) {
    if (pattern === '*') return {};
    const pParts = pattern.split('/');
    const rParts = route.split('/');
    if (pParts.length !== rParts.length) return null;

    const params = {};
    for (let i = 0; i < pParts.length; i += 1) {
      const p = pParts[i];
      const r = rParts[i];
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(r);
      } else if (p !== r) {
        return null;
      }
    }
    return params;
  },

  // Run the dispatch pipeline for a single URL.
  _handle(url, source, env) {
    const parsed = deepLink._parseUrl(url);
    if (!parsed) return;

    logger.log(`dispatch — source=${source} scheme=${parsed.scheme} route=${parsed.route}`);

    // Concrete (non-wildcard) handlers first, in registration order. Consumer concrete handlers
    // are appended in registration order; built-in handlers were registered first by EM, so
    // they run last among concrete handlers — meaning a consumer concrete handler runs BEFORE
    // EM's built-in for the same route. To shadow a built-in entirely, the consumer sets
    // ctx.handled = true.
    //
    // We split into concrete + wildcard so wildcards never run if any concrete handler matched.
    const concrete = deepLink._handlers.filter((h) => h.pattern !== '*');
    const wild     = deepLink._handlers.filter((h) => h.pattern === '*');

    // Re-order: consumer concrete handlers BEFORE built-ins of the same pattern, regardless of
    // registration order. We do this by partitioning by builtin flag.
    const consumerConcrete = concrete.filter((h) => !h.builtin);
    const builtinConcrete  = concrete.filter((h) =>  h.builtin);
    const ordered = [...consumerConcrete, ...builtinConcrete];

    let matched = false;
    let claimed = false;

    for (const h of ordered) {
      const params = deepLink._matchPattern(parsed.route, h.pattern);
      if (params == null) continue;
      matched = true;

      const ctx = {
        url,
        scheme:  parsed.scheme,
        route:   parsed.route,
        pattern: h.pattern,
        params,
        query:   parsed.query,
        source,
        argv:    env?.argv || process.argv,
        cwd:     env?.cwd  || process.cwd(),
        handled: false,
      };

      try {
        h.fn(ctx);
      } catch (e) {
        logger.error(`handler for "${h.pattern}" threw:`, e);
      }

      if (ctx.handled) {
        claimed = true;
        break;
      }
    }

    // Wildcards run only if NO concrete handler matched (not even a built-in).
    if (!matched && !claimed) {
      for (const h of wild) {
        const ctx = {
          url,
          scheme:  parsed.scheme,
          route:   parsed.route,
          pattern: '*',
          params:  {},
          query:   parsed.query,
          source,
          argv:    env?.argv || process.argv,
          cwd:     env?.cwd  || process.cwd(),
          handled: false,
        };
        try { h.fn(ctx); }
        catch (e) { logger.error('wildcard handler threw:', e); }
      }
    }
  },

  // Public API ──────────────────────────────────────────────────────────────────

  on(pattern, fn) {
    if (typeof pattern !== 'string' || !pattern) {
      throw new Error('deepLink.on: pattern must be a non-empty string');
    }
    if (typeof fn !== 'function') {
      throw new Error('deepLink.on: fn must be a function');
    }
    deepLink._handlers.push({ pattern, fn, builtin: false });
    return () => deepLink.off(pattern, fn);
  },

  off(pattern, fn) {
    deepLink._handlers = deepLink._handlers.filter((h) => !(h.pattern === pattern && h.fn === fn));
  },

  dispatch(url) {
    deepLink._handle(url, 'manual', { argv: process.argv, cwd: process.cwd() });
  },

  getColdStartUrl() {
    return deepLink._coldStartUrl;
  },

  // Inspection (used by tests).
  getHandlers() {
    return deepLink._handlers.slice();
  },
};

module.exports = deepLink;
