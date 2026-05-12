// Schema-driven config validator. Walks a config object against a schema array
// (src/config/schema.js shape) and returns a list of human-readable errors.
//
//   const { errors } = validateConfig(config, schema, { cwd });
//   if (errors.length) throw new Error(errors.join('\n'));
//
// Validation rules (only applied to the path's value — never to siblings):
//
//   required: true                    → must be present + non-empty
//   required: false                   → no presence check; siblings still run if value present
//   required: (config) => bool        → conditionally required; predicate gets the full config
//
//   type: 'string' | 'boolean' | 'number' | 'array' | 'object' | 'path'
//                                     → typeof check (path === string with file-existence hook)
//
//   match: RegExp                     → string values must match
//   enum: [...]                       → value must be one of the allowed
//
// `match` / `enum` only run when the value is PRESENT. A missing field with
// required:false is silent. A missing field with required:true is reported as
// missing — but secondary rules don't double-fire on top of a missing field.
//
// File-existence / build-mode-only checks are NOT modeled here — they live in
// gulp/tasks/audit.js because they depend on the build pipeline state (whether
// we're in publish mode, etc.), not the config shape.

function getPath(obj, dottedPath) {
  if (!obj) return undefined;
  const parts = String(dottedPath).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isPresent(v) {
  if (v == null) return false;
  if (typeof v === 'string' && v.length === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  return true;
}

function describe(rule) {
  const parts = [];
  if (rule.type) parts.push(`type=${rule.type}`);
  if (rule.match) parts.push(`match=${rule.match}`);
  if (rule.enum) parts.push(`one of [${rule.enum.join(', ')}]`);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

function validateConfig(config, schema) {
  const errors = [];

  for (const rule of schema) {
    const value = getPath(config, rule.path);
    const present = isPresent(value);

    // ─── Required check ─────────────────────────────────────────────────────
    let isRequired = false;
    if (typeof rule.required === 'function') {
      try { isRequired = !!rule.required(config); }
      catch (_) { isRequired = false; }
    } else {
      isRequired = !!rule.required;
    }

    if (!present) {
      if (isRequired) {
        const why = rule.description ? ` — ${rule.description}` : '';
        errors.push(`config.${rule.path} is required${why}`);
      }
      // Absent + not required → nothing else to check.
      continue;
    }

    // ─── Type check ─────────────────────────────────────────────────────────
    if (rule.type) {
      const ok = (() => {
        switch (rule.type) {
          case 'string':  return typeof value === 'string';
          case 'boolean': return typeof value === 'boolean';
          case 'number':  return typeof value === 'number' && Number.isFinite(value);
          case 'array':   return Array.isArray(value);
          case 'object':  return typeof value === 'object' && value !== null && !Array.isArray(value);
          case 'path':    return typeof value === 'string';
          default:        return true;
        }
      })();
      if (!ok) {
        errors.push(`config.${rule.path} has wrong type — got ${Array.isArray(value) ? 'array' : typeof value}, expected ${rule.type}`);
        continue;          // skip secondary checks if the type is wrong
      }
    }

    // ─── Match check (strings) ──────────────────────────────────────────────
    if (rule.match && typeof value === 'string' && !rule.match.test(value)) {
      const why = rule.description ? ` — ${rule.description}` : '';
      errors.push(`config.${rule.path} "${value}" does not match expected pattern ${rule.match}${why}`);
    }

    // ─── Enum check ─────────────────────────────────────────────────────────
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(`config.${rule.path} "${value}" is not allowed — must be one of [${rule.enum.join(', ')}]`);
    }

  }

  return { errors };
}

// Render a numbered, human-readable error block. Used by callers that want to
// throw a single Error with all problems collected.
function formatErrors(errors) {
  if (!errors.length) return '';
  return errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
}

module.exports = { validateConfig, formatErrors };
