// sanitize-url tests — zero-trust URL gate for shell.openExternal and friends.

const sanitizeURL = require('../../../utils/sanitize-url.js');

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'sanitize-url',
  tests: [
    {
      name: 'passes http:// URLs through unchanged',
      run: (ctx) => {
        ctx.expect(sanitizeURL('http://example.com')).toBe('http://example.com');
        ctx.expect(sanitizeURL('http://example.com/path?q=1#x')).toBe('http://example.com/path?q=1#x');
      },
    },
    {
      name: 'passes https:// URLs through unchanged',
      run: (ctx) => {
        ctx.expect(sanitizeURL('https://example.com')).toBe('https://example.com');
        ctx.expect(sanitizeURL('https://localhost:4000/dashboard')).toBe('https://localhost:4000/dashboard');
      },
    },
    {
      name: 'blocks javascript: protocol',
      run: (ctx) => {
        ctx.expect(sanitizeURL('javascript:alert(1)')).toBe('');
        ctx.expect(sanitizeURL('JAVASCRIPT:alert(1)')).toBe('');
        ctx.expect(sanitizeURL('  javascript:alert(1)')).toBe('');
      },
    },
    {
      name: 'blocks data: protocol',
      run: (ctx) => {
        ctx.expect(sanitizeURL('data:text/html,<script>alert(1)</script>')).toBe('');
      },
    },
    {
      name: 'blocks file: protocol',
      run: (ctx) => {
        ctx.expect(sanitizeURL('file:///etc/passwd')).toBe('');
      },
    },
    {
      name: 'blocks vbscript: protocol',
      run: (ctx) => {
        ctx.expect(sanitizeURL('vbscript:msgbox(1)')).toBe('');
      },
    },
    {
      name: 'blocks custom schemes (mailto, restart-manager, chrome)',
      run: (ctx) => {
        ctx.expect(sanitizeURL('mailto:foo@bar.com')).toBe('');
        ctx.expect(sanitizeURL('restart-manager://message?command=register')).toBe('');
        ctx.expect(sanitizeURL('chrome://settings')).toBe('');
      },
    },
    {
      name: 'returns empty for non-string inputs',
      run: (ctx) => {
        ctx.expect(sanitizeURL(null)).toBe('');
        ctx.expect(sanitizeURL(undefined)).toBe('');
        ctx.expect(sanitizeURL('')).toBe('');
        ctx.expect(sanitizeURL(123)).toBe('');
        ctx.expect(sanitizeURL({})).toBe('');
        ctx.expect(sanitizeURL([])).toBe('');
      },
    },
    {
      name: 'returns empty for malformed URLs',
      run: (ctx) => {
        ctx.expect(sanitizeURL('not a url')).toBe('');
        ctx.expect(sanitizeURL('://no-protocol')).toBe('');
      },
    },
  ],
};
