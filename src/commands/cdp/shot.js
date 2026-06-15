// `npx mgr cdp shot <target-match> <out.png>` — per-renderer screenshot: what
// ONE webContents painted (its own surface).
//
// This is NOT the composited window (BrowserWindow document + WebContentsViews
// stack in the window server) — use `mgr cdp capture` to see what the user
// actually sees. Per-renderer shots are the discriminator when compositing
// looks wrong: if this image is correct but capture isn't, the bug is between
// the renderer and the window server, not in your CSS.

const client = require('./client');

module.exports = async function (options) {
  const [, , matcher, outPath] = options._;
  if (!matcher || !outPath) {
    throw new Error('Usage: npx mgr cdp shot <target-match> <out.png>');
  }

  await client.screenshot(String(matcher), String(outPath));
  console.log(`saved ${outPath}`);
};
