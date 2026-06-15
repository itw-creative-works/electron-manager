// Build-layer tests for the `mgr cdp` toolkit (src/commands/cdp.js + cdp/).
// The IO surface (live CDP endpoint, screencapture, osascript) only exists
// with a running consumer app, so this covers the pure parts: target
// matching, config resolvers, dispatch, and that every module loads cleanly.

const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', '..', '..', 'commands');

const PAGES = [
  { type: 'page', url: 'file:///x/dist/views/main/index.html' },
  { type: 'page', url: 'app://overlay/' },
  { type: 'page', url: 'https://example.com/' },
  { type: 'other', url: 'app://overlay/' },
];

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'mgr cdp — CLI toolkit pure parts',
  tests: [
    {
      name: 'pickTarget matches page targets by URL substring',
      run: (ctx) => {
        const client = require(path.join(COMMANDS_DIR, 'cdp', 'client.js'));

        ctx.expect(client.pickTarget(PAGES, client.MAIN_VIEW).url).toBe('file:///x/dist/views/main/index.html');
        ctx.expect(client.pickTarget(PAGES, 'app://overlay').url).toBe('app://overlay/');
        ctx.expect(client.pickTarget(PAGES, 'example.com').url).toBe('https://example.com/');
      },
    },
    {
      name: 'pickTarget returns null for no match, empty matcher, and non-page targets',
      run: (ctx) => {
        const client = require(path.join(COMMANDS_DIR, 'cdp', 'client.js'));

        ctx.expect(client.pickTarget(PAGES, 'app://nope')).toBe(null);
        ctx.expect(client.pickTarget(PAGES, '')).toBe(null);
        ctx.expect(client.pickTarget([{ type: 'other', url: 'app://x/' }], 'app://x')).toBe(null);
      },
    },
    {
      name: 'appNames: Electron always; productName appended when configured',
      run: (ctx) => {
        const client = require(path.join(COMMANDS_DIR, 'cdp', 'client.js'));

        ctx.expect(client.appNames({})).toEqual(['Electron']);
        ctx.expect(client.appNames(null)).toEqual(['Electron']);
        ctx.expect(client.appNames({ app: { productName: 'Somiibo' } })).toEqual(['Electron', 'Somiibo']);
      },
    },
    {
      name: 'readyMatcher: main view by default, config cdp.readySignal wins',
      run: (ctx) => {
        const client = require(path.join(COMMANDS_DIR, 'cdp', 'client.js'));

        ctx.expect(client.readyMatcher({})).toBe(client.MAIN_VIEW);
        ctx.expect(client.readyMatcher(null)).toBe(client.MAIN_VIEW);
        ctx.expect(client.readyMatcher({ cdp: { readySignal: 'app://overlay' } })).toBe('app://overlay');
      },
    },
    {
      name: 'dispatcher rejects missing and unknown subcommands',
      run: async (ctx) => {
        const dispatch = require(path.join(COMMANDS_DIR, 'cdp.js'));

        let missing = null;
        await dispatch({ _: ['cdp'] }).catch((error) => { missing = error; });
        ctx.expect(missing && missing.message).toBe('Missing cdp subcommand');

        let unknown = null;
        await dispatch({ _: ['cdp', 'bogus'] }).catch((error) => { unknown = error; });
        ctx.expect(unknown && unknown.message).toBe('Unknown cdp subcommand "bogus"');
      },
    },
    {
      name: 'every subcommand module loads and exports a handler function',
      run: (ctx) => {
        for (const sub of ['status', 'eval', 'shot', 'capture', 'theme', 'relaunch', 'quit']) {
          const handler = require(path.join(COMMANDS_DIR, 'cdp', `${sub}.js`));
          ctx.expect(typeof handler).toBe('function');
        }
        const quit = require(path.join(COMMANDS_DIR, 'cdp', 'quit.js'));
        ctx.expect(typeof quit.quitAndDrain).toBe('function');
      },
    },
  ],
};
