// Sentry — context-aware delegator. The Manager singleton in any process imports this file;
// it detects which Electron process it's running in and forwards every call to the right
// per-context module (main / renderer / preload).
//
// Detection rules:
//   - main:     `process.type === 'browser'` (electron's name for the main process) OR no process.type at all
//                (e.g. running outside electron, in tests).
//   - renderer: `process.type === 'renderer'` AND `typeof window !== 'undefined'`.
//   - preload:  `process.type === 'renderer'` AND `process.contextIsolated === true` is the canonical signal,
//                but in practice EM's preload entry calls a different file. The preload module here is exposed
//                via `require('electron-manager/lib/sentry/preload')` directly when needed.

function detectContext() {
  if (typeof process !== 'undefined' && process.type === 'renderer') return 'renderer';
  return 'main';
}

const ctx = detectContext();
const impl = ctx === 'renderer'
  ? require('./renderer.js')
  : require('./main.js');

module.exports = impl;
