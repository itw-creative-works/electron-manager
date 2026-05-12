// sanitize-url — zero-trust URL gate for any string passed to `shell.openExternal`,
// `BrowserWindow.loadURL`, or any other API that resolves a URL protocol.
//
// Returns the URL unchanged when its protocol is `http:` or `https:`; returns `''`
// for anything else (`javascript:`, `file:`, `data:`, `vbscript:`, `chrome:`, etc.).
// Empty string is preferred over throwing because callers can no-op cleanly without
// try/catch noise. shell.openExternal('') is a documented no-op on all platforms.
//
// This is for HTTP(S) URLs only. Custom schemes like `restart-manager://` or `mailto:`
// must be passed through directly — do NOT route them through this helper.
//
// Usage:
//   const sanitizeURL = require('./utils/sanitize-url.js');
//   const safe = sanitizeURL(maybeHostileUrl);
//   if (safe) shell.openExternal(safe);

function sanitizeURL(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return url;
  } catch (e) {
    return '';
  }
}

module.exports = sanitizeURL;
