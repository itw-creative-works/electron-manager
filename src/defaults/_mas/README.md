# MAS (Mac App Store) Reference Plists — ARCHIVED

These entitlement plists are reference material for a future Mac App Store
distribution implementation. They are **NOT** part of the active scaffold copied
to consumers by `mgr setup` (the leading `_` keeps them out).

## Source

Copied from a working MAS-published Electron app (Slapform, last shipped to the
App Store in March 2025). The configurations here are known-good for the use
cases:

| File | Purpose |
|---|---|
| `entitlements.mas.plist` | Main MAS app sandbox entitlements (network, file picker access, JIT, application-groups). |
| `entitlements.mas.inherit.plist` | Inherited entitlements for child processes (`com.apple.security.inherit`). |
| `entitlements.mas.loginhelper.plist` | Minimal entitlements for the optional MAS login-helper bundle. |

Note that `entitlements.mas.plist` references `application-groups` with a
team-ID-prefixed identifier (e.g. `9S9QEYN7C6.com.itwcreativeworks.slapform`).
The actual implementation will need to derive this from the consumer's Apple
Team ID + appId at build time.

## Roadmap

When MAS support is implemented (currently stubbed in
`config.targets.mac.mas` — see `docs/installer-options.md`), this folder will be
the starting point for the entitlements EM auto-generates into `dist/build/`
when `mac.mas.enabled === true`. The structure should be similar to the existing
`writeMacEntitlements` flow but with separate output files for `mas`, `mas.inherit`,
and `mas.loginhelper`.

The other MAS-specific concerns:
- Provisioning profile copy (`config/embedded.provisionprofile` → `dist/build/`)
- Separate `mas` target in `mac.target` (alongside `dmg` + `zip`)
- `mas:` config block with `hardenedRuntime: false`, `gatekeeperAssess: false`,
  separate entitlement paths, and `publish: null` (App Store Connect submission
  is manual, not GH Releases).

## Why these are archived rather than implemented now

MAS distribution adds significant non-trivial complexity (sandboxed app, App Store
review cycle, separate provisioning profile per app, manual submission to App
Store Connect via Transporter or Xcode). It's the right move only for apps that
genuinely benefit from App Store distribution — most consumer apps ship via DMG
download from a website, not the Mac App Store.

If you need MAS now, the legacy electron-manager (pre-v1) had support that you
can adapt; otherwise wait for the EM v1.x implementation.
