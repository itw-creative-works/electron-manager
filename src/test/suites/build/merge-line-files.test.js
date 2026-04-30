// Build-layer tests for utils/merge-line-files.js — verify the .env / .gitignore merge convention
// (BXM/UJM-style Default + Custom sections) AND the double-quote normalization for .env values.

const path = require('path');
const { mergeLineBasedFiles, normalizeEnvLine, DEFAULT_MARKER, CUSTOM_MARKER } =
  require(path.join(__dirname, '..', '..', '..', 'utils', 'merge-line-files.js'));

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'merge-line-files — env + gitignore merge',
  tests: [
    {
      name: 'preserves user value in default section across merges (and quotes it)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}
GH_TOKEN=ghp_secret123
BACKEND_MANAGER_KEY=

${CUSTOM_MARKER}
`;
        const incoming = `${DEFAULT_MARKER}
GH_TOKEN=""
BACKEND_MANAGER_KEY=""

${CUSTOM_MARKER}
`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        // Value is preserved AND now wrapped in double quotes.
        ctx.expect(merged).toContain('GH_TOKEN="ghp_secret123"');
        // Empty value stays unquoted.
        ctx.expect(merged).toMatch(/BACKEND_MANAGER_KEY=\s*$|BACKEND_MANAGER_KEY=""/m);
      },
    },
    {
      name: 'preserves Custom section keys + values (normalized to quoted form)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}
GH_TOKEN=""

${CUSTOM_MARKER}
USER_CUSTOM=hello
ANOTHER_KEY=world
`;
        const incoming = `${DEFAULT_MARKER}
GH_TOKEN=""

${CUSTOM_MARKER}
`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged).toContain('USER_CUSTOM="hello"');
        ctx.expect(merged).toContain('ANOTHER_KEY="world"');
      },
    },
    {
      name: 'adds new framework keys to Default section',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}
GH_TOKEN=""

${CUSTOM_MARKER}
`;
        const incoming = `${DEFAULT_MARKER}
GH_TOKEN=""
NEW_KEY=""

${CUSTOM_MARKER}
`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged).toContain('NEW_KEY=""');
      },
    },
    {
      name: 'migrates user-added keys in Default to Custom when no longer in framework defaults',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}
GH_TOKEN="mine"
MY_OLD_KEY="savedvalue"

${CUSTOM_MARKER}
ALREADY_CUSTOM="ok"
`;
        const incoming = `${DEFAULT_MARKER}
GH_TOKEN=""

${CUSTOM_MARKER}
`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged).toContain('GH_TOKEN="mine"');
        ctx.expect(merged).toContain('MY_OLD_KEY="savedvalue"');
        ctx.expect(merged).toContain('ALREADY_CUSTOM="ok"');
      },
    },
    {
      name: 'gitignore: preserves user-added lines in Custom section',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}
node_modules/
dist/

${CUSTOM_MARKER}
.idea/
my-secret.key
`;
        const incoming = `${DEFAULT_MARKER}
node_modules/
dist/
release/

${CUSTOM_MARKER}
`;
        const merged = mergeLineBasedFiles(existing, incoming, '.gitignore');
        ctx.expect(merged).toContain('release/');
        ctx.expect(merged).toContain('.idea/');
        ctx.expect(merged).toContain('my-secret.key');
      },
    },
    {
      name: 'gitignore: migrates user-added Default line to Custom when not in new defaults (no quoting for gitignore)',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}
node_modules/
my-fork-only.txt

${CUSTOM_MARKER}
`;
        const incoming = `${DEFAULT_MARKER}
node_modules/
dist/

${CUSTOM_MARKER}
`;
        const merged = mergeLineBasedFiles(existing, incoming, '.gitignore');
        ctx.expect(merged).toContain('my-fork-only.txt');
        ctx.expect(merged).toContain('dist/');
        // gitignore is NOT quoted.
        ctx.expect(merged).not.toContain('"my-fork-only.txt"');
      },
    },
    {
      name: 'idempotent: merging the same content twice yields stable output',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}
GH_TOKEN=secret

${CUSTOM_MARKER}
USER_KEY=value
`;
        const incoming = `${DEFAULT_MARKER}
GH_TOKEN=""

${CUSTOM_MARKER}
`;
        const once  = mergeLineBasedFiles(existing, incoming, '.env');
        const twice = mergeLineBasedFiles(once,     incoming, '.env');
        ctx.expect(twice).toBe(once);
      },
    },
    {
      name: 'comments in Default section are carried through unchanged',
      run: (ctx) => {
        const existing = `${DEFAULT_MARKER}
# group comment
GH_TOKEN=""

${CUSTOM_MARKER}
`;
        const incoming = `${DEFAULT_MARKER}
# group comment
GH_TOKEN=""

${CUSTOM_MARKER}
`;
        const merged = mergeLineBasedFiles(existing, incoming, '.env');
        ctx.expect(merged).toContain('# group comment');
      },
    },

    // ─── normalizeEnvLine direct tests ───────────────────────────────────────────
    {
      name: 'normalizeEnvLine: wraps unquoted values in double quotes',
      run: (ctx) => {
        ctx.expect(normalizeEnvLine('GH_TOKEN=ghp_xxx')).toBe('GH_TOKEN="ghp_xxx"');
        ctx.expect(normalizeEnvLine('PATH=/usr/local/bin')).toBe('PATH="/usr/local/bin"');
      },
    },
    {
      name: 'normalizeEnvLine: leaves already-quoted values alone',
      run: (ctx) => {
        ctx.expect(normalizeEnvLine('KEY="value"')).toBe('KEY="value"');
        ctx.expect(normalizeEnvLine('KEY="value with spaces"')).toBe('KEY="value with spaces"');
      },
    },
    {
      name: 'normalizeEnvLine: canonicalizes single quotes to double quotes',
      run: (ctx) => {
        ctx.expect(normalizeEnvLine("KEY='single'")).toBe('KEY="single"');
      },
    },
    {
      name: 'normalizeEnvLine: empty value stays unquoted',
      run: (ctx) => {
        ctx.expect(normalizeEnvLine('KEY=')).toBe('KEY=');
        ctx.expect(normalizeEnvLine('KEY=   ')).toBe('KEY=');
      },
    },
    {
      name: 'normalizeEnvLine: escapes embedded double quotes and backslashes',
      run: (ctx) => {
        ctx.expect(normalizeEnvLine('KEY=he said "hi"')).toBe('KEY="he said \\"hi\\""');
        ctx.expect(normalizeEnvLine('KEY=back\\slash')).toBe('KEY="back\\\\slash"');
      },
    },
    {
      name: 'normalizeEnvLine: preserves comments and blank lines verbatim',
      run: (ctx) => {
        ctx.expect(normalizeEnvLine('# this is a comment')).toBe('# this is a comment');
        ctx.expect(normalizeEnvLine('')).toBe('');
        ctx.expect(normalizeEnvLine('   ')).toBe('   ');
      },
    },
    {
      name: 'normalizeEnvLine: preserves leading whitespace on KEY=VALUE lines',
      run: (ctx) => {
        ctx.expect(normalizeEnvLine('  KEY=val')).toBe('  KEY="val"');
      },
    },
  ],
};
