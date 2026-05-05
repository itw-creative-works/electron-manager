// Build-layer tests for lib/sign-helpers/update-info.js — Windows latest.yml generation.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const crypto  = require('crypto');
const yaml    = require('js-yaml');

const MOD_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'update-info.js');

function freshTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'em-update-info-test-'));
}

function writeBytes(filePath, bytes) {
  fs.writeFileSync(filePath, Buffer.from(bytes));
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'update-info — Windows auto-updater feed (latest.yml) generation',
  tests: [
    {
      name: 'module exposes writeUpdateInfo + internal helpers for testing',
      run: (ctx) => {
        const mod = require(MOD_PATH);
        ctx.expect(typeof mod.writeUpdateInfo).toBe('function');
        ctx.expect(typeof mod._internals.sha512Base64).toBe('function');
        ctx.expect(typeof mod._internals.buildUpdateInfo).toBe('function');
      },
    },
    {
      name: 'sha512Base64: matches known-good base64 of raw 64-byte digest',
      run: async (ctx) => {
        const { _internals } = require(MOD_PATH);
        const tmp = freshTmpDir();
        try {
          const filePath = path.join(tmp, 'sample.bin');
          writeBytes(filePath, [0x00, 0x01, 0x02, 0x03]);
          // Reference: sha512 of [0,1,2,3] computed via openssl, base64-encoded
          const expected = crypto.createHash('sha512')
            .update(Buffer.from([0x00, 0x01, 0x02, 0x03]))
            .digest('base64');
          const actual = await _internals.sha512Base64(filePath);
          ctx.expect(actual).toBe(expected);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'buildUpdateInfo: emits canonical schema with files[], path, sha512, releaseDate',
      run: (ctx) => {
        const { _internals } = require(MOD_PATH);
        const info = _internals.buildUpdateInfo({
          version: '1.2.3',
          releaseDate: '2026-05-04T00:00:00.000Z',
          files: [
            { url: 'MyApp-Setup-1.2.3.exe', sha512: 'abc==', size: 12345 },
          ],
        });
        ctx.expect(info.version).toBe('1.2.3');
        ctx.expect(info.files.length).toBe(1);
        ctx.expect(info.files[0].url).toBe('MyApp-Setup-1.2.3.exe');
        ctx.expect(info.files[0].sha512).toBe('abc==');
        ctx.expect(info.files[0].size).toBe(12345);
        // Deprecated top-level fields kept for backward compat.
        ctx.expect(info.path).toBe('MyApp-Setup-1.2.3.exe');
        ctx.expect(info.sha512).toBe('abc==');
        ctx.expect(info.releaseDate).toBe('2026-05-04T00:00:00.000Z');
      },
    },
    {
      name: 'buildUpdateInfo: includes blockMapSize when provided',
      run: (ctx) => {
        const { _internals } = require(MOD_PATH);
        const info = _internals.buildUpdateInfo({
          version: '1.0.0',
          releaseDate: '2026-05-04T00:00:00.000Z',
          files: [
            { url: 'a.exe', sha512: 'x==', size: 100, blockMapSize: 50 },
          ],
        });
        ctx.expect(info.files[0].blockMapSize).toBe(50);
      },
    },
    {
      name: 'buildUpdateInfo: omits blockMapSize when undefined',
      run: (ctx) => {
        const { _internals } = require(MOD_PATH);
        const info = _internals.buildUpdateInfo({
          version: '1.0.0',
          releaseDate: '2026-05-04T00:00:00.000Z',
          files: [
            { url: 'a.exe', sha512: 'x==', size: 100 },
          ],
        });
        ctx.expect('blockMapSize' in info.files[0]).toBe(false);
      },
    },
    {
      name: 'buildUpdateInfo: throws on empty files',
      run: (ctx) => {
        const { _internals } = require(MOD_PATH);
        ctx.expect(() => _internals.buildUpdateInfo({
          version: '1.0.0',
          releaseDate: '2026-05-04T00:00:00.000Z',
          files: [],
        })).toThrow();
      },
    },
    {
      name: 'buildUpdateInfo: path/sha512 deprecated fields point at primary (first) file',
      run: (ctx) => {
        const { _internals } = require(MOD_PATH);
        const info = _internals.buildUpdateInfo({
          version: '1.0.0',
          releaseDate: '2026-05-04T00:00:00.000Z',
          files: [
            { url: 'primary.exe', sha512: 'AAA==', size: 100 },
            { url: 'secondary.exe', sha512: 'BBB==', size: 200 },
          ],
        });
        ctx.expect(info.path).toBe('primary.exe');
        ctx.expect(info.sha512).toBe('AAA==');
      },
    },
    {
      name: 'writeUpdateInfo: end-to-end writes parseable yml referencing the signed exe',
      run: async (ctx) => {
        const { writeUpdateInfo } = require(MOD_PATH);
        const tmp = freshTmpDir();
        try {
          const exe = path.join(tmp, 'MyApp-Setup-1.0.0.exe');
          // Random bytes so the sha512 isn't trivially predictable.
          writeBytes(exe, Array.from(crypto.randomBytes(2048)));

          const ymlPath = await writeUpdateInfo({
            signedExes: [{ filePath: exe, urlName: path.basename(exe) }],
            outDir: tmp,
            version: '1.0.0',
            releaseDate: '2026-05-04T12:00:00.000Z',
          });

          ctx.expect(ymlPath).toBe(path.join(tmp, 'latest.yml'));
          ctx.expect(fs.existsSync(ymlPath)).toBe(true);

          const parsed = yaml.load(fs.readFileSync(ymlPath, 'utf8'));
          ctx.expect(parsed.version).toBe('1.0.0');
          ctx.expect(parsed.files.length).toBe(1);
          ctx.expect(parsed.files[0].url).toBe('MyApp-Setup-1.0.0.exe');
          ctx.expect(parsed.files[0].size).toBe(2048);
          // Recompute sha512 ourselves and confirm yml's value matches.
          const expectedSha = crypto.createHash('sha512')
            .update(fs.readFileSync(exe))
            .digest('base64');
          ctx.expect(parsed.files[0].sha512).toBe(expectedSha);
          ctx.expect(parsed.path).toBe('MyApp-Setup-1.0.0.exe');
          ctx.expect(parsed.releaseDate).toBe('2026-05-04T12:00:00.000Z');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'writeUpdateInfo: defaults releaseDate to now() when omitted',
      run: async (ctx) => {
        const { writeUpdateInfo } = require(MOD_PATH);
        const tmp = freshTmpDir();
        try {
          const exe = path.join(tmp, 'a.exe');
          writeBytes(exe, [0x01, 0x02]);

          const before = Date.now();
          await writeUpdateInfo({
            signedExes: [{ filePath: exe, urlName: 'a.exe' }],
            outDir: tmp,
            version: '0.0.1',
          });
          const after = Date.now();

          const parsed = yaml.load(fs.readFileSync(path.join(tmp, 'latest.yml'), 'utf8'));
          const releaseTs = Date.parse(parsed.releaseDate);
          ctx.expect(releaseTs >= before && releaseTs <= after).toBe(true);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'writeUpdateInfo: throws on empty signedExes',
      run: async (ctx) => {
        const { writeUpdateInfo } = require(MOD_PATH);
        let threw = null;
        try {
          await writeUpdateInfo({ signedExes: [], outDir: '/tmp', version: '1.0.0' });
        } catch (e) {
          threw = e;
        }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/empty/);
      },
    },
    {
      name: 'writeUpdateInfo: throws on missing version',
      run: async (ctx) => {
        const { writeUpdateInfo } = require(MOD_PATH);
        let threw = null;
        try {
          await writeUpdateInfo({
            signedExes: [{ filePath: '/dev/null', urlName: 'x.exe' }],
            outDir: '/tmp',
          });
        } catch (e) {
          threw = e;
        }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/version/);
      },
    },
  ],
};
