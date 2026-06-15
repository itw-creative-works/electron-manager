// `npx mgr cdp relaunch` — the dev iterate loop in one command. EM's
// `npm start` has NO watch (build once, then run), so every src/ edit needs
// quit → rebuild → boot.
//
// Boots with CDP on EM_CDP_PORT (default 9222) so the other cdp subcommands
// can attach. "Booted" = a page target matching the ready signal exists —
// default: the main window's document (`/views/main/`); consumers whose boot
// completes later than first paint override via config `cdp.readySignal`
// (a URL substring, e.g. an overlay view created last in the boot sequence).
//
// The spawned `npm start` is detached and keeps running after this exits;
// its output goes to logs/dev.log as usual.
//
// macOS only (the quit step uses osascript).

const { spawn } = require('child_process');
const client = require('./client');
const { quitAndDrain } = require('./quit');

const Manager = new (require('../../build.js'))();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function portUp() {
  const response = await fetch(`http://127.0.0.1:${client.port()}/json/version`).catch(() => null);
  return Boolean(response && response.ok);
}

async function waitForBoot(matcher) {
  // Build + boot: webpack takes the bulk of it. Generous ceiling.
  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    if (!await portUp()) {
      continue;
    }
    const pages = await client.targets().catch(() => []);
    if (client.pickTarget(pages, matcher)) {
      return;
    }
  }
  throw new Error('boot timeout — check logs/dev.log');
}

module.exports = async function (options) {
  const config = Manager.getConfig();

  const wasRunning = await quitAndDrain(client.appNames(config));
  console.log(wasRunning ? 'quit running app' : 'app was not running');

  const child = spawn('npm', ['start'], {
    cwd: process.cwd(),
    env: { ...process.env, EM_CDP_PORT: String(client.port()) },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const matcher = client.readyMatcher(config);
  console.log('building + booting (logs/dev.log)…');
  await waitForBoot(matcher);
  console.log(`booted — CDP on ${client.port()}, ready ("${matcher}" target up)`);
};
