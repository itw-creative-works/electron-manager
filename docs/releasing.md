# Releasing — From `.env` to GitHub Release

End-to-end walkthrough for cutting a signed + notarized + published release of an Electron Manager app.

## Repo layout (private app, public releases)

EM separates **three** GitHub repos for a typical app:

| Repo | Visibility | Purpose |
|---|---|---|
| `<owner>/<app>` | usually **private** | the app source code |
| `<owner>/update-server` | **public** | release artifacts + auto-update feed (`latest-mac.yml` etc.) |
| `<owner>/download-server` | **public** | fixed-name mirror at tag `installer` for marketing-site direct download links |

Why three? Auto-update feeds and marketing downloads MUST be publicly accessible (no auth headers in `electron-updater` or in `<a href>`). Your app source can stay private. The two public repos contain only binaries — no source code.

`npx mgr setup` auto-creates the two public repos if they don't exist (uses `GH_TOKEN`). Configure via `config/electron-manager.json`:

```jsonc
releases: {
  enabled: true,
  owner:   null,               // null = use app repo owner
  repo:    'update-server',
},
downloads: {
  enabled: true,
  owner:   null,
  repo:    'download-server',
  tag:     'installer',
},
```

After release, the auto-update feed lives at `<owner>/update-server` (versioned tags), and the marketing-site download mirror lives at `<owner>/download-server` @ tag `installer` (stable filenames — links never change across versions).


## Prerequisites

1. **Apple Developer membership** ($99/year) with a Developer ID Application certificate exported as `.p12`.
2. **App Store Connect API key** (`AuthKey_*.p8`) — generate at App Store Connect → Users and Access → Keys.
3. **GitHub Personal Access Token** with `repo` scope (for publishing releases + pushing CI secrets).
4. **Apple Team ID** — visible on developer.apple.com membership page.
5. (Optional) **Windows EV USB code-signing token** if you target Windows.

See [`docs/signing.md`](signing.md) for full cert setup details.

## One-time setup (per app)

```bash
cd <your-app>
npm i electron-manager --save-dev
npx mgr setup
```

`setup`:
1. Ensures peer deps (`gulp`, `electron`, `electron-builder`) are installed.
2. Writes EM's `projectScripts` into your `package.json` (`start`, `build`, `release`, `test`).
3. Copies framework defaults (config, builder yml, hooks, scaffold src/, build/) — merging `.env` and `.gitignore` so user customizations are preserved.
4. Validates signing prereqs (warns if missing — non-fatal).
5. Pushes secrets from `.env` → GitHub Actions if `GH_TOKEN` is present.

Now drop your cert files:

```bash
cp ~/Downloads/developer-id-application.p12 build/certs/
cp ~/Downloads/AuthKey_XXXXXXXXXX.p8        build/certs/
```

Edit `.env`:

```bash
GH_TOKEN="ghp_..."
BACKEND_MANAGER_KEY="..."

CSC_LINK="build/certs/developer-id-application.p12"
CSC_KEY_PASSWORD="<password>"

APPLE_API_KEY="build/certs/AuthKey_XXXXXXXXXX.p8"
APPLE_API_KEY_ID="XXXXXXXXXX"
APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
APPLE_TEAM_ID="XXXXXXXXXX"
```

Re-run setup to push the now-populated secrets to GitHub:

```bash
npx mgr setup
```

You should see ✓ for each secret in the output.

## Local release (manual, single-platform)

For testing the full sign + notarize + publish flow on your own machine:

```bash
npm run release
```

This runs as a **single gulp invocation** (`gulp publish` with `EM_BUILD_MODE=true EM_IS_PUBLISH=true`):
1. **build** — defaults → distribute → webpack/sass/html → audit → build-config (materializes `dist/electron-builder.yml` with mode-dependent injections like `LSUIElement` for tray-only)
2. **release** — `electron-builder build --publish always`
   - Signs the `.app` with your Developer ID Application cert
   - Calls EM's built-in `afterSign` hook which submits to Apple notarytool via the API key (consumer can extend via `hooks/notarize/post.js`)
   - Stapling + final `.dmg` / `.zip` packaging
   - Uploads to GitHub Releases (using `GH_TOKEN`)

The pipeline performs **one** sign+notarize cycle per architecture. (`npm run build` separately runs build + electron-builder package only — no publish, no GH upload — for local smoke-test artifacts.)

A successful release on macOS prints something like:

```
[notarize] Notarizing MyApp via App Store Connect API key (XXXXXXXXXX)...
[notarize] Done in 84s.
[release] Released 4 artifact(s):
  • release/MyApp-1.0.0-arm64.dmg
  • release/MyApp-1.0.0-arm64-mac.zip
  • release/MyApp-1.0.0-x64.dmg
  • release/MyApp-1.0.0-x64-mac.zip
```

The release will appear on the GitHub repo's Releases page (as a draft if `releaseType: draft` is set in `electron-builder.yml`, or published if `release`).

## Multi-platform release via CI

CI handles the cross-platform matrix. The default workflow (`.github/workflows/build.yml`) runs on push to `main`:

```
build (matrix: macos-latest, windows-latest, ubuntu-latest)
  └─ npm ci → npx mgr setup → platform-specific signing
windows-sign (only if EM_WIN_SIGN_STRATEGY != 'local')
  └─ runs on a self-hosted runner with EV USB token (or hosted windows-latest for cloud strategy)
  └─ signs + uploads release artifacts
```

The macOS step decodes `secrets.CSC_LINK` and `secrets.APPLE_API_KEY` (uploaded by `npx mgr push-secrets` as base64-encoded file contents) back to disk before running `npm run release`.

To trigger a release:
1. Bump version in `package.json` and `config/electron-manager.json` (`app.version`).
2. `git push` — workflow runs.
3. Watch the workflow at `https://github.com/<owner>/<repo>/actions`.

For a tagged release (which is what GitHub recommends for changelogs):
```bash
npm version patch    # or minor / major
git push --follow-tags
```

The workflow's `softprops/action-gh-release@v2` step uploads to the matching tag.

## Windows signing strategies

Set `EM_WIN_SIGN_STRATEGY` in `.env` (and as a GitHub repo variable for CI):

| Strategy | What runs | When to use |
|---|---|---|
| `self-hosted` (default) | Self-hosted runner with EV USB token; `npx mgr sign-windows` drives `signtool` | You own the EV token |
| `cloud` | Hosted `windows-latest`; `npx mgr sign-windows` shells out to provider CLI (Azure / SSL.com / DigiCert) | Future cloud-signing migration |
| `local` | CI uploads unsigned; you sign manually on your Windows box | No runner, no cloud — fallback |

For details see [`docs/signing.md`](signing.md#windows-setup).

## Troubleshooting

### "No notarytool API key" error
- Confirm `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` are all set.
- The key file's filename should match the pattern `AuthKey_<KEY_ID>.p8` and `<KEY_ID>` should equal `APPLE_API_KEY_ID`.

### "Could not find Developer ID Application certificate"
- Run `security find-identity -v -p codesigning` on macOS.
- If absent, re-import your `.p12` to Keychain Access (must include the private key).

### Notarization hangs / times out
- Apple's notarytool can take 1–10 minutes. The hook waits.
- Check the App Store Connect notarization history at https://appstoreconnect.apple.com/apps for status / errors.

### "Hardened runtime requires entitlements"
- `build/entitlements.mac.plist` is shipped by EM with the right defaults.
- If your app uses additional capabilities (camera, mic, etc.), add the matching entitlement keys.

### CI: GitHub Releases upload fails
- Verify `GH_TOKEN` secret is set. The auto-injected `GITHUB_TOKEN` won't work for cross-repo writes.
- Confirm the repo's `package.json` `repository.url` points at the right `<owner>/<repo>`.

## Related docs

- [`docs/signing.md`](signing.md) — cert file inventory, env vars, Windows strategy details
- [`docs/build-system.md`](build-system.md) — gulp tasks, webpack targets, electron-builder integration
- [`docs/startup.md`](startup.md) — `tray-only` mode injects `LSUIElement` into Info.plist at build-config time
