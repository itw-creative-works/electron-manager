// Canonical schema for `config/electron-manager.json`.
//
// Single source of truth for what fields exist, which are required, and what
// shape their values take. Used by:
//   - gulp/tasks/audit.js (build-time validation)
//   - Manager.initialize() (soft warnings at boot)
//   - mgr upgrade-config (diff report against the consumer's actual config)
//
// Schema entry shape:
//   {
//     path:        'brand.id',                    // dot-path into the config object
//     type:        'string' | 'boolean' | 'number' | 'array' | 'object' | 'path',
//     required:    true | false | (config) => bool,
//     match:       RegExp,                        // only checked when value is present + is a string
//     enum:        [...],                         // only checked when value is present
//     description: 'Used for the deep-link scheme + default appId.',
//     fileMustExist: true,                        // only valid with type: 'path'
//   }
//
// `required: function` form is for "this field is mandatory ONLY when some other
// part of config is configured" — e.g. analytics.providers.google.id is only
// required when analytics.enabled === true. Keep these tiny and pure.
//
// `match`, `enum`, and `fileMustExist` are NOT enforced when the value is missing.
// They only run on presence. This way "field absent + required: false" is silent.

module.exports = [
  // ── brand ────────────────────────────────────────────────────────────────
  {
    path:        'brand.id',
    type:        'string',
    required:    true,
    match:       /^[a-z][a-z0-9+\-.]*$/,
    description: 'URL-scheme-safe slug. Used as deep-link scheme + default appId. Must be lowercase, start with a letter, alnum/+/-/.',
  },
  {
    path:        'brand.name',
    type:        'string',
    required:    true,
    description: 'Human-readable app name. Used as default productName.',
  },
  {
    path:        'brand.url',
    type:        'string',
    required:    false,
    match:       /^https?:\/\//,
    description: 'Marketing site URL. Used to derive remoteConfig URL + "Open Website" menu items.',
  },
  {
    path:        'brand.contact.email',
    type:        'string',
    required:    false,
    match:       /@/,
    description: 'Support email surfaced in About / Help.',
  },
  {
    path:        'brand.images.icon',
    type:        'string',
    required:    false,
    description: 'Path to app icon. File-existence is enforced at build time by gulp/audit (not by the schema, since dev runs fine without).',
  },

  // ── app ──────────────────────────────────────────────────────────────────
  {
    path:        'app.category',
    type:        'string',
    required:    false,
    enum:        ['productivity', 'developer-tools', 'utilities', 'media', 'social', 'network'],
    description: 'Generic high-level category. EM maps to per-platform UTI + freedesktop strings.',
  },

  // ── targets ──────────────────────────────────────────────────────────────
  {
    path:        'targets.win.signing.strategy',
    type:        'string',
    required:    false,
    enum:        ['self-hosted', 'cloud', 'local'],
    description: 'Windows code-signing path. self-hosted = EV USB token on a runner; cloud = provider CLI; local = developer signs manually.',
  },

  // ── startup ──────────────────────────────────────────────────────────────
  {
    path:        'startup.mode',
    type:        'string',
    required:    false,
    enum:        ['normal', 'hidden'],
    description: 'normal = main window appears at launch; hidden = bakes LSUIElement=true on macOS (no dock, no Cmd+Tab).',
  },

  // ── releases ─────────────────────────────────────────────────────────────
  {
    path:        'releases.repo',
    type:        'string',
    required:    false,
    description: 'GitHub repo where built artifacts + the auto-update feed live. Build-time required when releases.enabled !== false; enforced by gulp/audit, not the schema (dev needs no repo).',
  },

  // ── analytics ────────────────────────────────────────────────────────────
  {
    path:        'analytics.providers.google.id',
    type:        'string',
    required:    false,
    match:       /^G-[A-Z0-9]+$/,
    description: 'GA4 Measurement ID. Presence-driven: set to `G-XXXXXXXXXX` to enable; leave empty to disable. Secret lives in process.env.GOOGLE_ANALYTICS_SECRET.',
  },

  // ── firebase ─────────────────────────────────────────────────────────────
  {
    path:        'firebaseConfig.projectId',
    type:        'string',
    required:    false,
    description: 'Drives analytics uuidv5 namespace + remote-config URL fallback + web-manager auth.',
  },

  // ── payment ──────────────────────────────────────────────────────────────
  // BEM-shaped so the same product catalog can be referenced from backend +
  // desktop. Empty defaults are fine — only the keys that exist get validated.
  {
    path:        'payment.processors.stripe.publishableKey',
    type:        'string',
    required:    false,
    match:       /^pk_(test|live)_/,
    description: 'Stripe publishable key. Lives in config (not secret); secret key stays in env.',
  },
  {
    path:        'payment.processors.paypal.clientId',
    type:        'string',
    required:    false,
    description: 'PayPal client ID. Lives in config; secret stays in env.',
  },
];
