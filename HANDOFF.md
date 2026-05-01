# Windows Signing Handoff

## Context

Building electron-manager (EM) — multi-platform Electron release framework. Currently testing on a consumer project end-to-end. Mac signing/notarizing/publishing works. Linux works. **Windows EV-token signing is the only blocker.**

## Latest state

- **EM**: v1.2.15 published (npm + GH). v1.2.16 staged locally (just `.env.example` doc — never pushed yet).
- **Consumer current version**: `1.0.4`. Latest workflow run failed at the sign step.
- **Self-hosted runner**: registered with consumer's GH org, service installed at `C:\actions-runners\actions-runner-<org>`, configured to run as the local user account (per install log).
- **EV cert**: stored in `CurrentUser\My`, valid through 2027.
- **Secrets pushed to consumer's GH Actions**: `WIN_EV_TOKEN_PATH` (cert thumbprint), `WIN_CSC_KEY_PASSWORD` (token PIN), `SIGNTOOL_PATH` (full path to signtool.exe), plus the usual mac/linux signing + notarization secrets.

## Pipeline status (last run)

| Job | Status | Notes |
|---|---|---|
| Test | ✓ | |
| Build mac | ✓ | signed + notarized + uploaded to update-server |
| Build linux | ✓ | uploaded |
| Build windows | ✓ | unsigned `.exe` produced as artifact |
| windows-strategy | ✓ | resolved to `self-hosted` |
| **Sign Windows** | **✗** | signtool: "No certificates were found that met all the given criteria" |
| Finalize | ✓ ran | flipped Draft→Published; warns about missing windows feed yml |

`update-server` v1.0.4 release IS published, has all mac+linux assets, **no windows .exe**.

## All EM-side fixes shipped so far (chronological)

| Version | Fix |
|---|---|
| 1.2.0 | Initial multi-platform pipeline |
| 1.2.1 | `mgr finalize-release` cmd; manual workflow_dispatch only |
| 1.2.2 | Mac entitlements path bug; `cross-env` for windows env syntax |
| 1.2.3 | `npm run release` triggers CI + log streaming |
| 1.2.4 | Silent octokit during release stream |
| 1.2.5 | Runner svc install fix (BAD — broke v1.2.4 working state) |
| 1.2.6 | Reverted to `--runasservice` |
| 1.2.7 | Always wipe per-org dir before re-clone (was reusing stale state) |
| 1.2.8 | `stdio: 'inherit'` for config.cmd (piped stdio caused silent skip) |
| 1.2.9 | Delete stale GH-side runners before re-register; hyphenated mirror names |
| 1.2.10 | Grant NETWORK SERVICE access via icacls (didn't work — wrong scope) |
| 1.2.11 | Install runners to `C:\actions-runners\` (escape user profile) |
| 1.2.12 | Workflow uses `shell: cmd` not PowerShell (ExecutionPolicy issue) |
| 1.2.13 | Wire `WIN_EV_TOKEN_PATH` etc through workflow secrets |
| 1.2.14 | `_.env` scaffold actually includes those keys |
| 1.2.15 | Service installs to run AS user (not NETWORK SERVICE) via `--windowslogonaccount` |
| 1.2.16 | (staged, unshipped) `.env.example` documents `WIN_RUNNER_LOGON_*` |

## Current theory: why signtool fails

Service is configured to run as the local user. signtool searches `CurrentUser\My`. Cert is in `CurrentUser\My` of the interactive desktop user session. **But Windows services run in a non-interactive session (Session 0)** which gets a different `CurrentUser` view than the interactive desktop session. Cert may not be visible there.

**Suspect token-driver behavior**: the EV-token vendor's driver registers the cert via the CSP / KSP (Cryptographic Service Provider). On non-interactive sessions, the driver may not auto-load the token. The hardware EV token might require active user interaction or polling to be visible.

## Iterate locally, NOT through CI

Don't push consumer version bumps + trigger workflow runs to test signing fixes.
Each round trip is ~12 minutes. Instead reproduce the exact failure locally on
the Windows host and iterate against it.

**Reproduce the sign failure locally** (paste in cmd as the same user the runner
service runs as, or as a different identity using `runas /user:<user>`):

```cmd
cd C:\actions-runners\actions-runner-<org>
:: Need an unsigned .exe to sign — easiest: download the latest "windows-unsigned"
:: artifact from a recent workflow run, or run electron-builder locally on the dp
:: project to produce one.

:: Then run the same command the workflow runs:
set WIN_EV_TOKEN_PATH=<thumbprint>
set WIN_CSC_KEY_PASSWORD=<token-pin>
set SIGNTOOL_PATH=C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe
npx mgr sign-windows --in <dir-with-unsigned-exe> --out <output-dir>
```

If that fails the same way, you've reproduced the issue locally — iterate
without CI. Once it succeeds locally as the service user, push the EM fix and
trigger a real release run as the final verification.

To reproduce the **service-context** specifically (vs. interactive shell), use
`PsExec.exe -i 0 -s cmd.exe` (Sysinternals) to launch a cmd in Session 0 as
LocalSystem, or `runas /user:<user> /noprofile cmd` to launch without loading
the user profile (closer to what a service sees).

## What to test on Windows directly

**Test 1 — confirm service identity**:
```cmd
sc qc <full-service-name>
```
(Find the service name with `sc query state= all | findstr actions.runner`)

Look for `SERVICE_START_NAME`. If it's `LocalSystem` or `NETWORK SERVICE`, EM didn't apply the creds (despite saying it did) → bug to fix. If it's `.\<user>`, identity is right; problem is elsewhere.

**Test 2 — does signtool work interactively for the user**:
```cmd
"<SIGNTOOL_PATH>" sign /sha1 <THUMBPRINT> /tr http://timestamp.sectigo.com /td sha256 /fd sha256 some-small.exe
```
If this works in your terminal but the service can't see the cert, it's the Session 0 / non-interactive cert visibility issue.

**Test 3 — what does `certutil` see**:
```cmd
certutil -store -user My <THUMBPRINT>
```
Run as the same user the service runs as. If the cert isn't visible, the issue is cert-store scope.

**Test 4 — check the runner's diag logs after a job runs**:
Logs at `C:\actions-runners\actions-runner-<org>\_diag\Runner_*.log` and `Worker_*.log`. They show the actual signtool invocation and any error context.

## Likely fixes to try (in order of effort)

1. **Use `WIN_EV_TOKEN_PATH=""` (empty)** + let signtool auto-find the cert by appname. Some token configs only work this way.

2. **Switch to LocalMachine\My + token "all-users" mode**: most EV token client UIs have a "Tokens visible to all users" / "system-wide" toggle. With this, the cert appears in `LocalMachine\My` as well, and any service can see it.

3. **Don't run as a service at all** — run the runner as an interactive Logon Task via Task Scheduler. Loses unattended boot but gains full session-1 cert access.

4. **Sign in a separate step that runs interactively** — split sign into two: workflow uploads unsigned .exe, then a polling daemon on Windows host (running interactively) signs and uploads. Most invasive but bulletproof.

## Useful paths

- EM source on Windows: `C:\Users\<user>\Documents\GitHub\ITW-Creative-Works\electron-manager`
- Runner installs: `C:\actions-runners\actions-runner-<org>\`
- Runner diag logs: `C:\actions-runners\actions-runner-<org>\_diag\Runner_*.log`
- `.env` on Windows EM: should have `GH_TOKEN`, `EM_RUNNER_ORGS`, `WIN_RUNNER_LOGON_ACCOUNT`, `WIN_RUNNER_LOGON_PASSWORD`
- `.env` on consumer project: should have everything for push-secrets (mac signing creds + windows EV creds)

## EM commands reference

- `npx mgr runner install` — register + install service
- `npx mgr runner status` — see service state
- `npx mgr runner uninstall` — full teardown
- `npx mgr runner set-credentials` — interactive prompt to save logon creds (DPAPI-encrypted)
- `npx mgr sign-windows --in <dir> --out <dir>` — manually sign artifacts (used by workflow)
- `npx mgr push-secrets` — push `.env` Default section keys to GH Actions secrets

## Pending TODOs (low priority)

- Ship v1.2.16 (`.env.example` doc fix, currently staged locally)
- Fix `mgr runner install` to honor `EM_RUNNER_ORGS` in pre-install uninstall step (currently nukes ALL services regardless of filter)
- Fix `mgr runner uninstall` to clean up `RUNNER_HOME` dir
- Cleanup old non-hyphenated leftover files from `download-server@installer`

## Worth knowing

- Mac and Linux are fully working. Mirror to download-server uses hyphenated stable names.
- `npm run release` in the consumer triggers the workflow + streams logs to `logs/build.log`.
- All workflow runs have been **manual** via `workflow_dispatch` (not on push).
- The runner registers with **GH org**, not repo — so all repos in the org can use it.
