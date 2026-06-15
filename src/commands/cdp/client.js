// Shared CDP plumbing for the `mgr cdp` toolkit — zero dependencies (Node 22+
// global fetch + WebSocket). Talks to the RUNNING dev app's DevTools endpoint
// (launch with `EM_CDP_PORT=9222 npm start`, or `npx mgr cdp relaunch`).
//
// EM apps are MULTI-TARGET — one debuggable page per webContents (every
// BrowserWindow and WebContentsView). Every helper takes a URL-substring
// matcher instead of a "selected page"; the main window's document is always
// at `dist/views/main/` (the MAIN_VIEW default matcher).
//
// See docs/cdp-debugging.md for the full toolkit reference.

// The main window's view path — EM's templating convention, so it holds for
// every consumer. Subcommands that need "the app's main renderer" (status,
// theme, capture geometry) default to this matcher.
const MAIN_VIEW = '/views/main/';

function port() {
  return Number(process.env.EM_CDP_PORT || 9222);
}

// List the app's debuggable pages (type === 'page' targets only).
async function targets() {
  const response = await fetch(`http://127.0.0.1:${port()}/json`).catch(() => null);
  if (!response || !response.ok) {
    throw new Error(`No CDP endpoint on port ${port()} — is the app running? (EM_CDP_PORT=${port()} npm start, or npx mgr cdp relaunch)`);
  }
  const list = await response.json();
  return list.filter((t) => t.type === 'page');
}

// Pure matcher — pick the first page target whose URL contains `matcher`.
// (Build-layer tested; keep it free of IO.)
function pickTarget(pages, matcher) {
  if (!matcher) {
    return null;
  }
  return pages.find((t) => t.type === 'page' && (t.url || '').includes(matcher)) || null;
}

async function requireTarget(matcher) {
  const pages = await targets();
  const target = pickTarget(pages, matcher);
  if (!target) {
    throw new Error(`No target matching "${matcher}". Targets:\n${pages.map((t) => `  ${t.url}`).join('\n')}`);
  }
  return target;
}

// Open a CDP WebSocket to a target and return a send(method, params) function.
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
  });

  return { send, close: () => ws.close() };
}

// Evaluate a JS expression in the matched target; returns the JSON value.
// Throws (with the exception text) when the expression throws.
async function evaluate(matcher, expression) {
  const target = await requireTarget(matcher);
  const { send, close } = await connect(target);
  try {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.result?.exceptionDetails) {
      throw new Error(`Expression threw in ${target.url}: ${JSON.stringify(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails)}`);
    }
    return result.result?.result?.value;
  } finally {
    close();
  }
}

// Per-renderer screenshot (that webContents' own pixels — NOT the composited
// window; use `mgr cdp capture` for what the user actually sees).
async function screenshot(matcher, outPath) {
  const fs = require('fs');
  const target = await requireTarget(matcher);
  const { send, close } = await connect(target);
  try {
    await send('Page.enable');
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    if (!shot.result?.data) {
      throw new Error(`captureScreenshot failed: ${JSON.stringify(shot.error || shot)}`);
    }
    fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
    return outPath;
  } finally {
    close();
  }
}

// ── Pure config resolvers (build-layer tested) ─────────────────────────────

// Process names the app may run under: 'Electron' in dev (the node_modules
// binary), the productName when packaged.
function appNames(config) {
  const names = ['Electron'];
  if (config?.app?.productName) {
    names.push(config.app.productName);
  }
  return names;
}

// The boot-complete signal for `mgr cdp relaunch` — a URL substring that must
// match a CDP page target. Default: the main window's document. Consumers
// whose boot finishes later than first paint override via config
// `cdp.readySignal` (e.g. an overlay view created last in the boot sequence).
function readyMatcher(config) {
  return config?.cdp?.readySignal || MAIN_VIEW;
}

module.exports = { MAIN_VIEW, port, targets, pickTarget, requireTarget, connect, evaluate, screenshot, appNames, readyMatcher };
