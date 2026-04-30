# Classy Theme Customization Guide

## How to Customize in Your Consuming Project

The Classy theme is designed to be fully customizable. All theme variables use `!default` which means you can override them BEFORE importing the theme.

### Example: Customizing Colors in Your Project

In your consuming project's `src/assets/css/main.scss`:

```scss
// 1. Override Classy theme variables BEFORE importing the theme
$primary: #FF0000;  // Change primary color to red
$classy-bg-light: #F5F5F5;  // Change light mode background
$classy-bg-dark: #1A1A1A;  // Change dark mode background
$font-family-sans-serif: 'Inter', sans-serif;  // Change font

// 2. Now import the Classy theme - it will use YOUR values
@import '~ultimate-jekyll-manager/src/assets/themes/classy/theme';

// 3. Add your custom styles below
.my-custom-class {
  // Your custom CSS
}
```

## Available Customizable Variables

See `_config.scss` for the full list of variables you can override:

### Bootstrap Colors
- `$primary` - Primary brand color
- `$secondary` - Secondary color
- `$success`, `$info`, `$warning`, `$danger` - Utility colors
- `$light`, `$dark` - Light and dark variants

### Background Colors
- `$classy-bg-light` - Light mode background
- `$classy-bg-dark` - Dark mode background

### Typography
- `$font-family-sans-serif` - Main font family
- `$headings-font-weight` - Heading font weight

### Border Radius
- `$border-radius` - Default border radius
- `$border-radius-sm`, `$border-radius-lg` - Size variants

### Gradients
- `$classy-gradient-primary`, `$classy-gradient-aurora`, etc.

## File Structure

```
classy/
├── _config.scss       ← All customizable variables with !default
├── _theme.scss        ← Main entry point, imports config then Bootstrap
├── css/base/
│   ├── _variables.scss  ← Internal non-customizable values
│   └── _root.scss       ← CSS custom property overrides
└── ...
```

## How It Works

1. **`_config.scss`**: Defines all variables with `!default` (can be overridden)
2. **Your `main.scss`**: Sets custom values BEFORE importing theme
3. **`_theme.scss`**: Imports config (uses your values or defaults), then Bootstrap
4. **`_root.scss`**: Converts SCSS variables to CSS custom properties for runtime

This ensures:
- ✅ You can customize anything
- ✅ Bootstrap gets configured with your colors
- ✅ CSS custom properties update for light/dark mode
- ✅ No need to modify theme files
