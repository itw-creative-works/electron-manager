// Runtime context — what we know about the user's machine + their network +
// the current session. Modeled after BEM's `assistant.request.{geolocation,client}`
// shape so EM apps + sister projects (BEM, UJM, web-manager) all reference the
// same property paths when reading user info.
//
// Populated asynchronously during manager.initialize():
//
//   manager.context.geolocation = { ip, country, region, city }      // ipify-fetched
//   manager.context.client      = { userAgent, locale, platform, arch, mobile }
//   manager.context.session     = { id, startTime, deviceId }        // EM-specific
//   manager.context.app         = { version, environment, isPackaged }
//
// Geolocation is fetched from https://api.ipify.org (IP only) and persisted to
// storage so a subsequent boot offline still reports the last-known IP. The
// `country/region/city` fields stay null until we add a richer geolocation
// fetcher (left as a future enhancement so we don't add a brittle dep here).
//
// Session is one-shot per launch; deviceId is persistent across launches via
// `os.networkInterfaces()` (first non-internal MAC) with a `crypto.randomUUID()`
// fallback persisted to storage on first launch.

const os         = require('os');
const crypto     = require('crypto');
const LoggerLite = require('./logger-lite.js');
const fetch      = require('wonderful-fetch');

const logger = new LoggerLite('context');

const STORAGE_KEY = 'context';
const IPIFY_URL   = 'https://api.ipify.org?format=json';
const IP_FETCH_TIMEOUT_MS = 5000;

const context = {
  _initialized: false,
  _manager:     null,

  // Public shape — populated during initialize(). Exported as plain JSON so renderer
  // tests + IPC consumers can read it via structured-clone.
  geolocation: { ip: null, country: null, region: null, city: null },
  client:      { userAgent: null, locale: null, platform: null, arch: null, mobile: false },
  session:     { id: null, startTime: null, deviceId: null },
  app:         { version: null, environment: null, isPackaged: null },

  async initialize(manager) {
    if (context._initialized) return;
    context._initialized = true;
    context._manager = manager;

    // ─── session ──────────────────────────────────────────────────────────────
    context.session.id        = crypto.randomUUID();
    context.session.startTime = new Date().toISOString();
    context.session.deviceId  = await context._resolveDeviceId();

    // ─── client ───────────────────────────────────────────────────────────────
    context.client.platform = os.platform();
    context.client.arch     = os.arch();
    context.client.mobile   = false;   // desktop framework — never true

    // electron's `app` is only present in the main process. In renderer/preload
    // the `electron` import surface has no `.app`; in plain Node it's a string
    // (the binary path). require() doesn't throw in any of those — just check
    // for the property.
    const { app } = require('electron');
    if (app) {
      context.client.userAgent = app.userAgentFallback || null;
      context.client.locale    = app.getLocale?.() || null;
      context.app.isPackaged   = !!app.isPackaged;
    } else {
      context.app.isPackaged   = false;
    }

    // ─── app ──────────────────────────────────────────────────────────────────
    context.app.version     = manager?.getVersion?.() || null;
    context.app.environment = manager?.getEnvironment?.() || null;

    // ─── geolocation ──────────────────────────────────────────────────────────
    // Restore last-known from storage immediately so we always have SOMETHING to
    // work with (offline boot, ipify down, slow network, etc.). Then fire the
    // network fetch in the background — when it lands it overwrites + persists.
    const cached = manager?.storage?.get?.(STORAGE_KEY) || null;
    if (cached?.geolocation) {
      Object.assign(context.geolocation, cached.geolocation);
    }
    // Fire-and-forget; failures fall back to cached.
    context._fetchGeolocation().catch((e) => logger.warn(`geolocation fetch failed: ${e.message}`));

    // IPC: renderer can read the full context block.
    if (manager?.ipc) {
      manager.ipc.unhandle?.('em:context:get');
      manager.ipc.handle('em:context:get', () => context.toJSON());
    }

    logger.log(`context initialized — session=${context.session.id} deviceId=${context.session.deviceId} platform=${context.client.platform}`);
  },

  // Resolve a stable per-machine UUID. Order:
  //   1. Storage (already persisted from a prior boot — wins so we're stable across
  //      NIC swaps / VPN changes that would shuffle MAC-derived IDs).
  //   2. First non-internal MAC from os.networkInterfaces() (stable on a stable rig).
  //   3. crypto.randomUUID() fallback (works in any context, persisted for next boot).
  async _resolveDeviceId() {
    const m = context._manager;

    const stored = m?.storage?.get?.(`${STORAGE_KEY}.deviceId`);
    if (stored) return stored;

    const mac = context._readFirstMac();
    const id = mac || crypto.randomUUID();

    if (m?.storage?.set) {
      m.storage.set(`${STORAGE_KEY}.deviceId`, id);
    }
    return id;
  },

  // Walk os.networkInterfaces() and return the first MAC that's not all-zeros and
  // not the internal loopback. Returns null if none found.
  _readFirstMac() {
    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
          if (iface.internal) continue;
          if (!iface.mac || iface.mac === '00:00:00:00:00:00') continue;
          return iface.mac;
        }
      }
    } catch (_) { /* fall through */ }
    return null;
  },

  // Async geolocation fetch. ipify gives us the IP; richer country/region/city
  // lookups can be added later via a separate provider (kept simple here so the
  // happy path is one fast HTTPS round-trip, no third-party data leak surface
  // beyond ipify itself).
  async _fetchGeolocation() {
    const data = await fetch(IPIFY_URL, {
      method:   'get',
      response: 'json',
      timeout:  IP_FETCH_TIMEOUT_MS,
      tries:    1,
    });
    const ip = data?.ip || null;
    if (!ip) return;

    context.geolocation.ip = ip;
    // Persist for next launch so an offline boot still has a usable IP.
    if (context._manager?.storage?.set) {
      context._manager.storage.set(`${STORAGE_KEY}.geolocation`, { ...context.geolocation });
    }
  },

  // Test/teardown helper. Re-initialize is idempotent guarded; call this first
  // if a test wants to re-run with mutated state.
  shutdown() {
    context._initialized = false;
    context._manager     = null;
  },

  // Plain-JSON snapshot — what gets sent over IPC to the renderer.
  toJSON() {
    return {
      geolocation: { ...context.geolocation },
      client:      { ...context.client },
      session:     { ...context.session },
      app:         { ...context.app },
    };
  },
};

module.exports = context;
