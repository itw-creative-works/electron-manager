# CSS Architecture

EM styles are SCSS, compiled by the pipeline's `sass` task into per-window bundles on top of a shared base. Bootstrap 5 (via EM's classy theme) is the foundation — consumers restyle Bootstrap, they don't replace it.

## Main entry

`<consumer>/src/assets/scss/main.scss` — loaded by EVERY window. It configures the theme via `@use ... with (...)`:

```scss
@use 'electron-manager' as * with (
  $primary: #5B47FB,
  $dark: #1a1a2e,
  $classy-bg-dark: #0f0f1a,
  $classy-bg-dark-secondary: #161628,
  $classy-bg-dark-tertiary: #1e1e38,
);

// Custom global styles below
```

Compiles to `dist/assets/css/main.bundle.css` (Bootstrap + classy theme + your globals).

## Per-window styles

`src/assets/scss/pages/<window>.scss` → `dist/assets/css/components/<window>.bundle.css`, loaded ONLY on that window's page. One file per window (`main.scss`, `settings.scss`, …) — page-specific chrome lives here, shared styles live in the main entry.

## Theme integration

The `@use 'electron-manager'` entry pulls in Bootstrap 5 + EM's classy theme. Appearance (`system`/`light`/`dark`) defaults from `config.theme.appearance` and is applied + kept live on `<html data-bs-theme>` by `manager.theme` (OS-following, runtime-switchable, persisted override — see [themes.md](themes.md)). Theme variables (`$primary`, `$dark`, `$classy-bg-*`, typography, borders) are overridable via the `with (...)` block. See [themes.md](themes.md) for the full variable reference.

## Bootstrap-first convention

NEVER create custom classes for things Bootstrap already provides — use `btn`, `card`, `form-*`, `d-flex`, `gap-*`, `rounded-*`, `bg-body-*`, `text-*` natively, and use `bg-body` variants (not `bg-light`/`bg-dark`) so dark mode adapts. Theme SCSS overrides how Bootstrap components LOOK; custom CSS is only for genuinely novel components with no Bootstrap equivalent. Same rule in BXM and UJM.

## See also

- [themes.md](themes.md) — theme variables, appearance modes
- [build-system.md](build-system.md) — where the `sass` task runs in the pipeline
- [templating.md](templating.md) — the page template that loads the bundles
