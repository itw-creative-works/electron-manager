// Application menu definition. Called by electron-manager during boot.
//
// `manager`  — the running EM Manager.
// `menu`     — builder API: menu(label, items), useDefaults(), append(item), clear().
// `defaults` — the platform-aware default template (an array you can mutate).
//
// Item descriptors mirror Electron's MenuItemConstructorOptions, plus:
//   - label / enabled / visible / checked may be functions, evaluated on every refresh()
//   - click is wrapped to catch errors so a bad handler can't crash the menu
//
// After mutating any state your menu reads, call `manager.menu.refresh()`.

module.exports = ({ manager, menu, defaults }) => {
  // Start from the default template (App / File / Edit / View / Window on macOS;
  // File / Edit / View / Window on win/linux).
  menu.useDefaults();

  // Add a Help menu pointing at the brand URL if one is configured.
  const url = manager.config?.brand?.url;
  if (url) {
    menu.menu('Help', [
      {
        label: `Visit ${manager.config?.brand?.name || 'website'}`,
        click: () => {
          const { shell } = require('electron');
          shell.openExternal(url);
        },
      },
    ]);
  }
};
