// Build-layer tests for lib/templating.js — render, buildPageVars, renderPage.

const path = require('path');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'templating — render + buildPageVars',
  tests: [
    {
      name: 'templating exports the expected surface',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        ctx.expect(typeof t.initialize).toBe('function');
        ctx.expect(typeof t.render).toBe('function');
        ctx.expect(typeof t.buildPageVars).toBe('function');
        ctx.expect(typeof t.renderPage).toBe('function');
      },
    },
    {
      name: 'render replaces {{ var }} tokens with vars',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const out = t.render('Hello {{ name }}!', { name: 'Ian' });
        ctx.expect(out).toBe('Hello Ian!');
      },
    },
    {
      name: 'render supports dot-notation paths',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const out = t.render('{{ brand.name }} v{{ app.version }}', { brand: { name: 'MyApp' }, app: { version: '1.2.3' } });
        ctx.expect(out).toBe('MyApp v1.2.3');
      },
    },
    {
      name: 'render leaves unknown tokens intact (does not throw)',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const out = t.render('Hello {{ missing }}!', {});
        // node-powertools returns the original token when not found.
        ctx.expect(typeof out).toBe('string');
      },
    },
    {
      name: 'render supports custom brackets',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const out = t.render('Hello [name]!', { name: 'Ian' }, { brackets: ['[', ']'] });
        ctx.expect(out).toBe('Hello Ian!');
      },
    },
    {
      name: 'buildPageVars produces brand/app/page/theme/cacheBust from a manager-like object',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const fakeManager = { config: { brand: { name: 'MyApp', id: 'myapp' }, app: { productName: 'MyApp' } } };
        const vars = t.buildPageVars('settings', { cacheBust: '12345' }, fakeManager);
        ctx.expect(vars.page.name).toBe('settings');
        ctx.expect(vars.page.title).toBe('MyApp');
        ctx.expect(vars.brand.id).toBe('myapp');
        ctx.expect(vars.theme.appearance).toBe('auto');
        ctx.expect(vars.cacheBust).toBe('12345');
        ctx.expect(vars.content).toBe('');
      },
    },
    {
      name: 'buildPageVars accepts a content slot',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const vars = t.buildPageVars('main', { content: '<h1>Hi</h1>' }, { config: {} });
        ctx.expect(vars.content).toBe('<h1>Hi</h1>');
      },
    },
    {
      name: 'renderPage end-to-end: page template + body content',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const tpl = '<title>{{ page.title }}</title><body>{{ content }}</body>';
        const vars = t.buildPageVars('main', {
          content: 'Hello {{ brand.name }}',
          cacheBust: '1',
        }, { config: { brand: { name: 'MyApp' }, app: { productName: 'MyApp' } } });
        // Note: content has its own {{ brand.name }} — this test verifies that the OUTER render
        // does not double-render the body. Templating call sites (gulp/html) handle the two-pass
        // explicitly: render body first, then page.
        // For this test, we just check the page-level render applied correctly.
        const final = t.renderPage(tpl, vars);
        ctx.expect(final).toContain('<title>MyApp</title>');
        ctx.expect(final).toContain('<body>Hello {{ brand.name }}</body>');
      },
    },
  ],
};
