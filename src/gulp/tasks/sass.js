// sass — compile consumer SCSS into dist/assets/css/.
//
//   src/assets/scss/main.scss          -> dist/assets/css/main.bundle.css      (one shared bundle, every page)
//   src/assets/scss/pages/<name>.scss  -> dist/assets/css/components/<name>.bundle.css   (per-view bundle)
//
// loadPaths are configured so the consumer can write `@use 'electron-manager' as *`:
//   - <em-package-root>/dist/assets/css      → resolves bare 'electron-manager' to electron-manager.scss
//   - <em-package-root>/dist/assets/themes/<active-theme>   → resolves bare 'theme' to <theme>/_theme.scss
//   - <em-package-root>/dist/assets/themes   → so themes can reference each other via '../<sibling>'
//   - <consumer>/src/assets/scss             → consumer's own modules

const Manager = new (require('../../build.js'));
const logger = Manager.logger('sass');
const path = require('path');
const jetpack = require('fs-jetpack');
const sass = require('sass');

const projectRoot = Manager.getRootPath('project');
const packageRoot = Manager.getRootPath('main');

module.exports = function sassTask(done) {
  const isProd = Manager.getMode().environment === 'production';
  const config = Manager.getConfig() || {};
  const themeId = config?.theme?.id || 'classy';

  const loadPaths = [
    path.join(packageRoot, 'dist', 'assets', 'css'),                    // for `@use 'electron-manager'`
    path.join(packageRoot, 'dist', 'assets', 'themes', themeId),        // for `@use 'theme'`
    path.join(packageRoot, 'dist', 'assets', 'themes'),                 // for sibling-theme references
    path.join(projectRoot, 'src', 'assets', 'scss'),                    // consumer's own scss tree
  ];

  const compileOpts = {
    style:     isProd ? 'compressed' : 'expanded',
    sourceMap: !isProd,
    loadPaths,
    // Suppress noisy deprecation warnings inherited from the vendored classy + Bootstrap 5.3 source.
    // These are functional today (Dart Sass 1.x) and will be fixed when classy migrates to the
    // modern @use/@forward + sass:color module system upstream. Until then, drowning in warnings
    // every build hides real errors.
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function'],
  };

  // Compile main.scss → main.bundle.css
  const mainEntry = path.join(projectRoot, 'src', 'assets', 'scss', 'main.scss');
  const mainOut = path.join(projectRoot, 'dist', 'assets', 'css', 'main.bundle.css');

  try {
    if (jetpack.exists(mainEntry)) {
      const result = sass.compile(mainEntry, compileOpts);
      jetpack.write(mainOut, result.css);
      if (result.sourceMap) jetpack.write(`${mainOut}.map`, JSON.stringify(result.sourceMap));
      logger.log(`built dist/assets/css/main.bundle.css (${formatBytes(result.css.length)})`);
    } else {
      logger.warn(`No main scss entry at ${mainEntry} — skipping main bundle.`);
    }

    // Compile per-page entries: src/assets/scss/pages/<name>.scss → dist/assets/css/components/<name>.bundle.css
    const pagesDir = path.join(projectRoot, 'src', 'assets', 'scss', 'pages');
    if (jetpack.exists(pagesDir)) {
      const pageFiles = jetpack.find(pagesDir, { matching: '**/*.scss', recursive: true })
        .filter((f) => !path.basename(f).startsWith('_'));   // skip partials

      for (const src of pageFiles) {
        const rel = path.relative(pagesDir, src);
        const name = rel.replace(/\.scss$/, '').replace(/\\/g, '/');
        const out = path.join(projectRoot, 'dist', 'assets', 'css', 'components', `${name}.bundle.css`);
        const result = sass.compile(src, compileOpts);
        jetpack.write(out, result.css);
        if (result.sourceMap) jetpack.write(`${out}.map`, JSON.stringify(result.sourceMap));
        logger.log(`built dist/assets/css/components/${name}.bundle.css (${formatBytes(result.css.length)})`);
      }
    }

    done();
  } catch (e) {
    logger.error('sass compile failed:', e.message || e);
    done(e);
  }
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}
