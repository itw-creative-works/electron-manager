// Application menu definition. Called by electron-manager during boot.
//
// `manager`  — the running EM Manager.
// `menu`     — builder API + id-path API (find/update/remove/insertAfter/etc.).
// `defaults` — the platform-aware default template (an array you can mutate manually if needed).
//
// This file is OPTIONAL — delete it and EM still ships a working application menu.
//
// EM ships a default menu template with stable id paths. Highlights:
//   main/about, main/check-for-updates, main/preferences (hidden), main/services,
//     main/hide, main/relaunch, main/quit                                          (mac)
//   file/close (mac), file/preferences, file/relaunch, file/quit                   (win/linux)
//   edit/undo, edit/redo, edit/cut, edit/copy, edit/paste, edit/select-all
//   view/reload, view/zoom-in, view/zoom-out, view/toggle-fullscreen
//   view/developer/{toggle-devtools, inspect-elements, force-reload}               (dev only)
//   window/minimize, window/zoom (mac), window/close (win/linux)
//   help/check-for-updates (win/linux), help/website (when brand.url configured)
//   development/{open-exe-folder, open-user-data, open-logs, open-app-config,
//                test-error}                                                       (dev only)

module.exports = ({ manager, menu, defaults }) => {
  // Start from the platform-appropriate default template. Don't add anything
  // by default — leave it identical to what the framework would do without
  // this file. Add your own customizations below.
  menu.useDefaults();

  // ───────── Examples (uncomment to use) ─────────
  //
  // // Show the Preferences item (hidden by default — flip its visibility once you
  // // wire up your settings window):
  // menu.show(process.platform === 'darwin' ? 'main/preferences' : 'file/preferences');
  //
  // // Insert your own item right after Check for Updates:
  // menu.insertAfter('main/check-for-updates', {
  //   id: 'main/account',
  //   label: 'Account...',
  //   click: () => manager.windows.show('account'),
  // });
  //
  // // Rename an existing item:
  // menu.update('main/check-for-updates', { label: 'Get Latest Version' });
  //
  // // Remove an item entirely:
  // menu.remove('view/reload');
  //
  // // Hide without removing (sets visible:false):
  // menu.hide('main/services');
  //
  // // Add an entire new top-level menu:
  // menu.menu('Tools', [
  //   { id: 'tools/sync', label: 'Sync Now', click: () => {} },
  //   { type: 'separator' },
  //   { id: 'tools/export', label: 'Export...', click: () => {} },
  // ]);
  //
  // // Append into an existing submenu:
  // menu.appendTo('view', { id: 'view/custom-zoom', label: 'Custom Zoom...', click: () => {} });
};
