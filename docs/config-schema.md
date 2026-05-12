# Config schema

EM validates `config/electron-manager.json` against a canonical schema declared in [`src/config/schema.js`](../src/config/schema.js). The schema is the single source of truth for which fields exist, which are required, and what shape their values take.

Validation runs in two places:

1. **`Manager.initialize()` (boot)** — hard-fails the app at boot if any required field is missing or any present field is invalid. So a misconfigured app never reaches the "white window of confusion" phase — it tells you exactly which field is broken.
2. **`gulp audit` (build)** — same schema, plus build-pipeline-specific extras (file-existence for icons, `releases.repo` in publish mode, etc.).

## Schema entry shape

```js
{
  path:        'brand.id',                     // dot-path into the config
  type:        'string' | 'boolean' | 'number' | 'array' | 'object',
  required:    true | false | (config) => bool,
  match:       /^[a-z][a-z0-9+\-.]*$/,         // string-value regex
  enum:        ['normal', 'hidden'],           // value-must-be-in-this-list
  description: 'Used for the deep-link scheme + default appId.',
}
```

## The `required` flag

EM keeps validation simple: **`required` is either `true`, `false`, or a function**.

```js
required: true                    // hard-fail if missing
required: false                   // OK to omit (but if present, match/enum/type still run)
required: (cfg) => bool           // conditional — predicate gets the full config
```

The function form is for "this field is mandatory only when another part of config is set." Example: `analytics.providers.google.id` is only required when `analytics.enabled === true`:

```js
{
  path:     'analytics.providers.google.id',
  required: (cfg) => cfg?.analytics?.enabled === true,
  match:    /^G-[A-Z0-9]+$/,
}
```

This is identical strictness in dev and production. There's no separate `'publish-only'` tier — if a field truly matters only for builds, validate it inside `gulp/audit.js` (next to `fileMustExist` calls for icons, etc.) rather than the schema.

## How `match` / `enum` / `type` interact with absence

They **only run when the value is present**. A missing field with `required: false` is silent. A missing field with `required: true` fires the "missing" error and nothing else — so consumers don't see a confusing flood of "missing AND wrong type AND doesn't match" for the same field.

## Adding a new field

When you add a new config knob anywhere in EM:

1. Add an entry to [`src/config/schema.js`](../src/config/schema.js) right next to the section it belongs to.
2. If it has a default, set it in [`src/defaults/config/electron-manager.json`](../src/defaults/config/electron-manager.json).
3. That's it. No separate validation logic to add elsewhere — the schema entry is the validation.

## What's NOT in the schema

These checks live in [`gulp/tasks/audit.js`](../src/gulp/tasks/audit.js) instead, because they depend on build-pipeline state rather than the config shape:

- **`src/main.js` / `src/preload.js` existence** — webpack will fail without them but the schema doesn't know about consumer entry points.
- **`brand.images.icon` file existence** — only enforced when packaging (`isBuildMode()` / `isPublishMode()`); dev runs with the default Electron icon.
- **`releases.repo` presence** — only enforced in publish mode.

These are kept in `audit.js` so the schema stays a pure description of the config shape, callable from any context without dragging in build state.

## Examples

Required field missing:

```
electron-manager: config validation failed — fix the following in config/electron-manager.json:
  1. config.brand.id is required — URL-scheme-safe slug. Used as deep-link scheme + default appId. Must be lowercase, start with a letter, alnum/+/-/.
```

Field present but invalid:

```
  1. config.startup.mode "tray-only" is not allowed — must be one of [normal, hidden]
  2. config.brand.id "My App!" does not match expected pattern /^[a-z][a-z0-9+\-.]*$/ — URL-scheme-safe slug. Used as deep-link scheme + default appId. Must be lowercase, start with a letter, alnum/+/-/.
```

Errors are numbered so you can fix everything in one pass instead of fix-rebuild-fix-rebuild.

## Adding payment fields (BEM-shaped)

EM's schema mirrors [BEM's `manager-config.example.json`](https://github.com/itw-creative-works/backend-manager) shape for payment so the same product catalog reads identically on backend, web, and desktop:

```js
{
  payment: {
    processors: {
      stripe: { publishableKey: 'pk_live_...' },     // schema: match /^pk_(test|live)_/
      paypal: { clientId: '...' },
    },
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', limits: { credits: 100 } },
    ],
  },
}
```

The schema only enforces shape for the few well-defined publishable keys — the product catalog itself is freeform so BEM can extend it without EM caring.

## Source

- Schema definitions: [`src/config/schema.js`](../src/config/schema.js)
- Validator engine: [`src/utils/validate-config.js`](../src/utils/validate-config.js)
- Tests: [`src/test/suites/build/validate-config.test.js`](../src/test/suites/build/validate-config.test.js)
