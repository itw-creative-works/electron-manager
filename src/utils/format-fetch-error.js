// format-fetch-error — flatten a fetch/network error into one short, log-safe line.
//
// wonderful-fetch's buildError() uses the ENTIRE response body as `error.message`.
// When a brand-site endpoint is missing (remote-config, remote-scripts), that body
// is a full HTML 404 page — dumping it into the console/runtime.log buries real
// output, and re-spams on every periodic poll. This helper:
//   1. Swaps HTML bodies for a short human description (markup is noise in a log).
//   2. Prefixes the HTTP status when the error carries one (`error.status`).
//   3. Collapses whitespace to a single line and caps the length.
//
// Usage:
//   const formatFetchError = require('../utils/format-fetch-error.js');
//   fetch(url, opts).catch((e) => logger.warn(`fetch failed: ${formatFetchError(e)}`));

const MAX_LENGTH = 200;

function formatFetchError(error, maxLength) {
  const max = maxLength || MAX_LENGTH;
  const status = (error && typeof error.status === 'number') ? `HTTP ${error.status}: ` : '';

  // Flatten to one line — embedded newlines break grep and bury adjacent log lines.
  let message = String((error && error.message) || error || 'Unknown error')
    .replace(/\s+/g, ' ')
    .trim();

  // An HTML page in the message is pure noise — name it instead of printing it.
  if (/^<!doctype\b|^<html\b/i.test(message)) {
    message = 'response was an HTML page, not the expected resource';
  }

  if (message.length > max) {
    message = `${message.slice(0, max)}… [truncated]`;
  }

  return `${status}${message}`;
}

module.exports = formatFetchError;
