# Code Signing

Cross-platform code signing reference. Covers macOS (sign + notarize), Windows (EV token + cloud), and Linux (no signing required for AppImage/deb but Snap/Flatpak have their own conventions).

## tl;dr

- **macOS production**: Developer ID Application cert + notarization API key. Files in `build/certs/`. Env vars point at them.
- **Windows production**: EV USB token (self-hosted runner now) or cloud signing (future, pluggable via `targets.win.signing.strategy`).
- **Linux**: No signing for AppImage/deb. Snap/Flatpak have their own pipelines.

## Where files live

```
<your-app>/
  build/
    entitlements.mac.plist             # universal — already in EM defaults
    icon.icns / icon.ico / icon.png    # per-brand
    certs/                             # gitignored
      developer-id-application.p12     # universal across team
      developer-id-installer.p12       # only for .pkg builds (rare)
      AuthKey_XXXXXXXXXX.p8            # universal across team
      <app-name>.provisionprofile      # per-app (only if entitlements require)
  .env                                 # gitignored — env vars referencing build/certs/*
```

## What's universal vs per-brand

**Universal (one set per Apple Developer team / Windows signing identity):**
- Developer ID Application cert (`.p12`)
- Developer ID Installer cert (`.p12`) — only if you ship `.pkg`
- App Store Connect API key (`.p8`)
- Apple Team ID, Apple ID, app-specific password
- Windows EV USB token

**Per-brand (per app):**
- Provisioning profile (`.provisionprofile`) — only required if your app uses entitlements that Apple gates (push notifications, in-app purchase, network extensions, app groups, etc.)
- Icons (`icon.icns`, `icon.ico`, `icon.png`)

So for ITW Creative Works' multiple Electron apps signed by the same team, you generally drop the **same** `developer-id-application.p12` and `AuthKey_*.p8` into each app's `build/certs/`. The `.env` paths are identical across apps. Provisioning profiles, if needed, are unique per app.

## macOS setup

### 1. Apple Developer prerequisites

You need an Apple Developer Program membership ($99/year). Inside it:

1. **Developer ID Application certificate** — generate at Apple Developer → Certificates → `+` → "Developer ID Application." Download the `.cer`, install in Keychain Access, then export from Keychain as `.p12` with a password.
2. **App Store Connect API key** (preferred over Apple ID + app-specific password) — generate at App Store Connect → Users and Access → Keys → `+`. Download the `.p8` once (Apple won't show it again). Note the Key ID and Issuer ID shown on the page.
3. **Team ID** — visible in your Apple Developer membership page.

### 2. Drop files into your project

```bash
cp ~/Downloads/developer-id-application.p12 build/certs/
cp ~/Downloads/AuthKey_XXXXXXXXXX.p8        build/certs/
```

### 3. Wire `.env`

```bash
CSC_LINK=build/certs/developer-id-application.p12
CSC_KEY_PASSWORD=<password you set on export>

APPLE_API_KEY=build/certs/AuthKey_XXXXXXXXXX.p8
APPLE_API_KEY_ID=XXXXXXXXXX             # 10 chars from key filename
APPLE_API_ISSUER=00000000-0000-...      # UUID from App Store Connect

APPLE_TEAM_ID=XXXXXXXXXX
```

### 4. Verify

```bash
npx mgr validate-certs
```

This checks:
- macOS Keychain has a Developer ID Application identity
- `CSC_LINK` exists and is readable
- API key file exists and `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` are set
- Team ID matches the cert

### 5. Build + notarize

```bash
npm run release   # signs + notarizes + publishes
```

EM's built-in notarize is wired as electron-builder's `afterSign` hook (via `gulp/build-config`) and calls `@electron/notarize` with the API key creds. Consumers can extend it with an optional `hooks/notarize/post.js` for post-notarization work.

## Windows setup

### Self-hosted EV USB token (recommended for v1)

Buy an EV code-signing cert from Sectigo, DigiCert, SSL.com, etc. Get a physical USB token (you can't transfer EV certs).

1. Plug the token into a Windows machine that's registered as a self-hosted GitHub Actions runner labeled `windows`, `self-hosted`, `ev-token`.
2. Install the token's middleware (SafeNet, etc.) on that machine.
3. Set `.env` (on the runner):
   ```
   # config: { signing: { windows: { strategy: 'self-hosted' } } }
   WIN_EV_TOKEN_PATH=<container path or label>
   WIN_CSC_KEY_PASSWORD=<token PIN>
   ```
4. The `windows-sign` job in `.github/workflows/build.yml` will route signing to that runner.

`npx mgr sign-windows` is the strategy-aware command that drives `signtool` (or the cloud provider CLI).

### Cloud signing (future migration)

Once the framework's cloud strategy is finalized, set the provider in `config/electron-manager.json`:
```
# config: { targets: { win: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } }
# provider: 'azure' | 'sslcom' | 'digicert'
# Provider-specific creds (secrets) live in .env Custom Values section.
```

Provider modules will live in `src/lib/sign-providers/{azure,sslcom,digicert}.js` (Pass 3 work).

### Local (developer-machine) fallback

If no signing runner is available, CI uploads the unsigned `.exe` and a developer manually signs locally:
```
# config: { signing: { windows: { strategy: 'local' } } }
```

## Pushing secrets to GitHub Actions

EM ships a command that reads your local `.env` and pushes everything to the repo's GitHub Actions secrets, encrypted with the repo's libsodium public key. For env vars whose value is a path to a local file (`.p12`, `.p8`, etc.), the secret value pushed is the **base64-encoded file contents** — the workflow decodes back to a temp file at job start.

```bash
# Make sure .env has GH_TOKEN (a PAT with `repo` scope) plus all your signing creds
npx mgr push-secrets

# Push only specific keys
npx mgr push-secrets --only=CSC_LINK,CSC_KEY_PASSWORD

# Push everything including empty values (default skips empties)
npx mgr push-secrets --skip-empty=false
```

Behavior:
- Reads `.env` Default section only (Custom is yours; not pushed).
- Auto-detects "is this a path?" — relative or absolute paths ending in `.p12`/`.pem`/`.cer`/`.p8`/`.provisionprofile`/`.crt`/`.key`/`.json` that exist on disk get base64-encoded.
- Discovers `owner/repo` from `package.json`'s `repository.url` or git remote.
- Skips empty values by default (you'll get warnings on push for any unset key).

The corresponding decode step in CI looks like:

```yaml
- name: Decode signing assets
  run: |
    mkdir -p build/certs
    echo "${{ secrets.CSC_LINK }}" | base64 --decode > build/certs/dev-id.p12
    echo "${{ secrets.APPLE_API_KEY }}" | base64 --decode > build/certs/AuthKey.p8
  env:
    CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
    APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
    APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
    APPLE_TEAM_ID:    ${{ secrets.APPLE_TEAM_ID }}
- name: Build and release
  run: npm run release
  env:
    CSC_LINK:         build/certs/dev-id.p12
    APPLE_API_KEY:    build/certs/AuthKey.p8
    GH_TOKEN:         ${{ secrets.GH_TOKEN }}
```

This is wired up automatically in the `.github/workflows/build.yml` template (lands in Pass 3).

## CI integration

GitHub Actions secrets you'll need (per repo):

| Secret | Purpose |
|---|---|
| `GH_TOKEN` | Cross-repo publish, secret rotation |
| `BACKEND_MANAGER_KEY` | Privileged backend API calls |
| `CSC_LINK` | base64-encoded `.p12` (workflow decodes to file) |
| `CSC_KEY_PASSWORD` | `.p12` password |
| `APPLE_API_KEY` | base64-encoded `.p8` |
| `APPLE_API_KEY_ID` | Plain string |
| `APPLE_API_ISSUER` | UUID |
| `APPLE_TEAM_ID` | 10-char team ID |
| `WIN_CSC_LINK` (cloud) | Cloud signing creds (provider-specific) |

The workflow base64-decodes secrets into temp files inside `build/certs/` at job start, runs the build, and the runner's ephemeral filesystem cleans up afterward. Local `.env` files are never committed and never shipped.

## Troubleshooting

### "Could not find a certificate" on macOS
- Run `security find-identity -v -p codesigning` — you should see "Developer ID Application: <your name> (TEAMID)".
- If absent: re-import your `.p12` to Keychain Access and make sure the private key is included.

### Notarization timeout
- Confirm `APPLE_API_KEY` is the absolute path (or relative to repo root) and the file is readable.
- Confirm `APPLE_API_KEY_ID` matches the `XXXXXXXXXX` portion of the `AuthKey_XXXXXXXXXX.p8` filename.
- Confirm `APPLE_API_ISSUER` is the issuer UUID from App Store Connect → Users and Access → Keys.

### "Hardened runtime requires entitlements"
- EM generates `dist/build/entitlements.mac.plist` from defaults + your overrides at build time.
- Defaults cover Electron's needs (allow-jit, network client/server, library validation off, etc.).
- To override or add: set the `entitlements.mac` block in `config/electron-manager.json`. Setting a key to `null` removes a default.
  ```json5
  entitlements: {
    mac: {
      'com.apple.security.cs.allow-jit': false,           // override default
      'com.apple.security.device.camera': true,           // add a key
      'com.apple.security.network.server': null,          // remove a default
    },
  }
  ```

### Windows: "SignTool Error: No certificates were found"
- Token unplugged or middleware not running.
- For cloud: verify `targets.win.signing.cloud.provider` in `config/electron-manager.json` matches the provider whose creds are in `.env`.

## What lives in `build/`

`build/` in a consumer project holds **only** code-signing certificate files. Everything else (entitlements, icons, electron-builder config) is generated by EM into `dist/build/` at build time.

- **`build/certs/`** — `.p12`, `.p8`, `.cer`, `.mobileprovision` files. Per-developer / per-CI-runner. **Never commit** — `.gitignore` blocks them.
- **Nothing else.** `entitlements.mac.plist` is generated. App icons + DMG background + tray icons resolve from `config/icons/` (consumer override) → EM's bundled defaults. `electron-builder.yml` is generated.

The only file you usually create yourself in `build/` is the cert files in `build/certs/`. See [`build/certs/README.md`](../src/defaults/build/certs/README.md) for the full inventory.

## Related docs

- [`build/certs/README.md`](../src/defaults/build/certs/README.md) — cert file inventory
