# Installer & Distribution Options

Single source of truth for everything that controls how your app is packaged + delivered to end users. EM owns the *target type* choices (NSIS on Windows, DMG+zip on Mac, deb+AppImage on Linux) and lets you configure the per-target UX through a small set of config knobs.

## Why EM owns the target list

EM picks specific installer types because they're the only ones that play well with the auto-update mechanism + cross-platform release pipeline:

| Platform | Target | Why |
|---|---|---|
| **macOS** | `dmg` + `zip` | DMG is the user-facing installer, zip is what `electron-updater` consumes for the auto-update feed. Universal binary (one .dmg works on Intel + Apple Silicon). |
| **Windows** | `nsis` | The only target that integrates with `electron-updater` for delta updates. Squirrel.Windows works too but installs to a weird per-user location with no Add/Remove Programs entry. MSI uses Windows Installer's own update mechanism (no electron-updater). |
| **Linux** | `deb` + `AppImage` (+ optional `snap`) | `deb` for Ubuntu/Debian/Mint users, `AppImage` for distro-agnostic distribution. `snap` opt-in for Snap Store distribution. |

If you genuinely need a different target (Squirrel for "no installer UI" UX, MSI for enterprise, MAS for App Store), use the raw `electronBuilder` override block in `electron-manager.json` — that's an escape hatch into electron-builder's full config surface. We just don't expose those choices in the consumer-facing API to keep the default path safe.

## Cross-platform fields (`app.*`)

These apply identically on every OS — set them once.

| Field | Default | What it does |
|---|---|---|
| `app.category` | `'productivity'` | Generic app category. EM maps to `mac.category` (Apple UTI) and `linux.category` (freedesktop). Allowed: `productivity`, `developer-tools`, `utilities`, `media`, `social`, `network`. |
| `app.copyright` | `'© {YEAR}, ITW Creative Works'` | Copyright string. `{YEAR}` token is expanded to the current year at build time, so the string stays current without consumers ever editing it. |
| `app.languages` | `['en']` | Locale list. Applied as `mac.electronLanguages` (which strips other locales' `.lproj` dirs from the .app bundle). win/linux currently ignore this. |
| `app.darkModeSupport` | `true` | macOS honors via `NSRequiresAquaSystemAppearance: false` in Info.plist. Win/linux ignore. |

### Category mapping table

| `app.category` | mac (`mac.category`) | linux (`linux.category`) |
|---|---|---|
| `productivity` (default) | `public.app-category.productivity` | `Utility` |
| `developer-tools` | `public.app-category.developer-tools` | `Development` |
| `utilities` | `public.app-category.utilities` | `Utility` |
| `media` | `public.app-category.entertainment` | `AudioVideo` |
| `social` | `public.app-category.social-networking` | `Network` |
| `network` | `public.app-category.business` | `Network` |

If you need a per-platform value not in the table, use the raw `electronBuilder.mac.category` / `electronBuilder.linux.category` override.

## Windows (`targets.win.*`)

| Field | Default | What it does |
|---|---|---|
| `targets.win.arch` | `['x64', 'ia32']` | Architectures. Single multi-arch NSIS installer ships both. |
| `targets.win.oneClick` | `true` | Slack-style: no installer wizard, just installs immediately to `%LocalAppData%\Programs\<App>`. Set to `false` for a standard "Next, Next, Finish" wizard. |
| `targets.win.desktopShortcut` | `true` | Create desktop shortcut. |
| `targets.win.startMenuShortcut` | `true` | Create Start menu entry. |
| `targets.win.runAfterFinish` | `true` | Auto-launch the app when the install completes. |
| `targets.win.perMachine` | `false` | Install for current user. Set `true` to install for all users (requires UAC elevation; **incompatible with `oneClick: true`**). |

### Why `oneClick: true` by default

Most Electron consumer apps default to `oneClick: true` (Slack, Discord) — it's a "nothing to think about" flow that gets users to your app fast. Trade-offs:
- ✅ No installer wizard, no choices for the user, fastest install
- ✅ Combined with `runAfterFinish: true`, the app just opens after install finishes
- ❌ Cannot install per-machine (incompatible with multi-user environments / enterprise)
- ❌ User can't pick install location (always per-user `%LocalAppData%`)

If your app needs enterprise deployment, set `oneClick: false` to opt into the wizard installer with `perMachine: true`.

### `ia32` (32-bit Windows)

EM ships `ia32` alongside `x64` in a single multi-arch installer. Real-world 32-bit Windows usage is <3%, but the cost of including it is just ~2x installer size + ~2x signing time — no separate code path. Worth keeping for the long-tail user on an old Win 10 machine. To drop, set `targets.win.arch: ['x64']`.

## macOS (`targets.mac.*`)

| Field | Default | What it does |
|---|---|---|
| `targets.mac.arch` | `['universal']` | Architectures. `universal` produces one .dmg/.zip that runs on both Intel and Apple Silicon (electron-builder lipo's the two arch binaries together). Override to `['arm64']` or `['x64']` for single-arch builds. |
| `targets.mac.mas.*` | (stubbed) | Mac App Store distribution config. **Not yet implemented** — see "MAS distribution" below. |

### Universal binary trade-off

`universal` produces ~2x file size (~225MB vs ~117MB) and ~2x build time on the Mac CI runner (builds both archs sequentially then stitches with `lipo`). Win: one .dmg link to give users — no "which one do I download?" flow.

### MAS distribution (stubbed)

Mac App Store config keys exist in EM (`targets.mac.mas.{enabled, provisioningProfile, entitlements, entitlementsInherit}`) but **are not yet wired up** — setting `enabled: true` triggers an audit warning and is otherwise ignored. The standard DMG+zip targets still build normally.

When MAS support lands, the work covered will be: separate `mas` target alongside DMG/zip, separate sandbox entitlements (4 plist files instead of 1), provisioning profile copy from `config/embedded.provisionprofile`, application-groups derivation, App Store Connect submission flow (manual via Transporter, not GH Releases).

Reference plists from a working MAS-published Electron app (Slapform) are archived at `<em>/src/defaults/_mas/` for the eventual implementation.

## Linux (`targets.linux.*`)

| Field | Default | What it does |
|---|---|---|
| `targets.linux.arch` | `['x64']` | Architectures. ia32 is essentially extinct on modern Linux. |
| `targets.linux.snap.enabled` | `false` | Opt into Snap Store publishing. |
| `targets.linux.snap.confinement` | `'strict'` | `strict` (sandboxed) or `classic` (unrestricted, requires Snap Store approval). |
| `targets.linux.snap.grade` | `'stable'` | `stable` or `devel`. |
| `targets.linux.snap.autoStart` | `true` | Register the snap to auto-start on login. |
| `targets.linux.snap.channels` | `['stable']` | Snap Store channels to publish to. |

### Snap Store publishing

Disabled by default because it requires (a) a Ubuntu One account, (b) one-time interactive credential minting, and (c) a Snap Store namespace registration. To enable:

1. Set `targets.linux.snap.enabled: true` in `config/electron-manager.json`.
2. Mint store credentials locally:
   ```bash
   snapcraft export-login -    # writes a credentials blob to stdout
   ```
3. Paste the entire blob (multi-line) into `.env` as `SNAPCRAFT_STORE_CREDENTIALS=...`.
4. Run `npx mgr push-secrets` to flow the secret to GitHub Actions.
5. Next `npm run release` will build + upload the snap automatically.

Reference: the workflow's Linux step conditionally installs `snapcraft` (via `sudo snap install snapcraft --classic`) only when the consumer's config has `snap.enabled: true`. So apps that never publish to Snap don't pay the install cost.

## File associations + custom protocols (uncommon)

Available for the rare app that needs them — both pass through to electron-builder verbatim.

```jsonc
{
  fileAssociations: [
    { name: 'My Document', description: 'My App document', ext: 'mydoc', role: 'Editor' },
  ],
  protocols: [
    { name: 'CustomScheme', schemes: ['mycustom'] },
  ],
}
```

`protocols` is **additive** — EM auto-registers `<brand.id>://` for every app (handled by `lib/protocol.js` at runtime). Use this to add EXTRA schemes (e.g., to handle `mailto:` if you're a custom email client).

99% of apps don't need either of these — leave both unset.

## Raw `electronBuilder` overrides (escape hatch)

For anything EM doesn't expose, set the value directly on `config.electronBuilder.*` in `electron-manager.json`. EM merges your overrides on top of its generated config:

```jsonc
{
  electronBuilder: {
    mac: {
      target: [{ target: 'mas', arch: ['universal'] }],   // add MAS as an extra target
    },
    win: {
      target: [
        { target: 'nsis', arch: ['x64', 'ia32'] },
        { target: 'msi',  arch: ['x64'] },                 // add MSI alongside NSIS
      ],
    },
  },
}
```

Use this for: legacy apps migrating from a custom builder config, enterprise deployments needing MSI, MAS apps until first-class support lands. Generally try the EM-native config first.
