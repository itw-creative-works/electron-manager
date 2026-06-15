// `npx mgr cdp <subcommand>` — drive the RUNNING dev app over the Chrome
// DevTools Protocol: orient (status), act (eval, theme), see (shot, capture),
// and run the no-watch iterate loop (relaunch / quit).
//
//   npx mgr cdp status                          # running? targets, window rect, theme
//   npx mgr cdp eval <match> '<expr>'           # evaluate JS in any webContents
//   npx mgr cdp shot <match> <out.png>          # ONE renderer's own pixels
//   npx mgr cdp capture <out.png>               # the COMPOSITED window (macOS)
//   npx mgr cdp theme <dark|light|system>       # flip the live theme
//   npx mgr cdp relaunch                        # quit → npm start → wait for boot
//   npx mgr cdp quit                            # quit + wait for the process tree to drain
//
// All subcommands read EM_CDP_PORT (default 9222) — the same env var `npm
// start` uses to open the endpoint. Targets are matched by URL substring
// (the main window is always `/views/main/`). Full reference:
// docs/cdp-debugging.md.

const path = require('path');

const SUBCOMMANDS = ['status', 'eval', 'shot', 'capture', 'theme', 'relaunch', 'quit'];

const USAGE = [
  'Usage: npx mgr cdp <subcommand>',
  '  status                       app up? targets, window rect, theme',
  "  eval <match> '<expr>'        evaluate JS in the matched webContents",
  '  shot <match> <out.png>       per-renderer screenshot',
  '  capture <out.png>            composited window capture (macOS)',
  '  theme <dark|light|system>    flip the live theme',
  '  relaunch                     quit → npm start → wait for boot',
  '  quit                         quit the app, wait for processes to drain',
].join('\n');

module.exports = async function (options) {
  options = options || {};
  options._ = options._ || [];

  const sub = options._[1];
  if (!sub || !SUBCOMMANDS.includes(sub)) {
    console.error(USAGE);
    throw new Error(sub ? `Unknown cdp subcommand "${sub}"` : 'Missing cdp subcommand');
  }

  const handler = require(path.join(__dirname, 'cdp', `${sub}.js`));
  await handler(options);
};
