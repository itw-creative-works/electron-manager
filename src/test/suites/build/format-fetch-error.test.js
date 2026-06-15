// format-fetch-error tests — one-line, truncated, humanized fetch-failure messages.
// Guards against the "wonderful-fetch puts an entire HTML 404 page in e.message"
// log-spam case (remote-config / remote-scripts brand-site fetches).

const formatFetchError = require('../../../utils/format-fetch-error.js');

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'format-fetch-error',
  tests: [
    {
      name: 'passes short plain messages through unchanged',
      run: (ctx) => {
        ctx.expect(formatFetchError(new Error('Request timed out'))).toBe('Request timed out');
        ctx.expect(formatFetchError(new Error('Response is not JSON: SyntaxError: Unexpected token <'))).toBe('Response is not JSON: SyntaxError: Unexpected token <');
      },
    },
    {
      name: 'replaces an HTML error-page body with a short description',
      run: (ctx) => {
        const e = new Error('<!doctype html><html aria-busy="true" data-loader="default"><head><title>404</title></head><body>Page not found</body></html>');
        e.status = 404;
        const out = formatFetchError(e);
        ctx.expect(out).toBe('HTTP 404: response was an HTML page, not the expected resource');
        ctx.expect(out).not.toContain('<');
      },
    },
    {
      name: 'detects HTML bodies case-insensitively and without a doctype',
      run: (ctx) => {
        ctx.expect(formatFetchError(new Error('<HTML lang="en"><body>x</body></HTML>'))).toBe('response was an HTML page, not the expected resource');
        ctx.expect(formatFetchError(new Error('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"><html></html>'))).toBe('response was an HTML page, not the expected resource');
        ctx.expect(formatFetchError(new Error('  \n <!doctype html><html></html>'))).toBe('response was an HTML page, not the expected resource');
      },
    },
    {
      name: 'does not flag non-HTML messages that merely contain markup',
      run: (ctx) => {
        ctx.expect(formatFetchError(new Error('expected <json> but parse failed'))).toBe('expected <json> but parse failed');
      },
    },
    {
      name: 'prefixes HTTP status when error.status is present',
      run: (ctx) => {
        const e = new Error('Not Found');
        e.status = 404;
        ctx.expect(formatFetchError(e)).toBe('HTTP 404: Not Found');
      },
    },
    {
      name: 'truncates long non-HTML messages at the cap',
      run: (ctx) => {
        const out = formatFetchError(new Error('x'.repeat(500)));
        ctx.expect(out).toContain('[truncated]');
        ctx.expect(out).toContain('x'.repeat(200));
        ctx.expect(out).not.toContain('x'.repeat(201));
        ctx.expect(out.length).toBeLessThan(250);
      },
    },
    {
      name: 'collapses multi-line messages to one line',
      run: (ctx) => {
        const out = formatFetchError(new Error('line one\n   line two\t\tend'));
        ctx.expect(out).toBe('line one line two end');
        ctx.expect(out).not.toContain('\n');
      },
    },
    {
      name: 'handles null/undefined/string inputs without throwing',
      run: (ctx) => {
        ctx.expect(formatFetchError(null)).toBe('Unknown error');
        ctx.expect(formatFetchError(undefined)).toBe('Unknown error');
        ctx.expect(formatFetchError('plain string failure')).toBe('plain string failure');
      },
    },
    {
      name: 'respects a custom maxLength',
      run: (ctx) => {
        ctx.expect(formatFetchError(new Error('abcdefghij'), 5)).toBe('abcde… [truncated]');
      },
    },
  ],
};
