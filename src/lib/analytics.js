// Analytics — GA4 via Measurement Protocol. Mirrors BEM's
// `Manager.config.analytics.providers.google.id` shape so the same person can be
// tracked across desktop (EM) + web (UJM/web-manager) + backend (BEM) by
// referencing a single namespaced UUIDv5 identity.
//
// Cross-platform identity (the key feature):
//   client_id = uuidv5(deviceId, namespace)    // anonymous-but-stable per device
//   user_id   = uuidv5(firebaseUid, namespace) // same human across all surfaces
//
// `namespace` is the consumer's `firebaseConfig.projectId` re-encoded as a UUIDv5
// namespace via uuidv5.URL of the projectId string. Same projectId in BEM/web-manager/EM
// → identical uuidv5 outputs everywhere → unified analytics.
//
// Anonymous (web-manager-bridge hasn't reported auth yet) → user_id stays null.
// Authed (auth event fires) → user_id is set + a `login` event is dispatched. On
// logout → user_id clears + `logout` event fires.
//
// API surface:
//   manager.analytics.event(name, params?)         // generic event
//   manager.analytics.pageview(path?)              // convenience wrapper
//   manager.analytics.screenview(name?)            // convenience wrapper
//   manager.analytics.setUserId(uid)               // manual override; auto-wired to webManager
//   manager.analytics.setUserProperties(props)     // merge into user_properties block
//
// Events fired during normal operation are queued until init completes (we need
// context.session + measurement_id + secret). Once initialized, the queue
// flushes and subsequent calls send immediately.
//
// Config:
//   analytics: {
//     enabled: true,                                   // default true
//     providers: {
//       google: {
//         id: 'G-XXXXXXXXXX',                          // Measurement ID (REQUIRED)
//       },
//     },
//   }
//
// Secret comes from `process.env.GOOGLE_ANALYTICS_SECRET` (matches BEM). Webpack's
// DefinePlugin injects it at build time so packaged apps don't need .env at runtime.
// Without the secret, the module logs a warning + becomes a no-op.

const crypto     = require('crypto');
const LoggerLite = require('./logger-lite.js');
const fetch      = require('wonderful-fetch');
const { v5: uuidv5, NIL: UUID_NIL } = require('uuid');

const logger = new LoggerLite('analytics');

const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const FETCH_TIMEOUT_MS = 30 * 1000;
const MAX_QUEUE = 200;

const analytics = {
  _initialized:  false,
  _manager:      null,
  _enabled:      false,
  _measurementId: null,
  _apiSecret:    null,
  _namespace:    null,
  _clientId:     null,    // uuidv5(deviceId, namespace) — set on init
  _userId:       null,    // uuidv5(firebaseUid, namespace) — set on auth
  _userProperties: {},
  _queue:        [],
  _authUnsub:    null,

  initialize(manager) {
    if (analytics._initialized) return;
    analytics._initialized = true;
    analytics._manager = manager;

    const cfg = manager?.config?.analytics || {};
    analytics._enabled = cfg.enabled !== false;       // default true

    if (!analytics._enabled) {
      logger.log('analytics disabled via config.analytics.enabled=false');
      return;
    }

    analytics._measurementId = cfg?.providers?.google?.id || null;
    // Secret comes from env. In packaged builds, webpack's DefinePlugin replaces
    // `process.env.GOOGLE_ANALYTICS_SECRET` with the build-time literal so the
    // packaged app has it baked in without shipping .env.
    analytics._apiSecret = process.env.GOOGLE_ANALYTICS_SECRET || null;

    if (!analytics._measurementId) {
      logger.warn('analytics: no measurement ID set (config.analytics.providers.google.id) — disabled.');
      analytics._enabled = false;
      return;
    }
    if (!analytics._apiSecret) {
      logger.warn('analytics: GOOGLE_ANALYTICS_SECRET env var not set — disabled. (Set in .env for dev; webpack injects at build time for packaged apps.)');
      analytics._enabled = false;
      return;
    }

    // Namespace = uuidv5 of the firebase project ID (or app id as fallback). Same
    // projectId in BEM/web-manager/EM → same namespace → same per-uid UUIDv5
    // everywhere. UUIDv5 needs a UUID-shaped namespace — we derive one from the
    // string projectId by hashing it into uuidv5.URL space (RFC 4122).
    const projectId = manager?.config?.firebaseConfig?.projectId
      || manager?.config?.brand?.id
      || 'electron-manager';
    analytics._namespace = uuidv5(projectId, uuidv5.URL);

    // client_id = stable per-device UUID. context.session.deviceId is async-resolved;
    // by the time analytics.initialize() runs (post-context init in boot sequence),
    // it's already populated. Fall back to a fresh UUID if for any reason it isn't.
    const deviceId = manager?.context?.session?.deviceId || crypto.randomUUID();
    analytics._clientId = uuidv5(deviceId, analytics._namespace);

    // Wire auth subscription so user_id flips automatically on login/logout.
    if (typeof manager?.webManager?.onAuthChange === 'function') {
      analytics._authUnsub = manager.webManager.onAuthChange((snap) => {
        analytics._handleAuthChange(snap);
      });
      // Pull current state immediately in case auth already resolved.
      const current = manager.webManager.getUser?.();
      if (current?.uid) analytics._handleAuthChange(current);
    }

    // Compute initial user_properties from context + usage.
    analytics._userProperties = analytics._buildUserProperties();

    logger.log(`analytics initialized — measurement=${analytics._measurementId} client_id=${analytics._clientId.slice(0, 8)}…`);

    // Flush any queued events.
    if (analytics._queue.length > 0) {
      logger.log(`analytics: flushing ${analytics._queue.length} queued event(s).`);
      const queued = analytics._queue.slice();
      analytics._queue = [];
      for (const item of queued) analytics.event(item.name, item.params);
    }

    // Auto-emit app_launch from the main process. Renderer modules emit their own
    // page_view from each renderer's initialize() (renderer/preload bridge below).
    if (analytics._isMain()) {
      analytics.event('app_launch');
    }

    // IPC: renderer → main analytics calls. Forward fires-and-forgets via send;
    // status query via invoke.
    if (manager?.ipc) {
      manager.ipc.unhandle?.('em:analytics:status');
      manager.ipc.handle('em:analytics:status', () => analytics.toJSON());
      // Use Set-deduped listener; named handler so re-init collapses duplicates.
      if (typeof manager.ipc.on === 'function') {
        manager.ipc.on('em:analytics:event',           analytics._onIpcEvent);
        manager.ipc.on('em:analytics:set-user-properties', analytics._onIpcSetProps);
      }
    }
  },

  _onIpcEvent({ name, params } = {}) {
    if (!name) return;
    analytics.event(name, params);
  },

  _onIpcSetProps(props) {
    analytics.setUserProperties(props);
  },

  // ─── Public API ─────────────────────────────────────────────────────────────

  // Send an event. Queues if not initialized yet.
  event(name, params) {
    if (!analytics._enabled || !analytics._measurementId) {
      // Queue while we're still booting (init may flip _enabled later).
      if (!analytics._initialized) {
        if (analytics._queue.length < MAX_QUEUE) {
          analytics._queue.push({ name, params });
        }
      }
      return;
    }

    const cleanName = analytics._normalizeName(name);
    if (!cleanName) return;

    const enrichedParams = analytics._enrichParams(params || {});

    const payload = {
      client_id:       analytics._clientId,
      ...(analytics._userId ? { user_id: analytics._userId } : {}),
      user_properties: analytics._userProperties,
      events: [{
        name:   cleanName,
        params: enrichedParams,
      }],
    };

    const url = `${GA_ENDPOINT}?measurement_id=${encodeURIComponent(analytics._measurementId)}&api_secret=${encodeURIComponent(analytics._apiSecret)}`;

    fetch(url, {
      method:   'post',
      response: 'text',
      tries:    2,
      timeout:  FETCH_TIMEOUT_MS,
      body:     payload,
    }).catch((e) => {
      logger.warn(`event "${cleanName}" failed: ${e.message}`);
    });
  },

  pageview(path) {
    analytics.event('page_view', path ? { page_path: path } : {});
  },

  screenview(name) {
    analytics.event('screen_view', name ? { screen_name: name } : {});
  },

  // Manual user-id override. Normally web-manager-bridge wires this automatically.
  setUserId(uid) {
    if (!analytics._namespace) {
      // Init hasn't run yet — store and apply at init.
      analytics._pendingUid = uid || null;
      return;
    }
    analytics._userId = uid ? uuidv5(uid, analytics._namespace) : null;
  },

  // Merge into the user_properties block sent on every subsequent event.
  setUserProperties(props) {
    if (!props || typeof props !== 'object') return;
    const wrapped = {};
    for (const [k, v] of Object.entries(props)) {
      wrapped[k] = { value: v };
    }
    analytics._userProperties = { ...analytics._userProperties, ...wrapped };
  },

  // ─── Internals ──────────────────────────────────────────────────────────────

  _isMain() {
    return process.type === 'browser' || process.type === undefined;   // undefined in tests
  },

  // GA4 event names: letters/digits/underscore, ≤40 chars, can't start/end with underscore.
  _normalizeName(name) {
    if (!name || typeof name !== 'string') return null;
    return name
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
      .slice(0, 40);
  },

  // GA4 param contract: each event needs engagement_time_msec (else session bounces),
  // and we add session_id + page_location so reports group properly.
  _enrichParams(params) {
    const ctx = analytics._manager?.context || {};
    const sessionStart = ctx.session?.startTime ? new Date(ctx.session.startTime).getTime() : Date.now();
    const engagement   = Math.max(1, Date.now() - sessionStart);
    return {
      session_id:           ctx.session?.id || 'unknown',
      engagement_time_msec: engagement,
      page_location:        params.page_location || `app://${analytics._manager?.config?.brand?.id || 'em'}`,
      page_title:           params.page_title || analytics._manager?.config?.app?.productName || 'app',
      ...params,
    };
  },

  // Compute user-properties from current context + usage. Re-run on auth change.
  _buildUserProperties() {
    const m = analytics._manager;
    const ctx = m?.context || {};
    const usage = m?.usage;
    const wrap = (v) => ({ value: v });
    const out = {
      app_version:      wrap(ctx.app?.version || 'unknown'),
      operating_system: wrap(ctx.client?.platform || 'unknown'),
      device_category:  wrap(ctx.client?.mobile ? 'mobile' : 'desktop'),
      country:          wrap(ctx.geolocation?.country || 'None'),
      language:         wrap(ctx.client?.locale || 'None'),
      authenticated:    wrap(!!analytics._userId),
    };
    if (usage?.opens) out.app_opens = wrap(usage.opens());
    if (usage?.hoursTotal) out.app_hours_total = wrap(Math.round((usage.hoursTotal() || 0) * 100) / 100);
    return out;
  },

  // Auth bridge wiring — fires login/logout events on transition.
  _handleAuthChange(snap) {
    const newUid = snap?.uid || null;
    const prevUid = analytics._userId
      ? 'set'   // we don't reverse the uuidv5; just need to know whether one was set
      : null;

    if (newUid) {
      const previousAuthed = analytics._userId !== null;
      analytics.setUserId(newUid);
      analytics._userProperties = analytics._buildUserProperties();
      if (!previousAuthed) {
        analytics.event('login', { method: snap?.providerId || 'unknown' });
      }
    } else if (prevUid) {
      analytics.event('logout');
      analytics._userId = null;
      analytics._userProperties = analytics._buildUserProperties();
    }
  },

  // Plain-JSON snapshot for IPC inspection.
  toJSON() {
    return {
      enabled:        analytics._enabled,
      measurementId:  analytics._measurementId,
      clientId:       analytics._clientId,
      userId:         analytics._userId,
      queueLength:    analytics._queue.length,
    };
  },

  // Test teardown.
  shutdown() {
    if (typeof analytics._authUnsub === 'function') {
      analytics._authUnsub();
    }
    analytics._initialized   = false;
    analytics._manager       = null;
    analytics._enabled       = false;
    analytics._measurementId = null;
    analytics._apiSecret     = null;
    analytics._namespace     = null;
    analytics._clientId      = null;
    analytics._userId        = null;
    analytics._userProperties = {};
    analytics._queue         = [];
    analytics._authUnsub     = null;
    analytics._pendingUid    = null;
  },
};

module.exports = analytics;
