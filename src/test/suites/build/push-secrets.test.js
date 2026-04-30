// Build-layer tests for commands/push-secrets.js — env parsing, value resolution, repo discovery.
// We don't hit GitHub in tests; the encrypt + push path is exercised via the Octokit-driven
// integration which would need real creds. These cover the offline logic.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const pushSecrets = require(path.join(__dirname, '..', '..', '..', 'commands', 'push-secrets.js'));

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'push-secrets — env parsing + value resolution',
  tests: [
    {
      name: 'parseEnv splits keys into Default and Custom sections',
      run: (ctx) => {
        const content = `# ========== Default Values ==========
GH_TOKEN=ghp_abc
APPLE_TEAM_ID=ABC1234567

# ========== Custom Values ==========
USER_KEY=mine
`;
        const entries = pushSecrets.parseEnv(content);
        const dflt = entries.filter((e) => e.section === 'default').map((e) => e.key);
        const custom = entries.filter((e) => e.section === 'custom').map((e) => e.key);

        ctx.expect(dflt).toContain('GH_TOKEN');
        ctx.expect(dflt).toContain('APPLE_TEAM_ID');
        ctx.expect(custom).toContain('USER_KEY');
        ctx.expect(custom).not.toContain('GH_TOKEN');
      },
    },
    {
      name: 'parseEnv strips wrapping quotes',
      run: (ctx) => {
        const content = `# ========== Default Values ==========
A="quoted-value"
B='single-quoted'
C=plain
`;
        const entries = pushSecrets.parseEnv(content);
        const map = Object.fromEntries(entries.map((e) => [e.key, e.value]));
        ctx.expect(map.A).toBe('quoted-value');
        ctx.expect(map.B).toBe('single-quoted');
        ctx.expect(map.C).toBe('plain');
      },
    },
    {
      name: 'parseEnv ignores comments and blank lines',
      run: (ctx) => {
        const content = `# ========== Default Values ==========
# this is a comment
KEY1=v1

KEY2=v2
`;
        const entries = pushSecrets.parseEnv(content);
        ctx.expect(entries.length).toBe(2);
      },
    },
    {
      name: 'resolveSecretValue: returns string as-is when value is not a path',
      run: async (ctx) => {
        const out = await pushSecrets.resolveSecretValue({ value: 'plain-string-value' }, '/tmp');
        ctx.expect(out).toBe('plain-string-value');
      },
    },
    {
      name: 'resolveSecretValue: empty value passes through',
      run: async (ctx) => {
        const out = await pushSecrets.resolveSecretValue({ value: '' }, '/tmp');
        ctx.expect(out).toBe('');
      },
    },
    {
      name: 'resolveSecretValue: returns base64 when value is an existing file path',
      run: async (ctx) => {
        // Create a temp .p12-like file.
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-test-'));
        const filePath = path.join(tmpDir, 'cert.p12');
        const fileContent = Buffer.from('FAKE-CERT-BYTES');
        fs.writeFileSync(filePath, fileContent);

        try {
          const entry = { value: filePath };
          const out = await pushSecrets.resolveSecretValue(entry, '/tmp');
          ctx.expect(out).toBe(fileContent.toString('base64'));
          ctx.expect(entry.isFilePath).toBe(true);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'resolveSecretValue: path-like value but missing file → returns value as-is',
      run: async (ctx) => {
        const entry = { value: 'build/certs/does-not-exist.p12' };
        const out = await pushSecrets.resolveSecretValue(entry, '/tmp');
        ctx.expect(out).toBe('build/certs/does-not-exist.p12');
        ctx.expect(entry.isFilePath).toBeUndefined();
      },
    },
    {
      name: 'resolveSecretValue: relative path resolves against projectRoot',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-test-'));
        const relName = 'build/certs/relative-cert.pem';
        const fullPath = path.join(tmpDir, relName);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, Buffer.from('REL'));

        try {
          const out = await pushSecrets.resolveSecretValue({ value: relName }, tmpDir);
          ctx.expect(out).toBe(Buffer.from('REL').toString('base64'));
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'discoverRepo: parses owner/repo from package.json repository.url',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-test-'));
        try {
          fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            name: 'fake',
            repository: { type: 'git', url: 'https://github.com/itw-creative-works/electron-manager.git' },
          }));
          const result = await pushSecrets.discoverRepo(tmpDir);
          ctx.expect(result.owner).toBe('itw-creative-works');
          ctx.expect(result.repo).toBe('electron-manager');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'discoverRepo: handles SSH-style git URL',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-test-'));
        try {
          fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            name: 'fake',
            repository: 'git@github.com:itw-creative-works/electron-manager.git',
          }));
          const result = await pushSecrets.discoverRepo(tmpDir);
          ctx.expect(result.owner).toBe('itw-creative-works');
          ctx.expect(result.repo).toBe('electron-manager');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
  ],
};
