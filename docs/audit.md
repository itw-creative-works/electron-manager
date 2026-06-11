# Audit Workflow

Full-project audit for EM — runs against a CONSUMER app or the FRAMEWORK repo itself (scope auto-detected). Invoked via the `omega:em` skill (`/omega:em audit`) or any "audit this app/project" request.

Every check has a stable ID, a severity, and a scope. Findings are reported as `ID @ file:line`, fixed one at a time, then re-verified. The tables below do NOT restate the rules — each check links to the doc that owns the rule and the fix.

## Protocol

1. **Detect scope** — read `package.json`: `name` is `electron-manager` → **framework audit** (U + EM + F checks); `electron-manager` in (dev)dependencies → **consumer audit** (U + EM checks).
2. **Run the catalog** — every check matching the scope. Search with Grep/Glob/Read over `src/` (+ `test/`, `config/`, `hooks/`); ALWAYS exclude `dist/`, `release/`, `node_modules/`, `_legacy/`, `_backup/`, `.cache/`. Record each finding as `ID @ file:line` + a one-line description.
3. **Persist the report** — write the findings list to `.temp/audit/claude-audit.md` (create the dir; add `.temp/` to `.gitignore` if missing) so a long fix loop survives session breaks. Summarize counts by severity in chat.
4. **Fix loop** — TodoWrite per finding, highest severity first, ONE at a time: mark in-progress → root cause → fix → verify → complete. Ask before structural or destructive fixes (file deletions, lib restructures, config reshapes).
5. **Re-verify** — re-run every check that produced findings until clean; finish with `npx mgr test` (must be green).
6. **Doc parity** — if fixes changed behavior, update README / CLAUDE.md / `docs/<topic>.md` / CHANGELOG in the same change set.

Severity: **CRIT** security or broken functionality · **HIGH** hard-rule violation · **MED** convention drift · **LOW** optional improvement.
Scope: **C** consumer · **F** framework repo · **B** both.

## Universal checks (U-xx)

Mirrored across all four OMEGA frameworks (UJM / BEM / BXM / EM) — same ID means the same check everywhere.

| ID | Sev | Scope | Check |
|----|-----|-------|-------|
| U-01 | HIGH | B | Every feature has tests at EVERY layer it surfaces (build / main / renderer / boot) — never mocked, real harness only ([test-framework.md](test-framework.md)) |
| U-02 | HIGH | B | Test hygiene — real-external-API tests gated behind `TEST_EXTENDED_MODE` in-source (not mocked); no tests that assert nothing ([test-framework.md](test-framework.md)) |
| U-03 | CRIT | B | XSS — renderer DOM sinks escape untrusted values inline via `webManager.utilities().escapeHTML(value)` (+ `sanitizeURL` for URL sinks); zero local escape helpers (rules mirror UJM/BXM `docs/xss-prevention.md`; see also EM-01 for navigation sinks) |
| U-04 | HIGH | B | web-manager owns Firebase — never `require('firebase')`; renderers use `webManager.auth()` / `.firestore()`, main uses `manager.webManager` ([common-mistakes.md](common-mistakes.md), [web-manager-bridge.md](web-manager-bridge.md)) |
| U-05 | HIGH | C | No EM transitive deps installed in the consumer `package.json` (`firebase`, `web-manager`, `fs-jetpack`, …) — webpack `resolve.modules` resolves them ([common-mistakes.md](common-mistakes.md)) |
| U-06 | HIGH | B | Env behavior gated on the INTENTIONAL check — `isProduction()` or `isDevelopment() \|\| isTesting()`, never `!isDevelopment()`; no ad-hoc `process.env.EM_*` reads where a helper exists ([environment-detection.md](environment-detection.md)) |
| U-07 | HIGH | B | Config canon — `config/electron-manager.json` validates against the schema (boot validator green); canonical cross-framework blocks (`brand`, `app`, flat 8-key `firebaseConfig`, `sentry`, `analytics`, `payment`) not reinvented ([config-schema.md](config-schema.md)) |
| U-08 | CRIT | B | No private credentials committed — signing certs (`config/certs/` gitignored), `.env` secrets, tokens, API secret keys ([signing.md](signing.md)). (The Firebase WEB `apiKey` is public by design — do NOT flag it.) |
| U-09 | HIGH | B | Source discipline — nothing edited in `dist/` or generated files (`dist/electron-builder.yml`, entitlements plist); no live code referencing `_legacy/` / `_backup/` ([build-system.md](build-system.md), [common-mistakes.md](common-mistakes.md)) |
| U-10 | MED | B | Doc parity — README / CLAUDE.md / `docs/` / CHANGELOG match shipped behavior; CLAUDE.md < 250 lines; the docs index lists every `docs/*.md`; no stale names for renamed commands/patterns |
| U-11 | MED | B | SSOT/DRY — no duplicated constants/config/logic; one authoritative home per value, imported everywhere else |
| U-12 | MED | B | JS conventions — file structure, JSDoc, short-circuit returns, leading logical operators, `fs-jetpack`, one `module.exports` per file (global `js:patterns` skill + [CLAUDE.md](../CLAUDE.md) §File Conventions) |
| U-13 | MED | B | Dead code & stale patterns — no orphaned `src/` files nothing imports; no unused views/components/integrations; inventory TODO/FIXME (report only) |
| U-14 | LOW | B | Dependency health — review `npm outdated` / `npm audit`; apply fixes via the `general:update-packages` workflow (includes supply-chain checks) |

## EM-specific checks

| ID | Sev | Scope | Check |
|----|-----|-------|-------|
| EM-01 | CRIT | B | Zero-trust URLs — every DYNAMIC URL is gated through `sanitize-url.js` before `shell.openExternal` / `BrowserWindow.loadURL` / `window.location.href =` (hardcoded internal-scheme URLs bypass) ([CLAUDE.md](../CLAUDE.md) §File Conventions, [common-mistakes.md](common-mistakes.md)) |
| EM-02 | HIGH | B | Path resolution — `app.getAppPath()` / `utils/app-root.js`, never `process.cwd()`, in runtime code (it's `/` in packaged apps) ([common-mistakes.md](common-mistakes.md)) |
| EM-03 | HIGH | C | Windows — every `windows.create()` is `await`ed; the `main` window is ALWAYS created (even hidden launches, with `show: false`) so activate/second-instance can surface UI ([windows.md](windows.md), [common-mistakes.md](common-mistakes.md)) |
| EM-04 | HIGH | B | Zero-trust IPC — all channels go through `manager.ipc` (never raw `ipcMain`); handlers validate payload content before acting, especially in apps embedding remote web content ([ipc.md](ipc.md#zero-trust-payloads)) |
| EM-05 | MED | C | Icons — one native-size PNG per slot (no `@2x` siblings), macOS tray source named `tray.png` (EM owns the `Template` rename), no `app.icons` config block ([icons.md](icons.md)) |
| EM-06 | HIGH | C | File-based integrations — tray/menu/context-menu logic lives in `src/integrations/<name>/index.js`, never expressed in config JSON ([tray.md](tray.md), [menu.md](menu.md), [context-menu.md](context-menu.md)) |
| EM-07 | HIGH | B | Presence-driven feature flags — credentials enable features (`sentry.dsn`, `analytics.providers.google.id`, `firebaseConfig`); no invented `enabled:` toggles ([config-schema.md](config-schema.md)) |
| EM-08 | MED | B | Accessibility basics in renderer views — meaningful `alt` text, labeled form fields, real `<button>`/`<a>` elements (no clickable `div`s) |

## Framework-repo checks (F-xx)

Only when auditing the EM repo itself. Mirrored across the four frameworks.

| ID | Sev | Check |
|----|-----|-------|
| F-01 | MED | Sister parity — mirrored sections (config shapes, test contract, CLAUDE.md skeleton, shared env/test conventions) in sync with UJM / BEM / BXM; deviations are deliberate and documented |
| F-02 | HIGH | Consumer-shipped defaults in sync — what `npx mgr setup` scaffolds (`src/defaults/`) matches current conventions and docs |
| F-03 | MED | Docs completeness — every `docs/*.md` indexed in CLAUDE.md; every lib module has a doc; no "(planned)" links for things that have shipped |
| F-04 | HIGH | `npx mgr test mgr:` green before treating the audit as complete |

## See also

- [common-mistakes.md](common-mistakes.md) — the canonical anti-pattern list behind several checks
- [ipc.md](ipc.md#zero-trust-payloads) — the payload rules behind EM-04
- [config-schema.md](config-schema.md) — the validator behind U-07 / EM-07
- [test-framework.md](test-framework.md) — the layers behind U-01 / U-02
