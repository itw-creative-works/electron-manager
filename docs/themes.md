# Themes

EM ships the **classy** theme (built on Bootstrap 5) so consumer apps look polished out of the box. Variables are fully customizable via `@use 'electron-manager' as * with (...)` — same pattern as UJM and BXM.

## How it works

EM bundles two themes in `<em>/dist/assets/themes/`:

| Theme | Base | Use case |
|---|---|---|
| `classy` (default) | Bootstrap 5.3 + UJM design system | Polished, modern app shell |
| `bootstrap` | Plain Bootstrap 5.3 | Minimal, vanilla Bootstrap |

The active theme is selected via `config.theme.id` (default `'classy'`). The `gulp/sass` task adds `<em>/dist/assets/themes/<theme>` to its sass `loadPaths` so the bare `@use 'theme'` import inside `electron-manager.scss` resolves to the active theme.

## Consumer setup

Your `src/assets/scss/main.scss` becomes:

```scss
@use 'electron-manager' as * with (
  $primary: #5B47FB,
  // $secondary: #6C757D,
  // $border-radius: 0.5rem,
);

// Custom global styles below...
main {
  padding: 2rem;
}
```

That single import gives you:
- Full Bootstrap 5 (utilities, components, grid, etc.)
- Classy theme overlays (typography, animations, refined spacing)
- EM's `_initialize.scss` (desktop-specific defaults — full-window body, app-region drag classes)

## Per-page CSS

EM compiles per-page bundles in addition to the shared `main.bundle.css`:

```
src/assets/scss/main.scss          → dist/assets/css/main.bundle.css            (every page)
src/assets/scss/pages/main.scss    → dist/assets/css/components/main.bundle.css       (main window only)
src/assets/scss/pages/settings.scss → dist/assets/css/components/settings.bundle.css   (settings window only)
src/assets/scss/pages/about.scss   → dist/assets/css/components/about.bundle.css      (about window only)
```

The page template auto-loads both: `main.bundle.css` is on every HTML page, and `components/<page.name>.bundle.css` is loaded only on its specific page. To add styles for a new page, drop a new file at `src/assets/scss/pages/<view>.scss` — it'll auto-compile and auto-inject.

Per-page bundles can themselves `@use 'electron-manager' as *;` if they need access to theme variables. Just be aware this means re-emitting some shared CSS — for very small per-page tweaks, prefer plain selectors that ride on the shared `main.bundle.css`.

## Customizable variables

The full classy variable list lives at `<em>/dist/assets/themes/classy/_config.scss`. ~60 variables you can override via the `@use ... with ()` form:

**Colors:** `$primary`, `$secondary`, `$success`, `$info`, `$warning`, `$danger`, `$light`, `$dark`
**Backgrounds (light mode):** `$classy-bg-light`, `$classy-bg-light-secondary`, `$classy-bg-light-tertiary`
**Backgrounds (dark mode):** `$classy-bg-dark`, `$classy-bg-dark-secondary`, `$classy-bg-dark-tertiary`
**Typography:** `$font-family-sans-serif`, `$font-family-base`, `$headings-font-weight`, `$classy-font-mono`, `$classy-font-accent`
**Border radius:** `$border-radius`, `$border-radius-sm/lg/xl/2xl/pill`
**Spacing, transitions, shadows** — see `_config.scss`

## Switching themes

Set `config.theme.id` in `config/electron-manager.json`:

```jsonc
theme: {
  id:         'bootstrap',     // 'classy' (default) | 'bootstrap'
  appearance: 'auto',          // 'light' | 'dark' | 'auto'
}
```

`appearance` flows into the page template as `data-bs-theme="{{ theme.appearance }}"`, so Bootstrap's color-mode system picks it up automatically.

## Where the themes live

EM's themes are vendored — copied from UJM into `<em>/src/assets/themes/{classy,bootstrap}`. They get rebuilt to `<em>/dist/assets/themes/...` via `prepare-package`. Consumers import them via the sass `loadPaths` mechanism — **they're never copied into the consumer's tree**.

## Updating themes

Update flows via `npm update electron-manager`. EM's themes are frozen at the version of UJM they were copied from; if UJM updates classy, EM has to do another vendor sync.

Future: extract themes to a standalone `@itw/classy-theme` npm module that both UJM and EM consume. For now they're owned by EM directly.

## Gotchas

### Sass `@import` deprecation warnings
Classy's `_theme.scss` uses `@import` (Sass's legacy module system) for its own internal layout. You'll see a deprecation warning during compile. UJM has the same warning. Functional today; will be migrated when classy upgrades to fully-modular `@use`/`@forward`.

### Per-page CSS bundles are 0 bytes by default
Empty `pages/<name>.scss` produces empty bundles. That's fine — the page template still loads them, the browser just gets a 200 with no rules. Adding any selector populates it.
