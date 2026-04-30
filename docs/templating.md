# Templating

Light token-replacement engine for HTML pages. Uses `{{ var }}` syntax, dot-notation paths, brand/app values from config.

## How it works

1. Consumer authors `src/views/<name>/index.html` as the **body** of the page (no `<html>`, `<head>`, `<body>` tags).
2. EM ships a default page template at `<em>/dist/config/page-template.html`. Consumers can override with their own at `<consumer>/config/page-template.html` if they want to.
3. At build time, `gulp/html`:
   - Reads each `src/views/<name>/index.html`
   - Templates its body with the page vars (so the body can use `{{ brand.name }}` etc.)
   - Injects the rendered body into the page template's `{{ content }}` slot
   - Writes the final HTML to `dist/views/<name>/index.html`
4. The page template auto-includes:
   - `assets/css/main.bundle.css` (compiled from `src/assets/scss/main.scss` by gulp/sass) — present on every page
   - `assets/js/components/<page.name>.bundle.js` (per-view webpack output) — only the JS for this page

## Page name

`page.name` is derived from the view's path under `src/views/`:
- `src/views/main/index.html`        → `page.name = 'main'`
- `src/views/settings/index.html`    → `page.name = 'settings'`
- `src/views/blog/post.html`         → `page.name = 'blog/post'`

This naming lines up with the webpack renderer entry naming so the JS bundle path resolves correctly.

## Page template variables

| Var | Source | Example |
|---|---|---|
| `{{ brand.id }}`, `{{ brand.name }}`, `{{ brand.url }}` | `config.brand.*` | `myapp` / `MyApp` |
| `{{ app.productName }}`, `{{ app.appId }}`, `{{ app.copyright }}` | `config.app.*` | `MyApp` / `com.itwcw.myapp` |
| `{{ page.name }}` | derived from view path | `main` / `settings` |
| `{{ page.title }}` | `extras.title` (in gulp/html) or `app.productName` | `MyApp` |
| `{{ theme.appearance }}` | `config.theme.appearance` (default `'auto'`) | `light` / `dark` / `auto` |
| `{{ cacheBust }}` | build timestamp | `1777515223640` |
| `{{ content }}` | rendered body (set by gulp/html) | `<main>...</main>` |

## Default page template

```html
<!doctype html>
<html data-bs-theme="{{ theme.appearance }}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>{{ page.title }}</title>
    <link href="../../assets/css/main.bundle.css?cb={{ cacheBust }}" rel="stylesheet">
  </head>
  <body>
    {{ content }}
    <script src="../../assets/js/components/{{ page.name }}.bundle.js?cb={{ cacheBust }}"></script>
  </body>
</html>
```

## Overriding the page template

Drop your own `config/page-template.html` in your project root. EM picks it up before falling back to its own default.

```html
<!-- consumer/config/page-template.html -->
<!doctype html>
<html data-bs-theme="{{ theme.appearance }}" lang="en">
  <head>
    <meta charset="utf-8">
    <title>{{ page.title }} | {{ brand.name }}</title>
    <link href="../../assets/css/main.bundle.css?cb={{ cacheBust }}" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700" rel="stylesheet">
  </head>
  <body class="custom-shell">
    {{ content }}
    <script src="../../assets/js/components/{{ page.name }}.bundle.js?cb={{ cacheBust }}"></script>
  </body>
</html>
```

## Runtime API

`manager.templating` is also available at runtime if you need to template a string yourself (e.g. dynamic deep-link routes):

```js
manager.templating.render('Hello {{ user.name }}', { user: { name: 'Ian' } });
// → 'Hello Ian'

manager.templating.render('Custom [name]', { name: 'X' }, { brackets: ['[', ']'] });
// → 'Custom X'
```

## Future

The current page template hardcodes the asset paths. A future pass adds:
- Per-page CSS bundles (currently only one shared `main.bundle.css`)
- Source map references in dev mode
- Inline critical CSS for fast first paint

For theme-related styling (Bootstrap, classy theme), see [docs/themes.md](themes.md) when that pass lands.

## Tests

`src/test/suites/build/templating.test.js` — render, dot-notation, custom brackets, buildPageVars, renderPage end-to-end. 8 tests.
