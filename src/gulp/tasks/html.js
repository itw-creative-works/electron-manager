// html — read each consumer view at src/views/<name>/index.html, treat it as the BODY of the
// outer page-template, render with templating vars, write to dist/views/<name>/index.html.
//
// Page template is EM-INTERNAL (`<em>/dist/config/page-template.html`). Consumers don't ship
// their own — every view goes through the same shell so the inset titlebar / draggable region /
// css/js wiring stay consistent. If a consumer needs a different template they can fork via
// `manager.windows` config, but we no longer look at `<consumer>/config/page-template.html`.
//
// Body content is itself templated FIRST (so you can use {{ brand.name }} etc. inside the view),
// then the result is injected into the page template's `{{ content }}` slot.
//
// The page name (passed to templating as page.name) is derived from the view's directory:
//   src/views/main/index.html       -> page.name = 'main'
//   src/views/settings/index.html   -> page.name = 'settings'
// This lines up with the webpack entry naming so /assets/js/components/<page.name>.bundle.js
// and /assets/css/components/<page.name>.bundle.css resolve correctly.

const Manager = new (require('../../build.js'));
const logger = Manager.logger('html');
const path = require('path');
const jetpack = require('fs-jetpack');

const projectRoot = Manager.getRootPath('project');
const packageRoot = Manager.getRootPath('main');

// We require the templating lib directly (rather than going through a Manager singleton)
// because gulp tasks run pre-Electron, with only the build-time Manager available.
const templating = require('../../lib/templating.js');

module.exports = function htmlTask(done) {
  const viewsDir = path.join(projectRoot, 'src', 'views');

  if (!jetpack.exists(viewsDir)) {
    logger.warn(`No views dir at ${viewsDir} — skipping.`);
    return done();
  }

  const files = jetpack.find(viewsDir, { matching: '**/*.html', recursive: true });
  if (files.length === 0) {
    logger.warn('No HTML files found.');
    return done();
  }

  // EM-internal page template — single source of truth. Lives at
  // <em>/dist/config/page-template.html (copied from src/config/page-template.html
  // by prepare-package). Consumers do not override this anymore.
  const templatePath = path.join(packageRoot, 'dist', 'config', 'page-template.html');

  if (!jetpack.exists(templatePath)) {
    logger.warn(`No EM page template at ${templatePath}. Falling back to raw view copy.`);
    files.forEach((src) => {
      const rel = path.relative(viewsDir, src);
      const dest = path.join(projectRoot, 'dist', 'views', rel);
      jetpack.copy(src, dest, { overwrite: true });
      logger.log(`emitted dist/views/${rel} (raw)`);
    });
    return done();
  }

  const pageTemplateContent = jetpack.read(templatePath);
  const cacheBust = String(Date.now());

  files.forEach((src) => {
    const rel = path.relative(viewsDir, src);
    // Page name = directory under views/, OR the file basename if at views/ root.
    // src/views/main/index.html       -> 'main'
    // src/views/main.html             -> 'main'
    // src/views/blog/post.html        -> 'blog/post'
    let pageName;
    const dir = path.dirname(rel);
    const base = path.basename(src, '.html');
    if (dir === '.' || dir === '') {
      pageName = base;
    } else if (base === 'index') {
      pageName = dir.replace(/\\/g, '/');
    } else {
      pageName = `${dir.replace(/\\/g, '/')}/${base}`;
    }

    const bodyContent = jetpack.read(src);

    // Two-pass render: first the body (so it can use {{ brand.name }} etc.), then the outer page.
    const innerVars = templating.buildPageVars(pageName, { cacheBust }, Manager);
    const renderedBody = templating.render(bodyContent, innerVars);
    const outerVars = templating.buildPageVars(pageName, { cacheBust, content: renderedBody }, Manager);
    const final = templating.render(pageTemplateContent, outerVars);

    const dest = path.join(projectRoot, 'dist', 'views', rel);
    jetpack.write(dest, final);
    logger.log(`emitted dist/views/${rel} (page=${pageName})`);
  });

  done();
};
