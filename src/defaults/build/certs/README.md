# `build/certs/` — Code-signing certificates and provisioning profiles

**Never commit anything in this directory.** The parent `.gitignore` excludes `*.p12`, `*.cer`, `*.mobileprovision`, `*.p8`, `*.pem` — and the entire `build/certs/` subdirectory is also ignored as a defense-in-depth measure.

## File inventory

### macOS (signing + notarization)

| File | Source | Used by | Env var pointing at it |
|---|---|---|---|
| `developer-id-application.p12` | Apple Developer → Certificates → "Developer ID Application" | electron-builder for code signing | `CSC_LINK` |
| `developer-id-installer.p12` | Apple Developer → Certificates → "Developer ID Installer" | electron-builder for `.pkg` signing (only if you ship a pkg installer) | `CSC_INSTALLER_LINK` |
| `AuthKey_XXXXXXXXXX.p8` | App Store Connect → Users and Access → Keys | Notarization via notarytool API | `APPLE_API_KEY` (path), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| `<app-name>.provisionprofile` | Apple Developer → Profiles → Developer ID Provisioning Profile | Required if your app uses entitlements requiring Apple's review (push notifications, in-app purchase, network extensions, etc.) | electron-builder auto-discovers in `build/` |

You also need (in `.env`, not in this directory):
- `CSC_KEY_PASSWORD` — password for the `.p12` files
- `APPLE_API_KEY_ID` — 10-char Key ID (matches the `XXXXXXXXXX` in the `.p8` filename)
- `APPLE_API_ISSUER` — issuer UUID from App Store Connect
- `APPLE_TEAM_ID` — 10-char team ID from developer.apple.com

### Windows (signing)

For self-hosted EV USB token:
| File / value | Source | Env var |
|---|---|---|
| (USB token plugged into self-hosted runner) | Sectigo / DigiCert / etc. EV cert physical token | `WIN_EV_TOKEN_PATH`, `WIN_CSC_KEY_PASSWORD` |

For cloud signing (future):
- Azure Trusted Signing — service principal creds in `.env`
- SSL.com eSigner — username + password + credential ID in `.env`
- DigiCert KeyLocker — API token + endpoint in `.env`

No file lives in `build/certs/` for Windows — credentials are env-vars-only.

## Are these per-brand or universal?

**Universal across brands you ship as the same Apple Developer team:**
- `developer-id-application.p12` — one per team, valid for all your apps
- `developer-id-installer.p12` — same
- `AuthKey_*.p8` — one per team, used for notarization across all apps
- Apple Team ID, Apple ID, app-specific password
- Windows EV token (one per team)

**Per-brand / per-app:**
- Provisioning profile (`*.provisionprofile`) — only required if entitlements demand it; tied to a specific bundle ID (`com.itwcw.<app>`)
- Icons (separate concern, live in `build/`, not `build/certs/`)

## Setup walkthrough

1. Drop the relevant cert files into this directory.
2. Edit `.env` at the repo root and point env vars at them (typically just `CSC_LINK=build/certs/developer-id-application.p12`).
3. Run `npx mgr validate-certs` to check the OS sees them and notarization creds are wired.
4. `npm run release` to do a signed + notarized build.

For full details see [`docs/signing.md`](../../docs/signing.md) at the EM repo root.

## CI

In CI (GitHub Actions), certs are passed via secrets, not files. The workflow base64-decodes secret values into temp files at runtime, points env vars at them, then nukes the files after the build. See `src/defaults/.github/workflows/build.yml` (when added in Pass 3).
