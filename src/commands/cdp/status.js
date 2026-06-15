// `npx mgr cdp status` — is the dev app up, and what's in it? One-stop
// orientation: every CDP page target (the main window's document is marked),
// the window geometry, and the live theme.

const client = require('./client');

module.exports = async function (options) {
  let pages;
  try {
    pages = await client.targets();
  } catch (error) {
    console.log(`App: NOT RUNNING (${error.message})`);
    process.exitCode = 1;
    return;
  }

  console.log(`App: running (CDP port ${client.port()})`);
  console.log('\nTargets:');
  for (const t of pages) {
    const role = t.url.includes(client.MAIN_VIEW) ? 'main' : '    ';
    console.log(`  [${role}] ${t.url}`);
  }

  const main = client.pickTarget(pages, client.MAIN_VIEW);
  if (!main) {
    console.log(`\n(no ${client.MAIN_VIEW} target — window info unavailable)`);
    return;
  }

  const info = await client.evaluate(client.MAIN_VIEW, `(async () => ({
    window: { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight },
    bsTheme: document.documentElement.getAttribute('data-bs-theme'),
    theme: window.em?.theme ? await window.em.theme.get() : null,
  }))()`);

  console.log(`\nWindow: ${info.window.width}x${info.window.height} at (${info.window.x}, ${info.window.y})`);
  console.log(`Theme: ${info.theme ? `source=${info.theme.source} resolved=${info.theme.resolved}` : '(em.theme unavailable)'}${info.bsTheme ? ` data-bs-theme=${info.bsTheme}` : ''}`);
};
