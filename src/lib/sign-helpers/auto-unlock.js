// Auto-unlocks SafeNet / eToken password dialogs that signtool triggers when
// using a SafeNet-managed EV cert (selected via /sha1 thumbprint).
//
// Strategy: in parallel with the signtool invocation, poll the Win32 window
// list (via automately.getWindows() — a single native call, ~1-5ms) looking
// for a "Token Logon" window. When detected, focus it and type the password
// + Enter via automately (a maintained nutjs fork).
//
// Falls back to a no-op if:
//   - automately isn't installed (optional dep, may have failed to compile)
//   - WIN_CSC_KEY_PASSWORD isn't set (signing in thumbprint mode without auto-unlock)
//   - not on Windows
//
// Returns { stop } so the caller can cancel polling once signtool finishes.

let automately;
try {
  automately = require('automately');
} catch (e) {
  automately = null;
}

const POLL_INTERVAL_MS    = 500;    // automately.getWindows() is fast — poll twice a second
const POLL_TIMEOUT_MS     = 60000;
const PRE_TYPE_DELAY_MS   = 2000;   // safety wait after detecting dialog before typing
const PER_CHAR_DELAY_MS   = 60;     // small delay between keystrokes — some dialogs drop chars on fast input

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function findTokenLogonWindow() {
  const windows = await automately.getWindows();
  for (const w of windows) {
    let title = '';
    try { title = await w.title; } catch (e) { continue; }
    if (title && title.startsWith('Token Logon')) return title;
  }
  return null;
}

function startAutoUnlock({ password, logger }) {
  if (process.platform !== 'win32') return { stop: () => {} };
  if (!password) return { stop: () => {} };
  if (!automately) {
    if (logger) logger.warn('automately not installed — SafeNet password prompt will need manual entry. Run `npm install` in the EM repo to enable auto-unlock.');
    return { stop: () => {} };
  }

  let stopped = false;
  let typed   = false;
  const startedAt = Date.now();

  (async function poll() {
    let attempt = 0;
    while (!stopped && !typed && Date.now() - startedAt < POLL_TIMEOUT_MS) {
      attempt += 1;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const pollStart = Date.now();
      let title = null;
      try {
        title = await findTokenLogonWindow();
      } catch (e) {
        if (logger) logger.log(`auto-unlock: poll ${attempt} (${elapsed}s) — getWindows error: ${e.message}`);
      }
      const pollMs = Date.now() - pollStart;

      if (title) {
        if (logger) logger.log(`auto-unlock: SafeNet Token Logon dialog detected (attempt ${attempt}, ${elapsed}s, poll took ${pollMs}ms) — title: "${title}" — waiting ${PRE_TYPE_DELAY_MS}ms before typing...`);
        await sleep(PRE_TYPE_DELAY_MS);

        if (logger) logger.log(`auto-unlock: typing password (${password.length} chars, ~${PER_CHAR_DELAY_MS}ms each)...`);
        for (const ch of password) {
          if (stopped) return;
          await automately.keyboard.type(ch);
          await sleep(PER_CHAR_DELAY_MS);
        }
        await automately.keyboard.type(automately.Key.Enter);
        typed = true;
        if (logger) logger.log('auto-unlock: password typed + Enter pressed.');
        return;
      }

      if (logger) logger.log(`auto-unlock: poll ${attempt} (${elapsed}s, took ${pollMs}ms) — no Token Logon window`);
      await sleep(POLL_INTERVAL_MS);
    }
    if (!typed && !stopped && logger) logger.warn(`auto-unlock: timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s without seeing the Token Logon dialog`);
  })().catch((e) => {
    if (logger) logger.warn(`auto-unlock: poll error: ${e.message}`);
  });

  return {
    stop: () => { stopped = true; },
  };
}

module.exports = { startAutoUnlock };
