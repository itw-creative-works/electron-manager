// Tray definition. Called by electron-manager during boot.
//
// `manager` — the running EM Manager.
// `tray`    — builder API + id-path API (find/update/remove/insertAfter/etc.).
//
// EM auto-resolves the tray icon by convention (most specific wins):
//   1. config/icons/<platform>/tray.png   (platform-specific override)
//   2. config/icons/global/tray.png       (universal fallback for all platforms)
//   3. config/icons/<platform>/icon.png   (slot fallback: tray → app icon)
//   4. EM bundled default
// And auto-sets the tooltip to config.app.productName.
//
// Default items shipped by EM (flat ids — no `tray/` prefix needed):
//   title              — disabled label showing the app name
//   open               — "Open <app>"
//   check-for-updates  — wired to autoUpdater (label/enabled auto-updated)
//   website            — opens brand.url in external browser (only if configured)
//   quit               — quits the app
//
// This file is OPTIONAL — delete it and EM still ships a working tray.

module.exports = ({ manager, tray }) => {
  // Use EM's default template + auto-resolved icon + auto-resolved tooltip.
  tray.useDefaults();

  // ───────── Examples (uncomment to use) ─────────
  //
  // // Override the icon path (otherwise auto-resolved from config/icons/macos/tray.png).
  // // On macOS, the filename MUST end in `Template.png` for OS dark-mode auto-inversion.
  // tray.icon('src/assets/icons/my-trayTemplate.png');
  //
  // // Override the tooltip (otherwise = productName):
  // tray.tooltip('My Custom Tooltip');
  //
  // // Add your own item right after "Open":
  // tray.insertAfter('open', {
  //   id: 'dashboard',
  //   label: 'Open Dashboard',
  //   click: () => manager.windows.show('dashboard'),
  // });
  //
  // // Rename an existing item:
  // tray.update('open', { label: 'Show Window' });
  //
  // // Remove an item entirely:
  // tray.remove('website');
  //
  // // Hide without removing (sets visible:false):
  // tray.hide('check-for-updates');
  //
  // // Disable without removing (sets enabled:false):
  // tray.enable('quit', false);
  //
  // // Add a submenu — items inside addressable as 'account/sign-out' etc.
  // tray.insertBefore('quit', {
  //   id: 'account', label: 'Account', submenu: [
  //     { id: 'sign-out', label: 'Sign out', click: () => {} },
  //   ],
  // });
};
