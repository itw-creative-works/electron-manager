// Templating — light token-replacement engine for HTML/CSS/JS at build time.
//
// Wraps node-powertools' template() with EM-friendly defaults:
//   - Brackets are `{{ }}` (matches BXM/UJM convention).
//   - Standard variable scope built from manager.config + page metadata.
//
// Public API:
//   manager.templating.render(input, vars)               // arbitrary string + arbitrary vars
//   manager.templating.buildPageVars(pageName, extras)   // produces { brand, app, page, theme, cacheBust }
//   manager.templating.renderPage(pageTemplate, vars)    // shortcut that uses {{ }} brackets
//
// Manager.initialize calls .initialize(manager) but the lib is mostly used at build time
// (gulp/html), not at runtime. The runtime surface is exposed for consumer hooks that want
// to template their own strings.

const LoggerLite = require('./logger-lite.js');
const { template } = require('node-powertools');

const logger = new LoggerLite('templating');

const DEFAULT_BRACKETS = ['{{', '}}'];

const templating = {
  _initialized: false,
  _manager:     null,

  initialize(manager) {
    templating._manager = manager;
    templating._initialized = true;
    logger.log('initialize');
  },

  // Render an arbitrary template string with the given vars. Brackets default to {{ }}.
  render(input, vars, opts) {
    opts = opts || {};
    const brackets = opts.brackets || DEFAULT_BRACKETS;
    return template(String(input || ''), vars || {}, { brackets });
  },

  // Build the standard variable scope for a page render. Combines manager.config with
  // page-specific metadata + cache-buster for asset URLs.
  // `manager` is optional — buildPageVars works at build time (where Manager singleton is built
  // from build.js) without needing the runtime manager singleton.
  buildPageVars(pageName, extras, manager) {
    const m = manager || templating._manager;
    const cfg = (m && m.config) || (m && typeof m.getConfig === 'function' ? m.getConfig() : {}) || {};
    // Pull version from the consumer's package.json at build time. This baked-in
    // string is used by templates that want to display the running version in the
    // UI (e.g. "v1.0.5" in a footer). At runtime it always matches the version
    // that was packaged + signed + uploaded, since both come from the same
    // package.json read.
    const pkg = (m && typeof m.getPackage === 'function' ? m.getPackage('project') : null) || {};
    const appBlock = { ...(cfg.app || {}) };
    if (pkg.version && !appBlock.version) appBlock.version = pkg.version;
    const vars = {
      brand: cfg.brand   || {},
      app:   appBlock,
      theme: { appearance: cfg?.theme?.appearance || 'auto' },
      page: {
        name:  pageName,
        title: (extras && extras.title) || cfg?.app?.productName || cfg?.brand?.name || 'App',
      },
      cacheBust: String((extras && extras.cacheBust) || Date.now()),
      // Slot for the body content. gulp/html sets this after rendering the inner view.
      content: (extras && extras.content) || '',
    };
    if (extras && typeof extras === 'object') {
      // Merge any extra keys (e.g. content), but don't clobber the structured groups above
      // unless explicitly provided.
      for (const [k, v] of Object.entries(extras)) {
        if (v !== undefined) vars[k] = v;
      }
    }
    return vars;
  },

  // Convenience: render a page template (outer shell) with the given vars.
  renderPage(pageTemplate, vars) {
    return templating.render(pageTemplate, vars);
  },
};

module.exports = templating;
