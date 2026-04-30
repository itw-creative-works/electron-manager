# Windows Code-Signing Runner

EM ships a self-bootstrapping Windows runner so you can EV-token sign every consumer app from a single Windows box, with zero per-org setup after the initial bootstrap.

## Why a runner?

EV (Extended Validation) code signing for Windows requires a physical USB token that has to be plugged in to the machine doing the signing. GitHub-hosted Windows runners can't access your USB token. Cloud signing services exist (Azure Trusted Signing / SSL.com / DigiCert KeyLocker) but they're paid, slow to onboard, and you've already paid for an EV cert.

So: one self-hosted runner, owned by you, on a Windows box that lives somewhere with the EV token plugged in. Every consumer's `.github/workflows/build.yml` routes its `windows-sign` job to that runner via labels `[self-hosted, windows, ev-token]`.

## First-time test on Windows (start here)

Hand this section to a fresh Claude session on the Windows box. It's the linear path from a clean machine to a working signed binary.

**Prereqs on the Windows box:**
- Node 24+ installed (`winget install OpenJS.NodeJS.LTS` or download from nodejs.org)
- Git for Windows (`winget install Git.Git`)
- EV USB token plugged in, SafeNet (or vendor) drivers installed, token unlocked once after boot
- Visual Studio Build Tools 2022 with the "Desktop development with C++" workload (provides `signtool.exe`) — `winget install Microsoft.VisualStudio.2022.BuildTools` then in the Installer enable that workload
- A GitHub Personal Access Token (classic) with `repo`, `workflow`, `admin:org` scopes (https://github.com/settings/tokens). The runner-registration-token API requires `admin:org`; `manage_runners:org` alone is insufficient.

**Step 1 — Install EM globally:**
```powershell
npm install -g electron-manager
npx mgr version
```
Should print `electron-manager@1.0.0` (or newer).

**Step 2 — Smoke-test signtool against your EV token (no GitHub, no runner — just signing):**
```powershell
$env:WIN_EV_TOKEN_PATH = "C:\path\to\your-token-or-cert.cer"
$env:WIN_CSC_KEY_PASSWORD = "<your token password>"
npx mgr sign-windows --smoke
```
Copies `where.exe` to a temp location, signs it, verifies it, prints PASS/FAIL. If this fails, fix it before continuing — the runner just calls the same `signtool` underneath.

If smoke passes you've proven: drivers see the token, signtool finds the cert, your password is right, the timestamp server is reachable.

**Step 3 — Bootstrap the runner:**
```powershell
$env:GH_TOKEN = "ghp_xxx_with_admin_org_scope"
npx mgr runner bootstrap
npx mgr runner status
```
`status` should show the watcher service running and at least one org registered.

**Step 4 — Trigger a real signing job from the consumer side (do this on your Mac, not Windows):**
```bash
# On your Mac, in a consumer project (e.g. deployment-playground-desktop)
npx mgr publish
```
This kicks the GH Actions matrix. The Windows job builds unsigned, uploads `windows-unsigned`, and the `windows-sign` job dispatches to your runner box. Watch the run in the GH Actions UI.

**Step 5 — If the windows-sign job fails, debug on the Windows box:**
```powershell
# Watcher heartbeats + errors
type $env:USERPROFILE\.em-runner\watcher.log

# Service event log
eventvwr.msc   # Windows Logs → Application → filter source: actions-runner-svc

# Force a fresh smoke test
npx mgr sign-windows --smoke
```

If you hit any specific signtool error, jump to the "Debugging signtool errors" section below.

**What "done" looks like:**
- Smoke test prints PASS
- `runner status` shows healthy services + registered orgs
- A real `publish` run finishes with signed `.exe` artifacts attached to a GitHub Release

---

## One-time setup (Windows box, ever)

```powershell
# Run on the Windows box, ONE TIME, ever.
npm install -g electron-manager
$env:GH_TOKEN = "ghp_xxx_token_with_admin_org_scope"
npx mgr runner bootstrap
```

`bootstrap`:
1. Downloads `actions/runner` (pinned version) into `%USERPROFILE%\.em-runner\actions-runner\`.
2. Discovers every GitHub org you have admin on (via `GH_TOKEN`).
3. Registers a runner with labels `[self-hosted, windows, ev-token]` against each org.
4. Installs the `em-runner-watcher` Windows service that:
   - Polls GitHub every 60s for new orgs you've gained admin access to → auto-registers a runner there.
   - Self-updates EM via `npm i -g electron-manager@latest` on every tick (so the runner box always has the freshest CLI).
5. Starts the service. Auto-starts on boot.

Done. You never touch the Windows box again unless you replace the EV token or migrate hardware.

## What `GH_TOKEN` needs

For full automation (auto-registering against new orgs without prompting), the token needs **`admin:org` scope** on every org you want serviced. Issue a fresh PAT (classic) at <https://github.com/settings/tokens> with:

- `repo` (full)
- `workflow`
- `admin:org` (full)

**Why not `manage_runners:org`?** GitHub's UI lists it as a minimum-privilege scope under `admin:org`, but the actual REST endpoint EM uses (`POST /orgs/{org}/actions/runners/registration-token`) explicitly requires `admin:org` (full) per their docs. `manage_runners:org` alone returns 403. Fine-grained tokens with "Self-hosted runners: write" do work but must be issued per-org, defeating auto-discovery.

If your token only has `repo` scope, runner registration will fail per-org with a clear message telling you to broaden the scope.

## Day-to-day on Windows

```powershell
npx mgr runner status         # show service state, registered orgs, last poll
npx mgr runner start          # start services if stopped
npx mgr runner stop           # stop services
npx mgr runner self-update    # force an immediate npm i -g electron-manager@latest
npx mgr runner uninstall      # full removal: deregister from every org, delete services
```

## On-demand signing (the most useful command for debugging)

You can run signing **without doing a full release**. Three modes:

### Smoke test — fastest validation that everything works

```powershell
$env:WIN_EV_TOKEN_PATH = "C:\path\to\token.cer"     # or your .pfx for testing
$env:WIN_CSC_KEY_PASSWORD = "<token password>"
npx mgr sign-windows --smoke
```

Copies `%WINDIR%\System32\where.exe` to a temp dir, runs the full `signtool sign` + `signtool verify` flow against it, prints PASS/FAIL with diagnosis. Cleans up after itself. **This is the first thing to run if anything's broken.**

### Sign a single binary you already have

```powershell
npx mgr sign-windows --target "C:\path\to\some-installer.exe"
```

Useful when CI gives you an unsigned `.exe` artifact and you want to test signing it locally before debugging the runner.

### Verify a signed binary's signature

```powershell
npx mgr sign-windows --target "C:\path\to\some-installer.exe" --verify-only
```

Reports whether the file is signed, by whom, and prints the cert chain. Doesn't sign.

### Sign every artifact in `./release/`

```powershell
npx mgr sign-windows --in release/ --out release/signed/
```

Standard mode. Used by the GH Actions workflow.

### Required env vars for signing

| Var | Purpose |
|---|---|
| `WIN_EV_TOKEN_PATH` (or `WIN_CSC_LINK`) | Path to the `.cer` / `.pfx` / token reference signtool consumes |
| `WIN_CSC_KEY_PASSWORD` | Token password (cached in SafeNet client for unattended signing) |
| `WIN_TIMESTAMP_URL` | Optional — defaults to `http://timestamp.sectigo.com` |
| `SIGNTOOL_PATH` | Optional — explicit path to signtool.exe; defaults to `signtool` on PATH (requires Windows SDK or VS Build Tools) |
| `EM_WIN_SIGN_STRATEGY` | `self-hosted` (default) / `cloud` / `local` |

## Adding a new org

**Zero Windows interaction.** Just create or get added as admin to a new GH org. Within ~60s the watcher polls, sees the new org, and auto-registers a runner against it. Your next `npx mgr setup` on a consumer in that org finds the runner waiting.

You can also force-register manually:
```powershell
npx mgr runner register-org <org-name>
```

## EV USB token requirements

These are *physical* / *driver-level* prerequisites EM can't automate:

1. EV USB token plugged in to the Windows box.
2. SafeNet (or vendor-equivalent) drivers installed.
3. Token unlocked once after every boot — there's typically a tray icon prompting for the password the first time `signtool` accesses the token. **For unattended signing, configure SafeNet client to cache the token password** (driver-specific; see SafeNet docs).

EM's `validate-certs` command will warn if it detects a missing token / driver, but can't install drivers for you.

## Architecture: Mac side ↔ Windows side

```
┌──────────────────────────────────┐         ┌────────────────────────────────────┐
│  YOUR MAC (developer)            │         │  WINDOWS BOX (signing runner)      │
│                                  │         │                                    │
│  npx mgr setup                   │         │  npx mgr runner bootstrap          │
│  (per consumer project)          │         │  (one time, ever)                  │
│                                  │         │                                    │
│  • detects org                   │         │  • downloads actions/runner        │
│  • validates GH org has runner   │         │  • registers vs every admin org    │
│  • non-fatal warning if missing  │         │  • installs em-runner-watcher svc  │
│                                  │         │                                    │
└──────────────┬───────────────────┘         └──────────────┬─────────────────────┘
               │                                            │
               │   GitHub Actions workflow:                 │
               │   runs-on: [self-hosted, windows,          │
               │             ev-token]                      │
               └────────────────────► ──────────────────────┘
                                      Job picked up by the runner.
                                      sign-windows.js runs against
                                      the EV token and uploads signed
                                      artifacts back to the workflow.
```

## Continuing this work in a new chat (start cold from Windows)

Open this repo's `docs/runner.md` in your new chat and ask the assistant to "continue the EM Pass 2.20 Windows runner work — see PROGRESS.md and docs/runner.md." Hand it the output of:

```powershell
npx mgr runner status                   # service health
type %USERPROFILE%\.em-runner\watcher.log  # last 50 lines of watcher log
$env:GH_TOKEN = "ghp_..."               # confirm scope: settings/tokens shows admin:org checked
npx mgr sign-windows --smoke            # smoke test
```

That's enough to give a fresh assistant the full state needed to continue.

## Debugging signtool errors (signing failures)

### "SignTool Error: No certificates were found that met all the given criteria"
- EV token isn't plugged in, or SafeNet client doesn't see it.
- Open SafeNet Authentication Client (tray icon) → confirm token shows up.
- If the token is there but signtool still can't see it, run `certutil -store -user My` and confirm the cert is listed under your user store.
- Try `npx mgr sign-windows --smoke` to isolate.

### "SignTool Error: An error occurred while attempting to sign: ..."
Followed by a more specific message. The most common ones:
- **"The specified network password is not correct"** — `WIN_CSC_KEY_PASSWORD` wrong, OR token was unlocked recently with a different password and the cache is stale. Clear SafeNet's password cache: tray icon → Tools → Advanced View → right-click token → Clear Token Password.
- **"The hash on the file is malformed"** — the binary you're trying to sign isn't a valid PE/COFF (probably zero-byte or truncated). Check `.exe` size.
- **"The timestamp signature and/or certificate could not be verified or is malformed"** — timestamp server is down. Set `$env:WIN_TIMESTAMP_URL = "http://timestamp.digicert.com"` and retry.

### `signtool` not found
Windows SDK or Visual Studio Build Tools provides it. Quickest install: `winget install Microsoft.VisualStudio.2022.BuildTools` then add `C:\Program Files (x86)\Windows Kits\10\bin\<sdk-version>\x64\` to PATH. Or set `$env:SIGNTOOL_PATH` explicitly.

### Signing works manually but fails as a service
The Windows service runs as `LocalSystem` (or the account you configured) — that account may not have access to the EV token. Two fixes:
- Reconfigure the service to run as your own user account: `services.msc` → find `actions.runner.<owner>.<runner-name>` → Properties → Log On → "This account" → enter your credentials.
- Or: install SafeNet client with "Per-machine" mode so the token is accessible from any account.

### `register-org` fails with 403
Your `GH_TOKEN` lacks `admin:org` scope for that org. Re-issue the token at <https://github.com/settings/tokens> with `admin:org` (full) checked. `manage_runners:org` alone is insufficient — see "What `GH_TOKEN` needs" above.

### `actions.runner` service won't start
1. Open `eventvwr.msc` → Windows Logs → Application. Look for entries from `actions-runner-svc`.
2. Common cause: working directory `%USERPROFILE%\.em-runner\actions-runner` isn't writable by the service account. Either fix permissions or change the service's "Log On" user.

### Watcher service appears installed but isn't ticking
Check `%USERPROFILE%\.em-runner\watcher.log`. If it stops after a `tick: error GH API …`, your `GH_TOKEN` rotated or got revoked. Re-set it via `$env:GH_TOKEN = …` (in the service's environment, not just your shell — easiest: `npx mgr runner uninstall && npx mgr runner bootstrap` to reinstall the service with the new token baked in).

### After Windows update, signtool can't find the token
The SafeNet driver sometimes detaches after major OS updates. Open SafeNet Authentication Client tray app → check token shows up → run `npx mgr runner status` to confirm services are healthy. Then `npx mgr sign-windows --smoke` to validate end-to-end.

## Useful files / paths to check

| Path | What's there |
|---|---|
| `%USERPROFILE%\.em-runner\` | EM-managed runner state |
| `%USERPROFILE%\.em-runner\actions-runner\` | GitHub's actions/runner binary |
| `%USERPROFILE%\.em-runner\watcher\watcher.js` | The auto-registration daemon |
| `%USERPROFILE%\.em-runner\watcher.log` | Watcher heartbeats + errors |
| `%USERPROFILE%\.em-runner\config.json` | Bootstrap timestamp, registered orgs, labels |
| `eventvwr.msc` → Application | Service start/stop events for both services |

## Pinning + upgrades

EM pins the `actions/runner` version it downloads (look at `ACTIONS_RUNNER_VERSION` in `src/commands/runner.js`). To upgrade the runner binary itself, bump that constant in EM, ship a new release, and the watcher's self-update will pull the new EM. On next bootstrap the new version is downloaded; existing installations are not auto-replaced (safer — runner upgrades sometimes change the service registration flow).
