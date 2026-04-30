// Build-layer tests for commands/validate-certs.js — provisioning profile parsing logic.
// The full validate flow (Keychain query, env vars) is exercised via real `npx mgr setup` runs.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const validateCerts = require(path.join(__dirname, '..', '..', '..', 'commands', 'validate-certs.js'));

// A minimal mock provisioning profile (CMS-wrapped XML plist payload).
function makeMockProvision({ appId, expirationDate }) {
  const appIdLine = appId
    ? `\n  <key>application-identifier</key>\n  <string>${appId}</string>`
    : '';
  const expLine = expirationDate
    ? `\n  <key>ExpirationDate</key>\n  <date>${expirationDate.toISOString()}</date>`
    : '';

  // The function strips outer CMS wrapping by regex-matching the inner plist; we just
  // wrap our test XML in some CMS-like junk so the regex still works.
  const inner = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>${appIdLine}${expLine}
</dict>
</plist>`;

  return `XX-CMS-WRAPPER-XX${inner}YY-CMS-WRAPPER-YY`;
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'validate-certs — provisioning profile parsing',
  tests: [
    {
      name: 'parseProvision extracts plist from CMS-wrapped file',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-test-'));
        const profPath = path.join(tmpDir, 'test.provisionprofile');
        fs.writeFileSync(profPath, makeMockProvision({
          appId: 'TEAMID.com.itwcw.testapp',
          expirationDate: new Date('2099-01-01T00:00:00Z'),
        }));

        try {
          const result = validateCerts.parseProvision(profPath);
          ctx.expect(result.parsed).toBeTruthy();
          ctx.expect(result.parsed['application-identifier']).toBe('TEAMID.com.itwcw.testapp');
          ctx.expect(result.parsed.ExpirationDate).toBeInstanceOf(Date);
          ctx.expect(result.raw).toContain('<plist');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'parseProvision returns nulls for malformed file',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-test-'));
        const profPath = path.join(tmpDir, 'bad.provisionprofile');
        fs.writeFileSync(profPath, 'this is not a plist at all');

        try {
          const result = validateCerts.parseProvision(profPath);
          ctx.expect(result.parsed).toBeNull();
          ctx.expect(result.raw).toBeNull();
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'parseProvision handles missing file',
      run: (ctx) => {
        const result = validateCerts.parseProvision('/nonexistent/path.provisionprofile');
        ctx.expect(result.parsed).toBeNull();
      },
    },
    {
      name: 'parseProvision raw string contains the appId for substring match logic',
      run: (ctx) => {
        // The validator checks `parsed.raw.includes(expectedAppId)` — confirm the raw is
        // searchable for that.
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-test-'));
        const profPath = path.join(tmpDir, 'app.provisionprofile');
        fs.writeFileSync(profPath, makeMockProvision({
          appId: 'TEAMID.com.itwcw.somiibo',
          expirationDate: new Date('2099-01-01T00:00:00Z'),
        }));

        try {
          const result = validateCerts.parseProvision(profPath);
          ctx.expect(result.raw.includes('com.itwcw.somiibo')).toBe(true);
          ctx.expect(result.raw.includes('com.itwcw.different-app')).toBe(false);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
  ],
};
