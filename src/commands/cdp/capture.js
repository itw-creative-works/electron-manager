// `npx mgr cdp capture <out.png>` — composited window capture: what the user
// ACTUALLY sees (the BrowserWindow document + every WebContentsView stacked by
// the window server), normalized to sRGB.
//
//   npx mgr cdp capture <out.png> [--window-id <CGWindowID>]
//   npx mgr cdp capture --find-window-id
//
// Default path: raises the app (System Events), reads the window rect over
// CDP, region-captures it. Anything overlapping that region after the raise
// (e.g. an always-on-top window) would be captured too — for an
// occlusion-proof capture pass `--window-id` (find it with --find-window-id;
// it's stable for the window's lifetime, so cache it per app launch).
//
// WHY the sips step: macOS embeds the MONITOR's ICC profile in screenshot
// PNGs; many viewers (including image previews in tooling) misrender it
// dramatically (a dark panel can read near-white). Converting to sRGB makes
// the file portable. Raw pixel VALUES in the PNG are correct either way.
//
// macOS only (screencapture / sips / osascript).

const { execFileSync } = require('child_process');
const client = require('./client');

const Manager = new (require('../../build.js'))();

const SRGB_PROFILE = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';

// Dev runs under the Electron binary's name; packaged builds under the
// product name — try each until one raises.
function raiseApp(names) {
  let lastError = null;
  for (const name of names) {
    try {
      execFileSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose name contains "${name}") to true`]);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`could not raise the app (tried: ${names.join(', ')}): ${lastError.message}`);
}

// CGWindowID lookup via a Swift snippet — slow (~2-4s compile) but dependable.
// (JXA's CoreGraphics bridge segfaults on CGWindowListCopyWindowInfo.)
function findWindowIds(names) {
  const matchExpr = names.map((n) => `owner.contains("${n}") || name.contains("${n}")`).join(' || ');
  const swift = `
import CoreGraphics
import Foundation
let opts = CGWindowListOption([.optionOnScreenOnly, .excludeDesktopElements])
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
for w in list {
    let owner = w["kCGWindowOwnerName"] as? String ?? ""
    let name = w["kCGWindowName"] as? String ?? ""
    if ${matchExpr} {
        print("\\(w["kCGWindowNumber"] ?? 0) | \\(owner) | \\(name)")
    }
}
`;
  return execFileSync('swift', ['-'], { input: swift, encoding: 'utf8' }).trim();
}

module.exports = async function (options) {
  if (process.platform !== 'darwin') {
    throw new Error('mgr cdp capture is macOS-only (screencapture/sips/osascript)');
  }

  const names = client.appNames(Manager.getConfig());

  if (options['find-window-id'] || options.findWindowId) {
    console.log(findWindowIds(names) || `no windows found (tried: ${names.join(', ')})`);
    return;
  }

  const outPath = options._[2];
  if (!outPath) {
    throw new Error('Usage: npx mgr cdp capture <out.png> [--window-id <id>] | --find-window-id');
  }

  const windowId = options['window-id'] || options.windowId;
  if (windowId) {
    execFileSync('screencapture', ['-x', '-o', '-l', String(windowId), outPath]);
  } else {
    raiseApp(names);
    const rect = await client.evaluate(client.MAIN_VIEW, '({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })');
    execFileSync('screencapture', ['-x', `-R${rect.x},${rect.y},${rect.w},${rect.h}`, outPath]);
  }

  execFileSync('sips', ['-m', SRGB_PROFILE, outPath, '--out', outPath], { stdio: 'ignore' });
  console.log(`captured ${outPath}`);
};
