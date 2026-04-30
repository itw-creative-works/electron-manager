// Merge line-based files (.env, .gitignore) on `npx mgr setup`.
//
// Convention (matches BXM/UJM):
//
//   # ========== Default Values ==========
//   # framework-managed; overwritten on every setup
//   KEY1=
//   KEY2="value with spaces"
//
//   # ========== Custom Values ==========
//   # user's section; preserved verbatim across setups
//   USER_SECRET="my-secret"
//
// Behavior:
//   - The Default section is replaced with the new framework's defaults.
//   - Keys that already had values (in either Default or Custom) keep those values
//     in the same section they were in.
//   - Keys the user added to the Default section that are NOT in the new framework's
//     defaults migrate to the Custom section (so framework cleanups don't lose user data).
//   - .env values are normalized to **double-quoted** form on every merge:
//       KEY=raw-value         →   KEY="raw-value"
//       KEY="already-quoted"  →   KEY="already-quoted"  (left alone)
//       KEY=                  →   KEY=                  (empty stays empty/unquoted)
//     This protects values containing spaces, #, $, or other shell-meaningful chars.
//   - .gitignore: same logic, line-based instead of key-based (no quoting).
//   - First setup (no existing file): the framework template lands as-is.

const DEFAULT_MARKER = '# ========== Default Values ==========';
const CUSTOM_MARKER  = '# ========== Custom Values ==========';

function mergeLineBasedFiles(existingContent, newContent, fileName) {
  const isEnvFile = fileName === '.env';

  const existingLines = existingContent.split('\n');
  const newLines      = newContent.split('\n');

  // Parse existing into default + custom sections.
  const { defaultLines: existingDefault, customLines: existingCustom, existingDefaultKeys, existingCustomKeys }
    = splitSections(existingLines, isEnvFile);

  // Parse new content. We only use its default section (custom is the user's domain).
  const { defaultLines: newDefault, customLines: newCustom } = splitSections(newLines, isEnvFile);

  // Build the merged default section: walk new defaults in order, substituting the
  // user's existing value for any key they had set in either section.
  const newDefaultKeys = new Set();
  const mergedDefault  = [];
  const emit = (line) => mergedDefault.push(isEnvFile ? normalizeEnvLine(line) : line);

  for (const line of newDefault) {
    const trimmed = line.trim();

    if (isEnvFile && trimmed && !trimmed.startsWith('#')) {
      const key = trimmed.split('=')[0].trim();
      if (key) {
        newDefaultKeys.add(key);
        if (existingDefaultKeys.has(key)) {
          emit(findKeyLine(existingDefault, key));
          continue;
        }
        if (existingCustomKeys.has(key)) {
          // Key the user moved to custom — leave it in custom; emit empty default value.
          emit(line);
          continue;
        }
      }
      emit(line);
    } else if (!isEnvFile && trimmed && !trimmed.startsWith('#')) {
      // .gitignore: just keep the new line.
      mergedDefault.push(line);
    } else {
      // Comment / blank.
      mergedDefault.push(line);
    }
  }

  // User-added stuff in their Default section that the new framework doesn't know about
  // → migrate to Custom so it's preserved without being clobbered next setup.
  const migratedToCustom = [];
  for (const line of existingDefault) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (isEnvFile) {
      const key = trimmed.split('=')[0].trim();
      if (key && !newDefaultKeys.has(key) && !existingCustomKeys.has(key)) {
        migratedToCustom.push(normalizeEnvLine(line));
      }
    } else {
      // .gitignore: line not in new defaults → migrate.
      const inNew = newLines.some((nl) => nl.trim() === trimmed);
      if (!inNew) {
        migratedToCustom.push(line);
      }
    }
  }

  // The user's Custom section is preserved verbatim — except .env values get
  // normalized to double-quoted form so the file's quoting style is consistent.
  const finalCustom = isEnvFile
    ? existingCustom.map((line) => normalizeEnvLine(line))
    : existingCustom;

  const result = [];
  result.push(DEFAULT_MARKER);
  result.push(...mergedDefault);
  result.push('');
  result.push(CUSTOM_MARKER);
  if (migratedToCustom.length > 0) {
    result.push(...migratedToCustom);
  }
  result.push(...finalCustom);

  return result.join('\n');
}

// Normalize a single .env line:
//   - Comments / blanks unchanged
//   - KEY=  (empty value) unchanged
//   - KEY="..." (already double-quoted) unchanged
//   - KEY=raw-value → KEY="raw-value" (with embedded " and \ escaped)
//   - KEY='single' → KEY="single"  (canonicalize single → double)
function normalizeEnvLine(line) {
  if (typeof line !== 'string') return line;

  // Preserve comments and blank lines verbatim.
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return line;

  // Capture leading whitespace so we don't lose indentation.
  const leadingMatch = line.match(/^(\s*)/);
  const leading = leadingMatch ? leadingMatch[1] : '';

  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) return line; // no `=` — not a KEY=VALUE line

  const key = trimmed.slice(0, eqIdx).trim();
  let value = trimmed.slice(eqIdx + 1);

  // Strip trailing whitespace + inline comment-after-value (rare; we only strip a # that follows a space).
  // We do NOT strip # inside quoted values. Detect that by checking if value starts with a quote.
  if (value.length === 0) {
    return `${leading}${key}=`;
  }

  // Already double-quoted? Leave alone (preserves user's exact contents).
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return `${leading}${key}=${value}`;
  }

  // Single-quoted → canonicalize to double-quoted.
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    const inner = value.slice(1, -1);
    return `${leading}${key}="${escapeForDoubleQuote(inner)}"`;
  }

  // Raw value → wrap.
  return `${leading}${key}="${escapeForDoubleQuote(value)}"`;
}

function escapeForDoubleQuote(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function splitSections(lines, isEnvFile) {
  const defaultLines = [];
  const customLines  = [];
  const existingDefaultKeys = new Set();
  const existingCustomKeys  = new Set();

  let mode = null; // null | 'default' | 'custom'
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === DEFAULT_MARKER) { mode = 'default'; continue; }
    if (trimmed === CUSTOM_MARKER)  { mode = 'custom';  continue; }

    // Lines before any marker are treated as default (legacy / fresh files).
    if (mode === 'custom') {
      customLines.push(line);
      if (isEnvFile && trimmed && !trimmed.startsWith('#')) {
        const key = trimmed.split('=')[0].trim();
        if (key) existingCustomKeys.add(key);
      }
    } else {
      defaultLines.push(line);
      if (isEnvFile && trimmed && !trimmed.startsWith('#')) {
        const key = trimmed.split('=')[0].trim();
        if (key) existingDefaultKeys.add(key);
      }
    }
  }

  return { defaultLines, customLines, existingDefaultKeys, existingCustomKeys };
}

function findKeyLine(lines, key) {
  const re = new RegExp(`^\\s*${key}\\s*=`);
  for (const line of lines) {
    if (re.test(line)) return line;
  }
  return `${key}=`;
}

module.exports = { mergeLineBasedFiles, normalizeEnvLine, DEFAULT_MARKER, CUSTOM_MARKER };
