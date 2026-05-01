// Audit — fail-fast schema + filesystem checks for the consumer's config/electron-manager.json.
//
// Runs as part of `gulp build` between sass/webpack/html and build-config. Catches the
// "I forgot to set X" / "icon path is wrong" / "main entry was renamed" footguns at build time
// rather than letting them reach electron-builder (where the error messages are useless).
//
// Failure mode: collects every problem into a single thrown Error with a numbered list.
// One error per problem so the consumer can fix them all in one shot instead of fix-rebuild-fix.
//
// Categories of check:
//   - REQUIRED config keys present (brand.id, brand.name).
//     app.appId / app.productName are optional — derived from brand.id / brand.name if unset.
//   - File existence for any path-shaped config value (brand.images.icon).
//   - Format checks for fields with constrained shapes (brand.id as URL scheme, startup.mode, signing strategy).
//   - Consumer entrypoints exist (src/main.js, src/preload.js) — these are what webpack will try to bundle.
//   - In publish mode, releases.repo is set and electron-builder.yml exists.

const path    = require('path');
const jetpack = require('fs-jetpack');
const Manager = new (require('../../build.js'));

const logger = Manager.logger('audit');

const VALID_STARTUP_MODES   = ['normal', 'hidden'];
const VALID_WIN_STRATEGIES  = ['self-hosted', 'cloud', 'local'];

module.exports = function audit(done) {
  const cwd      = process.cwd();
  const config   = Manager.getConfig();
  const errors   = [];
  const warnings = [];

  function require_(condition, message) {
    if (!condition) errors.push(message);
  }
  function fileMustExist(rel, label) {
    if (!rel) return;
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    if (!jetpack.exists(abs)) errors.push(`${label} not found at ${rel}`);
  }

  // 1. Required config keys.
  require_(config?.brand?.id,    'config.brand.id is required (used for app:// scheme + default appId)');
  require_(config?.brand?.name,  'config.brand.name is required (used as default productName)');

  // 2. File existence for paths the build references.
  // Entry points are required for any build (webpack will fail without them).
  fileMustExist('src/main.js',    'src/main.js');
  fileMustExist('src/preload.js', 'src/preload.js');
  // Icon is only required for packaging — dev runs fine with the default Electron icon.
  if (Manager.isPublishMode() || Manager.isBuildMode()) {
    fileMustExist(config?.brand?.images?.icon, 'config.brand.images.icon');
  }

  // 3. Format checks.
  if (config?.startup?.mode && !VALID_STARTUP_MODES.includes(config.startup.mode)) {
    errors.push(`config.startup.mode "${config.startup.mode}" is invalid (allowed: ${VALID_STARTUP_MODES.join(', ')})`);
  }
  const winStrat = config?.signing?.windows?.strategy;
  if (winStrat && !VALID_WIN_STRATEGIES.includes(winStrat)) {
    errors.push(`config.signing.windows.strategy "${winStrat}" is invalid (allowed: ${VALID_WIN_STRATEGIES.join(', ')})`);
  }
  // Deep-link scheme is auto-derived from brand.id. Validate brand.id matches the URL-scheme grammar.
  const brandId = config?.brand?.id;
  if (brandId && (typeof brandId !== 'string' || !/^[a-z][a-z0-9+\-.]*$/.test(brandId))) {
    errors.push(`config.brand.id "${brandId}" is not a valid URL scheme (must be lowercase, start with a letter, alnum/+/-/.) — used for the deep-link scheme.`);
  }

  // 4. Publish-mode-only checks.
  if (Manager.isPublishMode()) {
    if (config?.releases?.enabled !== false) {
      require_(config?.releases?.repo, 'config.releases.repo is required when publishing (e.g. "update-server")');
    }
    // Note: electron-builder.yml is generated into dist/ by gulp/build-config and isn't
    // a required source file in the consumer anymore.
  }

  // 5. Soft warnings — not fatal but worth surfacing.
  if (config?.brand?.id === 'myapp' || config?.brand?.name === 'MyApp') {
    warnings.push('config still uses the scaffold defaults ("myapp" / "MyApp") — set brand.id and brand.name before publishing.');
  }

  // Report.
  for (const w of warnings) {
    logger.warn(w);
  }

  if (errors.length > 0) {
    const numbered = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    return done(new Error(`audit failed — fix the following before continuing:\n${numbered}`));
  }

  logger.log(`audit ok (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`);
  done();
};
