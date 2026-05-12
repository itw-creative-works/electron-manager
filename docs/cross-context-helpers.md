# Cross-context helpers

Three Manager constructors (main / renderer / preload) plus the build-time Manager (`build.js`) all mix in shared helpers via `attachTo(Manager)`. Available as both prototype methods (`manager.isTesting()`) and statics (`Manager.isTesting()`) — matches BEM's pattern.

## Helpers

| Helper | Source | What it returns |
|---|---|---|
| `isDevelopment()` | `src/utils/mode-helpers.js` | `true` when running unpackaged. Authoritative signal: `app.isPackaged === false`. Falls back to `NODE_ENV === 'development'` or `config.em.environment === 'development'` when `app` isn't available (preload, renderer, build-time scripts). |
| `isProduction()` | `src/utils/mode-helpers.js` | Inverse of `isDevelopment()`. |
| `isTesting()` | `src/utils/mode-helpers.js` | `process.env.EM_TEST_MODE === 'true'`. Set by EM's test runners; consumers writing their own tests should set the same env var. |
| `getWebsiteUrl(env?)` | `src/utils/url-helpers.js` | Marketing/brand site URL. Dev → `https://localhost:4000` (matches BEM's jekyll-emulator port). Prod → `config.brand.url`. Use this for "Open Website" tray/menu items, billing-portal links, etc. |
| `getEnvironment()` | `src/utils/url-helpers.js` | `'production' \| 'development'`. Two layers: prefer `config.em.environment` if loaded, fall back to `EM_BUILD_MODE === 'true' ? 'production' : 'development'`. |
| `getFunctionsUrl(env?)` | `src/utils/url-helpers.js` | Firebase functions URL. Dev → `http://localhost:5001/<projectId>/us-central1`. Prod → `https://us-central1-<projectId>.cloudfunctions.net`. |
| `getApiUrl(env?)` | `src/utils/url-helpers.js` | API URL. Dev → `http://localhost:5002`. Prod → `https://api.<authDomain>`. |

Use these whenever behavior should differ by *what kind of process* or *what backend env*; don't grep `process.env` ad-hoc throughout the codebase.

## Adding a new cross-context helper

Write the function in a `src/utils/<topic>-helpers.js` module, expose `attachTo(Manager)`, then import + call `attachTo` at the bottom of all four Manager files (`main.js`, `renderer.js`, `preload.js`, `build.js`).

Don't define helpers on individual Manager prototypes — that path leads to duplicated semantics like the old `getEnvironment` collision between main.js and build.js.

## Build modes (env vars)

- `EM_BUILD_MODE=true` — production build (minified, no sourcemaps).
- `EM_IS_PUBLISH=true` — publish step.
- `EM_IS_SERVER=true` — running in CI.
- `EM_TEST_MODE=true` — running inside EM's test framework (canonical signal — set by both runners). Powers `manager.isTesting()`.
