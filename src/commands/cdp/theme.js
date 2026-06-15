// `npx mgr cdp theme <dark|light|system>` — flip the app's theme live
// (manager.theme via the main window's renderer).
//
// Flips every renderer (BrowserWindows AND WebContentsViews) with no restart —
// nativeTheme.themeSource → prefers-color-scheme → the preload applier
// rewrites <html data-bs-theme>. The choice PERSISTS in storage (wins over
// config.theme.appearance on later boots) — flip back when you're done.

const client = require('./client');

const SOURCES = ['dark', 'light', 'system'];

module.exports = async function (options) {
  const source = options._[2];
  if (!SOURCES.includes(source)) {
    throw new Error(`Usage: npx mgr cdp theme <${SOURCES.join('|')}>`);
  }

  const state = await client.evaluate(client.MAIN_VIEW, `window.em.theme.set('${source}')`);
  console.log(`theme: source=${state.source} resolved=${state.resolved}`);
};
