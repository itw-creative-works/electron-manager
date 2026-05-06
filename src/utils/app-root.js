// Resolve the consumer app's root directory at runtime.
//
// Why this exists:
//   `process.cwd()` is the project directory in dev (when launched via `npm start` /
//   gulp/serve), but in a PACKAGED .app it's `/` (or the user's home dir, depending on
//   how the app was launched). That breaks every `path.join(process.cwd(), 'dist', ...)`
//   call in lib/* — they end up trying to read `/dist/views/main/index.html` and fail
//   with ERR_FILE_NOT_FOUND.
//
// What it returns:
//   - In Electron context: `app.getAppPath()` — the consumer's app dir, which is the
//     extracted asar mount point in production and the project root in dev.
//   - Outside Electron (tests, scaffolding scripts): falls back to `process.cwd()`.
//
// Always prefer this over `process.cwd()` for runtime path resolution in lib/*.

module.exports = function appRoot() {
  try {
    const electron = require('electron');
    if (electron?.app?.getAppPath) {
      return electron.app.getAppPath();
    }
  } catch (_) { /* electron not available */ }
  return process.cwd();
};
