// stealth-window — the single stealth-surfacing recipe for test runs.
//
// Makes a BrowserWindow render normally while staying invisible and
// non-intrusive: opacity 0 (still painting — deliberately NOT hide()/minimize(),
// which occlusion-throttle Chromium: rAF pauses and visibilityState flips, so
// tests would exercise a DIFFERENT runtime), click-through (real OS clicks pass
// to whatever is underneath; synthetic input — executeJavaScript,
// sendInputEvent, CDP — is unaffected), and never focused.
//
// show()/focus() are rerouted because RAW windows (created with
// `new BrowserWindow()` outside lib/window-manager — e.g. a consumer's
// automation popup) call win.show() themselves: show() becomes showInactive()
// so the window surfaces without taking keyboard focus, and focus() becomes a
// no-op. Stealth is decided at application time — a window stealthed here stays
// stealthed for its lifetime (EM_TEST_SHOW=1 is honored by the callers, per
// window, at creation/surface time).
//
// Consumers: lib/window-manager.js `_surface()` (named windows) and main.js's
// `browser-window-created` hook (every other window during test runs). Shared
// predicate: utils/test-stealth.js.
//
// Idempotent — applying twice is harmless.

function applyStealth(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);

  const showInactive = win.showInactive.bind(win);
  win.show = () => showInactive();
  win.focus = () => {};
}

module.exports = { applyStealth };
