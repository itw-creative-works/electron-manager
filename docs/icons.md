# Icons

Convention-only. No config block — drop PNGs at known paths and EM finds them.

## Layout

```
config/icons/
  global/             ← used by any platform with no platform-specific override
    icon.png
    tray.png
  macos/              ← macOS overrides (beats global)
    icon.png
    tray.png          ← 32×32 native; EM renames to trayTemplate.png in dist
    dmg.png           ← 1080×760 DMG installer background
  windows/            ← Windows overrides
    icon.png
    tray.png          ← optional; falls back to icon.png
  linux/              ← Linux overrides
    icon.png
    tray.png
```

## Resolution chain (per slot, per platform)

Most specific wins:

1. `<projectRoot>/config/icons/<platform>/<file>` — platform-specific override
2. `<projectRoot>/config/icons/global/<file>` — universal fallback shared by all platforms
3. `<projectRoot>/config/icons/windows/<file>` — Linux-only extra step (legacy compat — Linux apps historically reuse Windows assets)
4. `<EM>/dist/config/icons/<platform>/<file>` — EM bundled default
5. `<EM>/dist/config/icons/windows/<file>` — Linux-only extra step at the bundled level

Inside the runtime tray lookup (`lib/tray.js`), tray-slot misses fall back to the app icon (`icon.png`) instead of returning null.

## Sizes — ship @2x native only

Retina slots (macOS tray, macOS dmg) take ONE source file at the native (@2x) size. EM downscales the @1x sibling at build time via `sharp` and writes both into `dist/`. Consumers never ship `<name>@2x.png` files.

| Slot | Native size | EM emits |
|---|---|---|
| `macos/tray.png` | 32×32 | `trayTemplate.png` (16×16) + `trayTemplate@2x.png` (32×32) |
| `macos/dmg.png` | 1080×760 | `dmg.png` (540×380) + `dmg@2x.png` (1080×760) |
| `macos/icon.png` | 1024×1024 | `icon.png` (unchanged; electron-builder converts to `.icns`) |
| `windows/icon.png` | 1024×1024 | `icon.png` (unchanged; electron-builder converts to `.ico`) |
| `linux/icon.png` | 1024×1024 | `icon.png` (unchanged) |

## Why `trayTemplate.png` on disk

macOS reads the literal filename of the tray icon and treats any `*Template.png` as a "template image" — pure-black with alpha, automatically inverted in dark mode. Consumers ship `tray.png` (clearer naming, matches Windows/Linux); EM owns the `Template` suffix when writing to `dist/`.

If you set a custom path via `tray.icon(path)` in your `src/integrations/tray/index.js`, YOU are responsible for the runtime filename containing `Template` — EM only owns the convention path.

## Two common scenarios

**One icon for everything:**

```
config/icons/global/icon.png    # mac + win + linux
config/icons/global/tray.png    # mac + win + linux
```

**Mac-specific + shared Win/Linux:**

```
config/icons/global/icon.png    # win + linux use this
config/icons/macos/icon.png     # mac override
config/icons/macos/tray.png     # mac-specific tray (will become trayTemplate.png in dist)
config/icons/macos/dmg.png      # mac-only by definition
```

## Source files

- `src/lib/sign-helpers/resolve-icons.js` — the resolver itself; called from `gulp/build-config.js`.
- `src/lib/tray.js#_defaultIconPath` — runtime tray lookup (same convention waterfall, but checks `dist/` first since the build already resolved).

## Bundled defaults

EM ships its own `icon.png`, `tray.png`, `dmg.png` for each platform in `<EM>/src/defaults/config/icons/<platform>/`. These are the final fallback when neither the consumer nor a global file provides anything — so a fresh `npx mgr setup` project produces a buildable app with the generic EM icon out of the box.
