# Changelog

## 1.2.20 — Windows auto-updater feed (latest.yml) generated post-sign

Closes the last gap in the Windows auto-update path. After signing the .exe,
`mgr sign-windows` now generates `latest.yml` (and a per-exe `.blockmap` for
delta updates) in the signed-output directory. `finalize-release` then
uploads them alongside the signed .exe to update-server.

### Why this had to happen

electron-builder generates `latest.yml` only as part of its publish flow.
Our pipeline signs Windows out-of-band (separate self-hosted runner,
EV USB token, signtool — see commands/sign-windows.js), so by the time we
have a signed binary, electron-builder is long gone and never wrote a yml.

The yml's `sha512` field MUST match the bytes of the signed binary —
generating it BEFORE signing would produce a hash that doesn't match the
final exe, and electron-updater would reject the update with a checksum
mismatch. So the only correct place to write it is right after signing,
which is what this version does.

### What's new

- `lib/sign-helpers/update-info.js` — pure module that computes sha512
  (raw bytes → base64), generates blockmap via `app-builder-bin`'s
  `blockmap` subcommand (best-effort; warns and skips if not resolvable
  — auto-updater still works without delta), and writes `latest.yml` in
  the canonical schema electron-updater expects.
- `commands/sign-windows.js` — after the signing loop, calls
  `writeUpdateInfo` for all signed `.exe` files. Failure is logged loudly
  but does not fail the sign step (signed binary is still valid).
- 11 new build-layer tests pinning sha512 base64 encoding, schema shape,
  end-to-end yml round-trip via real file IO, and error paths.

### Impact

After this version, a fresh `npm run release` from a Windows-EV-token
consumer produces a fully working auto-update path on Windows for the
first time. `latest.yml` is what electron-updater fetches from the GH
release to discover new versions; without it, Windows clients never see
new releases. Was the silent reason "draft → published" worked but no
Windows machine ever auto-updated.

## 1.2.19 — hyphenated artifact filenames across all platforms

`productName` containing a space (e.g. "Deployment Playground") was producing
inconsistent artifact filenames:

- mac dmg/zip used `${productName}-${version}-${arch}` → `Deployment Playground-1.0.6-arm64.dmg` (with literal space)
- nsis exe collapsed spaces to dots → `Deployment.Playground.Setup.1.0.6.exe`
- linux deb/AppImage varied per target

Fix: set `artifactName` on every target (mac/dmg/nsis/linux) using a sanitized
`safeProductName` where non-filename-safe chars become hyphens. All targets now
produce hyphenated filenames consistently, matching what `mirror-downloads`
already does for download-server stable names. After this:

- `Deployment-Playground-1.0.6-arm64.dmg`
- `Deployment-Playground-1.0.6-mac.zip`
- `Deployment-Playground-Setup-1.0.6.exe`
- `Deployment-Playground-1.0.6-x64.AppImage`
- `deployment-playground_1.0.6_amd64.deb` (Debian convention preserved)

## 1.2.18 — `/IT` flag on Logon Task so it binds to user's interactive session

Critical follow-up to 1.2.17. Without `/IT`, schtasks treats `/SC ONLOGON /RU
<user>` as a non-interactive batch logon — when the task runs, Windows creates
a fresh logon session for that user instead of binding to their already-active
desktop session. That fresh session has its own (empty) view of the user's
cert store and never loads the SafeNet eToken CSP, so `signtool` immediately
fails with "No certificates were found that met all the given criteria"
even though the same cert is visible in the user's actual desktop session.

Fix: pass `/IT` to `schtasks /Create`. `/IT` marks the task as interactive,
which means Windows binds it to the `/RU` user's existing logged-on session
at run time. Cert store, SafeNet driver state, and desktop access all flow
through, so `signtool` sees the cert and the SafeNet PIN dialog renders on
the visible desktop where automately can find and type into it.

Trade-off (already accepted): `/IT` tasks only run while the user is
interactively logged on. With Windows auto-logon configured (one-time setup),
this is a non-issue on a dedicated build box.

## 1.2.17 — `runner install` auto-starts the Logon Task

Follow-up to 1.2.16. After registering each per-org Logon Task, `register-org`
now also fires the task immediately via `schtasks /Run`, so the runner is
`online` on GitHub the moment install finishes — no need to log out and back
in to trigger the ONLOGON event. Previously every fresh install left runners
in `Ready, not Running` state and any queued workflow waited until the user
manually re-logged in or ran `npx mgr runner start`. Auto-start is best-effort:
if `/Run` fails (e.g. perms), we log a warning and leave registration intact;
the user can recover with `schtasks /Run /TN <name>` or by logging out + in.

Applies to both `mgr runner install` (multi-org) and `mgr runner register-org
<org>` (single-org), since the auto-start lives inside `registerOrg`.

## 1.2.16 — runner switched to Logon Task; workflow `platforms` input; draft-on-missing release

### Self-hosted runner: Windows Service → Logon Task

EV-token signing was the blocker for v1.2.13/14/15 — Windows Services run in
Session 0 (no desktop) and can't see the user's `CurrentUser\My` cert store
where SafeNet/eToken EV certs live, even when the service is configured to
run as the user account. The SafeNet "Token Logon" PIN dialog also requires
an interactive desktop to be typed into.

Fix: register each per-org runner as a **Scheduled Task running at logon in
the user's interactive Session 1**, instead of a Windows Service. Same EM
subcommands (`install`/`status`/`start`/`stop`/`uninstall`) — the underlying
mechanism is now Task Scheduler, not the Service Control Manager.

`runnerTaskName(org)` returns `em-runner-<host>-<org>`, matching the
GitHub-side runner name so log/debug correlation stays sane.

The legacy "service" terminology in user-facing strings is preserved where
it doesn't lie (still describes startup/shutdown/restart correctly), but
internals call them tasks.

### Workflow: `platforms` input for partial builds

`workflow_dispatch` now accepts a `platforms` input — comma-separated:
`all` (default), `mac`, `windows`, `linux`, or any combo. New `setup` job
resolves it into a JSON matrix consumed by `build` and per-platform booleans
consumed by `windows-strategy`/`windows-sign`. Lets you re-run JUST the
windows-sign half against an existing release without re-building mac/linux.

### `mgr release` adds `--platforms` flag

`npx mgr release --platforms windows` (or `--platform windows`) forwards
the value as a workflow input. Omitted = default = all platforms. Older
consumer workflows without the input declared continue to work unchanged.

### `finalize-release` creates a draft release if none exists

Previously failed with "Update-server release v1.0.0 not found" when a
partial-platform run kicked off windows-sign before mac/linux had created
the release. Now creates an empty draft if missing, so partial runs can
attach signed Windows assets and the next run fills in the rest. Draft
flips to published only by the `finalize` job once all expected platforms
have built.

## 1.2.15 — runner service runs AS the user (so signtool sees their cert store)

The runner service installed as `NT AUTHORITY\NETWORK SERVICE` by default, which
has its own (empty) Windows cert store. Signtool running under that identity
couldn't see EV USB-token certs imported under `CurrentUser\My`, so signing
failed with "No certificates were found that met all the given criteria"
even when WIN_EV_TOKEN_PATH was set correctly.

Fix: install the runner service to run as a specified Windows user account
via `config.cmd --windowslogonaccount <user> --windowslogonpassword <pass>`.

Three ways to supply credentials, priority order:
1. `WIN_RUNNER_LOGON_ACCOUNT` + `WIN_RUNNER_LOGON_PASSWORD` env vars (CI / .env)
2. DPAPI-encrypted file at `%APPDATA%\electron-manager\runner-logon.json`
3. Interactive prompt during `mgr runner install` (saves to DPAPI file for re-use)

If none of the above, falls back to NETWORK SERVICE (existing behavior).

New subcommand `mgr runner set-credentials` to update saved creds without
re-running install.

Note on security: the DPAPI-encrypted blob can only be decrypted by the same
user on the same machine. Even another admin on the box can't read it.

## 1.2.14 — _.env scaffold: actually include EV signing + EM test keys in Default

v1.2.13 claimed to add `WIN_EV_TOKEN_PATH` / `WIN_CSC_KEY_PASSWORD` / `SIGNTOOL_PATH`
to the default `.env` scaffold but the edit didn't land in `src/defaults/_.env`
(only in the changelog). v1.2.14 actually adds them.

Also moved `EM_TEST_FIREBASE_ADMIN_KEY` and `EM_TEST_USER_UID` from where they
ended up (Custom section, by accident) to Default — they're EM test framework
keys, not user-custom values. Custom section is now empty for new projects.

## 1.2.13 — windows EV signing: wire WIN_EV_TOKEN_PATH / WIN_CSC_KEY_PASSWORD / SIGNTOOL_PATH

Self-hosted Windows EV-token signing was broken end-to-end: the consumer's `.env`
scaffold didn't include the EV signing vars, and the `windows-sign` workflow job
didn't map them from secrets to the job env. Result: `npx mgr sign-windows` ran
but immediately threw "WIN_EV_TOKEN_PATH (or WIN_CSC_LINK) not set — cannot sign."

The old comment in `_.env` claimed signtool credentials "live on the runner machine
itself, not in the consumer's .env" — but the runner runs as `NT AUTHORITY\NETWORK
SERVICE` which doesn't read user-profile env files. The vars HAVE to be plumbed
through GH Actions secrets to reach the job.

Fixes:
1. Added `WIN_EV_TOKEN_PATH`, `WIN_CSC_KEY_PASSWORD`, `SIGNTOOL_PATH` to the default
   `_.env` scaffold (Default section, so `npx mgr push-secrets` picks them up).
2. Added the same three vars to the `windows-sign` job's `env:` block, mapped from
   `secrets.*`. Cloud-provider vars stay in place for when strategy=cloud.
3. Updated `_.env` doc comment to point at `Get-ChildItem Cert:\CurrentUser\My`
   for finding the cert thumbprint (which is what `WIN_EV_TOKEN_PATH` should be —
   signtool's `/sha1` selector matches by thumbprint).

After upgrade, consumers fill `WIN_EV_TOKEN_PATH` (cert thumbprint),
`WIN_CSC_KEY_PASSWORD` (SafeNet token PIN), and `SIGNTOOL_PATH` (full path to
signtool.exe on the runner host) in their `.env` Default section, then run
`npx mgr push-secrets` to push them to GH Actions secrets. The next workflow
run will sign successfully.

## 1.2.12 — workflow: windows-sign job uses cmd.exe (not PowerShell)

Self-hosted Windows runners commonly have PowerShell ExecutionPolicy set to
Restricted, which blocks the wrapper `.ps1` scripts GitHub Actions auto-
generates for every `run:` step:

> File ...c89a6a95-758b-4457-85e9-29bff742cffe.ps1 cannot be loaded because
> running scripts is disabled on this system.

Fix: pin `defaults.run.shell: cmd` for the windows-sign job. cmd.exe has no
ExecutionPolicy and runs the same `npm ci` / `npx ...` commands fine.

The hosted-runner jobs (build matrix) keep PowerShell as their default
because hosted runners ship with `RemoteSigned` policy already configured.

## 1.2.11 — runner: install to C:\actions-runners (escape user profile entirely)

v1.2.10 tried to fix the NETWORK SERVICE permission issue by walking up
ancestors with icacls — but it stopped AT `%USERPROFILE%` (don't grant
broader than needed). actions/runner walks `C:\Users\<user>` itself,
which still denied → still crashed.

Cleaner fix: install runners to `C:\actions-runners\` by default on Windows
instead of `<EM-clone>/.gh-runners`. NETWORK SERVICE has read access to
`C:\` by default, so no icacls walk is needed. The path's also shorter,
which helps with Windows MAX_PATH issues on deep node_modules trees inside
`_work/`.

Override via `EM_RUNNER_HOME` if you genuinely want it elsewhere.

Existing user-profile installs need to be uninstalled before upgrading:
`npx mgr runner uninstall && npx mgr runner install`.

(The icacls grant on the runner dir itself is kept for safety, but no longer
walks ancestors.)

## 1.2.10 — runner: grant NETWORK SERVICE access to runner dir + ancestors

The runner service runs as `NT AUTHORITY\NETWORK SERVICE` by default (no
explicit `--windowslogonaccount`). When the install path lives under the user
profile (e.g. `C:\Users\<user>\Documents\.../.gh-runners`) NETWORK SERVICE has
no read access, and the runner crashes at startup with:

> System.UnauthorizedAccessException: Access to the path '...\.gh-runners' is denied.

actions/runner's `ValidateExecutePermission` walks the entire path hierarchy
on startup, so granting access only on the runner dir isn't enough — every
ancestor up to the user profile must be traversable by NETWORK SERVICE.

Fix: after cloning the runner template into the per-org dir, run `icacls`:
1. Recursive `(OI)(CI)(RX)` on the runner dir itself.
2. Non-recursive `(RX)` on every ancestor up to `%USERPROFILE%` (stops there
   to avoid exposing siblings).

After this, the service starts cleanly and the runner shows as **online** at
GitHub instead of registering then immediately crashing.

## 1.2.9 — runner: delete stale runners before re-register, mirror: hyphen-separated names

### Runner: delete stale GitHub-side runners before re-registering

Re-running `mgr runner install` was leaving accumulated dead runners on the
GitHub org side. Each failed install left an offline runner behind. Each
subsequent install hit "A runner exists with the same name" and actions/runner
auto-suffixed the new name (e.g. `em-runner-...-deployment-p-2872`). The
service was created with the suffixed name, but EM's verify step expected the
clean name and threw "no service was created."

Fix: BEFORE register, list all runners on the org and delete any whose name
starts with `em-runner-<hostname>-<org>` (our convention). Conservative match
prefix means we never touch user-created runners or runners from other hosts.
Re-register then gets the clean name.

Also: the post-install service verify now matches `actions.runner.<org>.*`
instead of pinning the exact name, so even if a suffix slips through, it's
recognized.

### Mirror: hyphenated product names in stable filenames

`mirror-downloads.stableName` was stripping spaces from product names entirely:
`Deployment Playground` → `DeploymentPlayground.dmg`. Switched to replacing
non-filename-safe chars with hyphens: → `Deployment-Playground.dmg`. Matches
both common convention and what's already on update-server's electron-builder
artifacts (e.g. `Deployment-Playground-1.0.1-arm64.dmg`).

Naming examples for `productName: "Deployment Playground"`:

- `Deployment-Playground.dmg` (was `DeploymentPlayground.dmg`)
- `Deployment-Playground-Setup.exe` (was `DeploymentPlaygroundSetup.exe`)
- `Deployment-Playground.AppImage`
- `deployment-playground_amd64.deb` (lowercase + underscore per Debian convention, unchanged)

## 1.2.8 — runner install: stdio inherit so service install actually runs

The piped-stdio capture in v1.2.7 (and every prior version) was the reason
`config.cmd --runasservice` SILENTLY SKIPPED the service-creation step.
When Node's spawnSync captures stdout/stderr via pipes, the child sees no
console, and actions/runner's --runasservice path treats that as "non-
interactive, skip the service install."

Verified by running config.cmd directly from cmd.exe (inherited stdio): the
runner banner + "Service ... successfully installed" / "started successfully"
messages all printed and the service was actually created.

Fix: `stdio: 'inherit'` for the config.cmd spawn. The runner's banner and
progress now stream straight to the user's terminal during install (which
is fine — it looks like running it manually) and the service actually gets
created.

Side-effect: we lose the ability to capture stdout/stderr for surfacing in
error messages on non-zero exit. That's a fair trade — the inherited output
is right there in the terminal so the user can read it directly.

## 1.2.7 — runner install nukes per-org dirs before re-cloning (FOR REAL this time)

The actual root cause of all the runner-install failures: `mgr runner install`
was reusing per-org runner directories if `config.cmd` already existed in them
(this was meant to be an "idempotent skip if already cloned" optimization).
But once a runner has been registered, the dir contains `.runner`, `.credentials`,
and `_diag/` — actions/runner sees these and refuses to re-configure with:

> Cannot configure the runner because it is already configured. To reconfigure
> the runner, run 'config.cmd remove' or './config.sh remove' first.

So every "re-install" silently failed: config.cmd exited non-zero, no service
was ever created, but the registration call to GitHub had already happened
(or not — depending on order of operations).

Fix: always wipe the per-org dir before cloning from `_template`. An "install"
should always produce a fully-fresh state. Cost: ~2-3s extra per org (jetpack
remove + copy of ~120MB). Tradeoff is worth it — the previous "smart" reuse
made install completely unreliable on re-runs.

Also reverts the v1.2.5/v1.2.6 confusion around `svc.cmd`. Verified by hand:
`config.cmd --runasservice` from an elevated shell runs the full register +
service install + service start sequence in one shot. No separate `svc.cmd
install` step is needed. Windows runners don't ship `svc.cmd` at all — that
was an incorrect assumption from the v1.2.5 attempt.

Added a post-config sanity check that runs `sc query actions.runner.<org>.<name>`
and throws with a clear "not running as Administrator?" error if the service
doesn't exist after config.cmd succeeds.

## 1.2.6 — runner service install: actually correct this time

v1.2.5 dropped `--runasservice` from `config.cmd` and tried to call
`svc.cmd install` afterward. Problem: `svc.cmd` is GENERATED by `config.cmd`
ONLY when `--runasservice` is passed. Without it, the file never exists, and
every per-org service install failed with "svc.cmd is not recognized."

Correct flow (verified against actions/runner README):

1. `config.cmd --unattended ... --runasservice` — registers with GitHub AND
   drops `svc.cmd` into the runner dir. The `--runasservice` flag's "install
   the service" side-effect is what's silently skipped without explicit
   `--windowslogonaccount` creds, but its "drop svc.cmd helper scripts"
   side-effect always runs.
2. `svc.cmd install` — explicitly install the service. Defaults identity to
   `NT AUTHORITY\NETWORK SERVICE` (no creds needed). Requires admin.
3. `svc.cmd start` — start it.

Also: explicit existence check after step 1 — if `svc.cmd` is missing, throw
a clear error pointing at admin/elevation rather than leaving the user with
registered-but-orphaned runners.

## 1.2.5 — runner service install fix, status output overhaul, release spinner

### Critical fix: `npx mgr runner install` now actually installs the Windows services

The previous install flow registered each org's runner with GitHub via `config.cmd
--runasservice` — but `--runasservice` is silently ignored by actions/runner
unless `--windowslogonaccount` and `--windowslogonpassword` are also provided.
Result: every install since v1.0.0 created the registrations on GitHub's side
but **left zero Windows services** to actually run them. The runner showed up
in GH for ~30s then went offline because nothing was running it locally.

Switched to the explicit two-step flow:
1. `config.cmd --unattended --url ... --token ...` (without `--runasservice`)
2. `svc.cmd install` — creates the Windows service for that registration
3. `svc.cmd start` — starts it

After v1.2.5, `Get-Service actions.runner.*` should show one running service per
registered org. Before v1.2.5, that command returned nothing.

**Action required on Windows runner host**: re-run `npx mgr runner install` to
pick up the fix. Existing registrations will be uninstalled and re-created with
the missing service install step now included.

### `npx mgr runner status` output overhaul

Was uninformative — called `sc query actions.runner` (not a real service) and
just dumped 1060 errors. Now enumerates all `actions.runner.*` services on the
machine, prints each with state (RUNNING / STOPPED / NOT_INSTALLED) + a status
icon, and clearly tells you to run `install` if no services exist.

`start` and `stop` were similarly broken — now iterate over the discovered
services and emit one line per service with success/failure.

### `npx mgr release` spinner + elapsed + poll counter

Was static between log dumps (poll every 5s, terminal looked frozen for minutes
at a time when no new logs were emitting). Added an animated spinner line at
the bottom that tick at 250ms with: spinner frame, current run status, elapsed
time, poll count, and per-job symbols. Spinner clears before any real log line
prints, then re-renders. TTY-only — falls back to silent in non-TTY contexts
(CI logs, file output).

## 1.2.4 — silent octokit during release stream

`getOctokit({ silent: true })` passes a no-op logger to octokit so transient
404s during `mgr release` polling (in-progress jobs return 404 for log
endpoints until each step completes) don't spam the console. Errors still
surface via thrown rejections.

Cosmetic-only fix — the actual release flow worked end-to-end in v1.2.3.

## 1.2.3 — `npm run release` now triggers CI + streams logs locally

### `npm run release` redefined: trigger CI, stream logs, exit on success

Inspired by browser-extension-manager's local-feels-cloud release flow. Running
`npm run release` (or `npx mgr release`) in a consumer project now:

1. Discovers `owner/repo` from `package.json#repository.url` (falls back to
   `git remote get-url origin`).
2. POSTs `workflow_dispatch` to `<owner>/<repo>` workflow `build.yml` on the
   current git branch (override via `--ref`).
3. Polls every 5s for the new run, then for each job's logs as soon as they
   become fetchable (GH only exposes logs after each step completes — so the
   "stream" is a polite fiction, but a useful one).
4. Prints job-prefixed log lines as they arrive AND tees the full log
   (ANSI-stripped) to `logs/build.log`.
5. Exits 0 on success, 1 on any job failure.

The OLD `npm run release` behavior (local sign + notarize + publish from the
dev's own machine) is preserved as `npm run release:local` for the rare case
you actually want it.

`projectScripts` updated:
- `release` → `npx mgr release` (NEW — triggers CI)
- `release:local` → the old in-process release (signs + publishes locally)
- `package` → `npx cross-env EM_BUILD_MODE=true npm run gulp -- packageBuild`
  (build + electron-builder package, NO publish — used by Windows CI runner)

### CI workflow fixes (uncovered by run #2 in deployment-playground)

- **Windows job now runs `npm run package`** instead of `npm run build`.
  `gulp build` only compiles bundles — it doesn't run `electron-builder`, so
  the previous workflow produced no `release/*.exe` to upload as artifact.
  Switched to `gulp packageBuild` (build + package, no publish).
- **`windows-strategy` job now runs `npm ci`** before requiring `json5` to
  parse the consumer config. Previously it called `node -e "require('json5')"`
  on a freshly-checked-out repo with no node_modules, which crashed with
  MODULE_NOT_FOUND. The job needs full deps to read the JSON5 config without
  resorting to regex.
- **Mac/linux jobs now run `npm run release:local`** instead of
  `npm run release` (the new `release` script triggers CI — using it inside
  CI would be infinite recursion).

## 1.2.2 — fix mac entitlements path + windows env syntax

### Bugfixes uncovered by first end-to-end CI run

- **`build/entitlements.mac.plist: cannot read entitlement data`** — The
  generated `dist/electron-builder.yml` had path `build/entitlements.mac.plist`
  meant as project-relative, but `gulp/build-config.js`'s `rel()` helper was
  resolving it relative to `distRoot` instead of `projectRoot`. electron-builder
  reads paths from cwd (which is projectRoot), so codesign was looking at
  `<project>/build/entitlements.mac.plist` (doesn't exist) instead of
  `<project>/dist/build/entitlements.mac.plist`. Fixed by passing `projectRoot`
  through to `baseConfig()` and preferring it for relative path resolution.
- **`'EM_BUILD_MODE' is not recognized as an internal or external command`**
  on the Windows CI runner — cmd.exe doesn't accept the unix `VAR=value cmd`
  prefix. Switched the consumer-injected `projectScripts.{build,publish,release}`
  to `npx cross-env EM_BUILD_MODE=true ...`. Added `cross-env` as an EM dep
  (pulled in transitively, so `npx cross-env` works without consumer pkg.json
  changes).

## 1.2.1 — release pipeline finalize, manual-trigger workflow, CI test fixes

### Release pipeline — closes the v1.2.0 gap

- **Manual-trigger only** — `src/defaults/.github/workflows/build.yml` now uses
  `on: workflow_dispatch` only. Was triggering on every push to `main` which
  burned self-hosted Windows runner cycles for no reason.
- **Signed Windows binaries now reach the update-server release.** Previously
  `windows-sign` job uploaded via `softprops/action-gh-release@v2` gated on
  `startsWith(github.ref, 'refs/tags/')` — a gate that never fired since the
  workflow doesn't trigger on tag push. Replaced with a deterministic
  `npx mgr finalize-release --signed-dir release/signed` step that finds the
  release by `v${version}` and uploads via Octokit. Idempotent (clobbers
  existing assets with the same name).
- **Windows binaries also mirror to download-server.** Same finalize step
  uploads signed `.exe` to the consumer's `download-server@installer` tag with
  stable filenames (e.g. `Deployment-Playground-Setup.exe`) so marketing
  links never change. Mac/linux already mirrored via `gulp mirror-downloads`
  in their `npm run release` step; windows now matches.
- **Auto-updater feeds (latest.yml / latest-mac.yml / latest-linux.yml) and
  blockmaps are uploaded too** — windows-sign now signs + re-uploads the
  feed metadata so electron-updater can serve it from the same release.
- **Final "ensure published" job** flips the update-server release from
  Draft→Published via `npx mgr finalize-release --publish`. Also sanity-checks
  that all 3 auto-updater feeds are present and prints the release URL.

### `mgr finalize-release` command

New CLI command, two modes:

- `--signed-dir <path>` — upload signed Windows artifacts to update-server
  release (matched by `v${pkg.version}`), then mirror to download-server.
- `--publish` — flip update-server release Draft→Published, sanity-check
  auto-updater feeds.

Reads `config.releases.{owner,repo}` and `config.downloads.{owner,repo,tag}` —
falls back to the consumer's own GitHub owner if not set.

### CI test fixes

- **Audit suite no longer leaks publish-mode env into minimal scaffolds.**
  Workflow sets `EM_BUILD_MODE=true EM_IS_PUBLISH=true` globally — audit
  tests now explicitly clear those before running so they don't fail
  `brand.images.icon` file-existence checks against synthetic configs.
- **`tar can extract zip` test skips on Linux.** GNU tar doesn't support
  zip extraction; the production code path (Windows runner install) only
  ever runs on Windows where bsdtar handles zip natively. macOS also runs
  the test as smoke (bsdtar there too).

## 1.2.0 — windows rewrite, inset titlebar, hide-on-close, boot harness fixes

### Windows — lazy creation + inset titlebar + Discord-style hide-on-close

- **EM no longer auto-creates the main window.** Boot sequence step 13 (the old
  `createNamed('main')`) is gone. The consumer's `main.js` calls
  `manager.windows.create('main')` from inside `manager.initialize().then(() => { ... })`
  — typically gated on `if (!startup.isLaunchHidden())` so the same `main.js`
  works for both `'normal'` and `'hidden'` launch modes.
- **`manager.windows.create(name, overrides?)`** is the canonical entry point.
  Defaults baked in (no JSON config required):
  - `main` → `{ width: 1024, height: 720, hideOnClose: true,  view: 'main' }`
  - any other → `{ width: 800,  height: 600, hideOnClose: false, view: name   }`
  - merge order: framework defaults < `config.windows.<name>` < call-site overrides
- **Inset titlebar by default**:
  - macOS: `titleBarStyle: 'hiddenInset'` — OS-drawn traffic lights inset into
    the chrome region.
  - Windows: `titleBarStyle: 'hidden'` + `titleBarOverlay: { color, symbolColor,
    height: 36 }` — OS-drawn min/max/close buttons in the corner.
  - Linux: native frame.
  - Override per-window via `config.windows.<name>.titleBar = 'inset' | 'native'`
    or pass a custom `titleBarOverlay` object.
- **Page template moved to EM-internal** (`src/config/page-template.html`,
  copied to `dist/config/page-template.html` by prepare-package). Consumer's
  `<consumer>/config/page-template.html` is no longer read.
- **Draggable topbar in template** — `<div class="em-titlebar"><div
  class="em-titlebar__drag"></div></div>` with `-webkit-app-region: drag`.
  Sized per-platform via `themes/classy/css/components/_titlebar.scss` keyed off
  `html[data-platform]` (set by web-manager): mac → `padding-left: 70px`
  (clear traffic lights), windows → `padding-right: 140px` (clear native
  overlay), linux → `display: none` (native frame draws title bar).
- **Discord-style hide-on-close.** `main` window's X button hides instead of
  closes. Real quit only via Cmd+Q / role:'quit' menu / tray Quit / auto-updater
  install / programmatic `manager.quit({ force: true })`. Three escape hatches
  in the close handler:
  - `manager._allowQuit` — set by `manager.quit({ force: true })` and by
    `autoUpdater.installNow()` before `quitAndInstall()`.
  - `manager._isQuitting` — set by `app.on('before-quit')`, so any quit path
    Electron knows about (Cmd+Q, role:'quit' menu, programmatic `app.quit()`,
    OS shutdown) flows through naturally.
  - `win._emForceClose` — per-window override for one-off "close this for real"
    scenarios.
- **`manager.quit({ force })`** and **`manager.relaunch({ force })`** exposed on
  the live manager. `relaunch()` calls `autoUpdater.installNow()` if an update
  is downloaded, otherwise `app.relaunch() + app.quit()`.

### Auto-update background install (legacy parity)

- When a download finishes (`code: 'downloaded'`) AND the check was NOT
  user-initiated (background poll), `_setState` schedules `installNow()` after
  5s. User-initiated checks skip this so the consumer's UI can prompt instead.
  Apps update overnight without bothering the user — Discord-style.

### macOS dock auto-show

- `manager.windows.create()` and `manager.windows.show()` call `app.dock.show()`
  if the dock is hidden (LSUIElement parity). Apps with `startup.mode = 'hidden'`
  launch completely invisible (no dock icon, no Cmd+Tab, no taskbar) — the dock
  icon appears the moment UI is requested.

### Startup mode simplified

- **Removed `'tray-only'`** — was always identical to `'hidden'` (the same
  LSUIElement Info.plist flag). Now folded into `'hidden'`. `getMode()`
  validation rejects `'tray-only'` as unknown and falls back to `'normal'`.
- LSUIElement injection in `gulp/build-config` now keys off `startup.mode === 'hidden'`.
- `startup.isTrayOnly()` removed.

### Default config simplification

- **Removed `windows: {}` block** from defaults config. Windows are now driven
  entirely from `main.js`. Consumer adds the block back only to override
  defaults persistently.
- **Removed `<consumer>/config/page-template.html`** — replaced by
  EM-internal template at `<em>/dist/config/page-template.html`.

### Bug fixes

- **`createNamed` listener-attach order**: all event listeners (`close` /
  `closed` / `resize` / `move` / `ready-to-show` / etc.) now attach BEFORE
  `await loadFile()`. Previously the window could land in the registry but be
  missing listeners during the ms-window between BrowserWindow construction
  and load completion — boot tests + race-prone code would see inconsistent
  state.
- **`config.x` / `config.y` from overrides** now actually flow through to
  BrowserWindow opts. Was silently dropped.

### Boot harness improvements

- Harness defers via `setImmediate` so the consumer's `manager.initialize().then(...)`
  callback runs first (giving `windows.create('main')` time to fire).
- Polls for the main window for up to 3s before starting tests (handles the
  async portion of `windows.create()`).
- Exposes `require` / `process` / `Buffer` to inspect-fn bodies via
  `new Function` arg list (closures don't survive serialization).

### Tests

- **397 framework + 26 consumer boot tests** (was 397 + 25). New tests:
  X-button close behavior, manager.quit/relaunch, autoUpdater installNow flag,
  background install scheduling, page-template EM-internal verification, lazy
  windows.create, defaults-merge-overrides ordering, dock-show wired, startup
  mode validation rejecting tray-only, x/y flowing through overrides.

### Default scaffold polish

- `src/defaults/src/main.js` — three labeled sections with full `windows.create()`
  options reference inline (every supported opt commented with default value)
  + custom-logic examples (deep links, IPC handlers, `manager.<name>.disable()`,
  auto-update onStatus, app-state).
- `src/defaults/src/views/main/index.html` — bootstrap container + lead text +
  two action buttons (replaced the bare `<h1>` placeholder).

### Docs

- **CLAUDE.md** — boot sequence rewritten (added `before-quit` hook, removed
  auto-create), new "Windows (lazy creation, inset titlebar, Discord-style
  hide-on-close)" section, "Notable defaults" updates for windows/startup/titlebar.
- **README.md** — new bullets covering lazy windows + Discord-style hide-on-close,
  zero-bounce hidden launch, auto-update background install. Docs index updated.
- **docs/windows.md** — full rewrite with defaults, merge order, inset titlebar,
  hide-on-close escape hatches, dock auto-show, listener-attach guarantee.
- **docs/startup.md** — full rewrite with `'normal' | 'hidden'` only, typical
  main.js pattern, agent-app pairing.

## 1.1.0 — integrations rewrite, boot test layer, scaffold simplification

### Integrations (tray / menu / context-menu) — unified API

- **Shared id-path mutation API across all three libs** (`src/lib/_menu-mixin.js`):
  `find`, `has`, `update`, `remove`, `enable`, `show`, `hide`, `insertBefore`,
  `insertAfter`, `appendTo`. Available both during definition (on the builder arg)
  and at runtime via `manager.{tray,menu,contextMenu}.*`.
- **All three ship sensible default templates** with stable id-tagged items so
  consumers can target any default item with a single line. Defaults informed by
  legacy electron-manager:
  - **Menu**: full template with `main/about`, `main/check-for-updates`,
    `main/preferences` (hidden), `main/relaunch`, `main/quit` (mac App menu),
    `file/preferences` / `file/relaunch` / `file/quit` (win/linux), standard
    `edit/*` and `view/*`, plus dev-only `view/developer/*` submenu
    (toggle-devtools, inspect-elements, force-reload) and dev-only
    `development/*` top-level (open-exe-folder, open-user-data, open-logs,
    open-app-config, throw test-error). `help/website` auto-added when
    `brand.url` is configured.
  - **Tray**: `title`, `open`, `check-for-updates`, `website`, `quit` (flat ids).
  - **Context-menu**: `undo`/`redo` (gated on `editFlags.canUndo`/`canRedo`),
    `cut`/`copy`/`paste`/`paste-and-match-style`/`select-all` (when editable),
    `open-link`/`copy-link` (when on link), `reload` (always),
    `inspect`/`toggle-devtools` (dev only).
- **Tray auto-resolves icon + tooltip** when not explicitly set. Icon waterfall:
  `app.icons.tray<Platform>` config → `<root>/dist/build/icons/<platform>/<file>`
  (populated by `gulp/build-config`) → consumer file convention. Tooltip falls
  back to `app.productName`. Consumer `src/integrations/tray/index.js` is now
  truly optional.
- **Auto-updater menu+tray hook** — patches both `manager.menu` (`main/check-for-updates`
  on mac, `help/check-for-updates` on win/linux) AND `manager.tray`
  (`check-for-updates`) in lockstep. Label updates dynamically based on update
  status (Checking → Downloading 42% → Restart to Update v1.2.3 → You're up to
  date).
- **Default scaffolds reduced to `useDefaults()` + commented-out examples** —
  `src/defaults/src/integrations/{tray,menu,context-menu}/index.js` now show
  every customization API as commented examples; consumer files don't drift from
  EM defaults until the user explicitly uncomments. Scaffolds moved from
  `src/defaults/src/{tray,menu,context-menu}/` to
  `src/defaults/src/integrations/{tray,menu,context-menu}/`.

### Boot test layer (new)

- **New `boot` test layer** that spawns a real Electron process running the
  consumer's actual built `dist/main.bundle.js` (the production main entry),
  waits for `manager.initialize()` to resolve, runs each test's `inspect(manager)`
  callback against the live runtime, then `app.exit()`s cleanly. Replaces
  shell-level `npm start && sleep && kill` smoke tests with deterministic,
  signal-driven pass/fail.
- Test shape: `{ layer: 'boot', description, timeout, inspect: async ({ manager,
  expect, projectRoot }) => { ... } }`. Inspect bodies are serialized via
  `Function.prototype.toString` and reconstituted in the spawned process —
  same trick as the renderer-suite harness uses.
- **Always rebuilds `dist/main.bundle.js` before running** so tests never see
  stale code (~10s build cost; opt out with `EM_TEST_SKIP_BUILD=1` for CI). Uses
  the same gulp pipeline `npm run build` does.
- Test runner strips `ELECTRON_RUN_AS_NODE` from the child env (matches
  `gulp/serve`'s existing fix) so electron starts in main-process mode regardless
  of the surrounding shell. Without this, electron silently boots as plain Node
  with no `ipcMain` API.
- Plumbing: `EM_TEST_BOOT=1` / `EM_TEST_BOOT_HARNESS=<path>` /
  `EM_TEST_BOOT_SPEC=<path>` env vars; harness in `src/test/harness/boot-entry.js`,
  runner in `src/test/runners/boot.js`. EM's `main.js` opts in via
  `__non_webpack_require__` (typeof-guarded) so the harness loads at runtime
  without webpack inlining test code into production bundles.
- Full docs: [docs/test-boot-layer.md](docs/test-boot-layer.md).

### Quick-mode setup (UJM parity)

- **`Manager.isQuickMode()`** — env-var (`EM_QUICK=true`) OR CLI flag (`--quick` /
  `-q`). When set, skips slow/network-bound setup operations: `checkManager` (npm
  registry hit), `checkNode` (Electron releases feed), `checkPeerDependencies`
  (npm install), `validateCerts` (Keychain), `provisionRepos` (GitHub API),
  `pushSecrets` (GitHub API).
- `npx mgr clean` short-circuits when bundle exists in quick mode (incremental
  inner-loop dev — first run still does a full clean).
- Mirrors UJM's exact pattern (`UJ_QUICK=true`).

### Default config simplification (continued from 1.0.7)

- **Removed redundant config blocks** from `src/defaults/config/electron-manager.json`:
  - `tray`, `menu`, `contextMenu` blocks gone — paths are conventional
    (`src/integrations/<name>/index.js`); disable via `manager.<name>.disable()`.
  - `deepLinks` block gone — scheme always derived from `brand.id`; routes
    registered at runtime via `manager.deepLink.on()`.
  - `em` block (environment, cacheBreaker, liveReloadPort) — all derivable.
- **Auto-derived defaults** in `Manager.getConfig()`:
  - `app.appId` ← `com.itwcreativeworks.${brand.id}` if not set
  - `app.productName` ← `brand.name` if not set
- `app.icons` block is the only icon configuration surface (3-tier waterfall:
  config → `<root>/config/icons/<platform>/<file>` → EM bundled default).
- **`startup.openAtLogin` is now an object**: `{ enabled, mode }`. The mode
  applies ONLY when the OS auto-launches at login; user-direct launches always
  use `startup.mode`. Force-OFF in dev (uses `app.isPackaged`) so dev runs don't
  pollute login items — set `EM_FORCE_LOGIN_ITEM=1` to override.
- **`signing.windows.strategy` is config-only** (no env-var override) — the GH
  Actions workflow has a `windows-strategy` job that reads the JSON5 config to
  drive runner selection + job gating.

### Build pipeline

- **`electron-builder.yml` is now generated**, not consumer-shipped.
  `gulp/build-config` writes `dist/electron-builder.yml` from EM defaults +
  `config/electron-manager.json`. Override defaults via `electronBuilder:` block
  in `electron-manager.json` only if you genuinely need to.
- **`dist/build/entitlements.mac.plist` is generated** at build time from
  EM defaults + consumer `entitlements.mac` overrides (object map: `null` removes
  a default). Implementation in `src/lib/sign-helpers/entitlements.js`.
- **3-tier icon resolution waterfall** for build artifacts in
  `src/lib/sign-helpers/resolve-icons.js`. Resolved icons copied to
  `dist/build/icons/<platform>/`. `@2x` retina auto-paired from `@1x`.
  Linux follows the windows chain. Windows tray slot falls back to Windows app
  icon when no tray-specific source resolves.
- **Stable download names** for the marketing-mirror download server: `Somiibo.dmg`,
  `Somiibo-Setup.exe`, `somiibo_amd64.deb`, `Somiibo.AppImage`. Apple Silicon
  variant gets `-arm64` suffix. Implementation in `gulp/mirror-downloads.js`.
- **Dynamic Node version templating** — `setup.js` writes `.nvmrc` and renders
  template tokens (`{{ versions.node }}`) in `.github/workflows/build.yml` from
  EM's `package.json#engines.node`. Auto-syncs to whatever Electron's bundled
  Node version is (`scripts/sync-nvmrc.js`).

### BXM-pattern scaffold entries

- All consumer-side scaffold entries (`src/main.js`, `src/preload.js`,
  `src/assets/js/components/*/index.js`) now use the BXM pattern:
  ```js
  const Manager = require('electron-manager/main');
  const manager = new Manager();
  manager.initialize().then(() => { /* custom logic */ });
  ```

### Tests

- **401 passing** (was 358). Includes: `_menu-mixin` (id-path utility), `entitlements`
  (plist generation + override merging), `resolve-icons` (3-tier waterfall +
  retina pairing), `get-config` (derived defaults), id-path API across tray /
  menu / context-menu (find/has/update/remove/enable/show/hide/insertBefore/
  insertAfter/appendTo), legacy-derived defaults (undo/redo, paste-and-match-style,
  reload, dev-only menus), tray auto-icon-resolution + auto-tooltip, and the new
  boot smoke layer.

### Docs

- New: [docs/test-boot-layer.md](docs/test-boot-layer.md).
- Rewritten with new flat ids + full id-path API + default item tables:
  [docs/tray.md](docs/tray.md), [docs/menu.md](docs/menu.md),
  [docs/context-menu.md](docs/context-menu.md).
- [CLAUDE.md](CLAUDE.md): comprehensive new "File-based feature definitions"
  section (id-path API, naming convention, default item set, four test layers).
- [README.md](README.md): updated bullets to call out id-tagged defaults +
  mutation API + four test layers including boot.

## 1.0.6 — runner improvements (final 1.0.x patch)

- Per-org actions-runner installs + capture spawn errors.

## 1.0.5

- curl download, admin check, robust uninstall.

## 1.0.4

- Rename `runner bootstrap` → `runner install`.

## 1.0.3

- Bootstrap idempotency, tar extract, dedup error log, scope docs.

## 1.0.2

- Replace tasklist poll with `automately.getWindows`.

## 1.0.1

- SafeNet eToken thumbprint mode + auto-unlock.

## 1.0.0 — initial scaffolding

- Per-process Manager singletons (main / renderer / preload).
- CLI with setup / clean / install / version / build / publish / validate-certs / sign-windows.
- Gulp build system with three webpack targets.
- Defaults scaffold for consumer projects.
- Strategy-pluggable Windows signing (self-hosted / cloud / local).
- All `lib/*.js` features as stubs — full implementations follow.
