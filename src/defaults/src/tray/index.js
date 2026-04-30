// Tray definition. Called by electron-manager during boot.
//
// `manager` is the running EM Manager — use it to talk to windows, storage, etc.
// `tray` is the builder API — icon(), tooltip(), item(), separator(), submenu().
//
// Item descriptors mirror Electron's MenuItemConstructorOptions, plus:
//   - label / enabled / visible / checked may be functions, evaluated on every refresh()
//   - click is wrapped to catch errors so a bad handler can't crash the menu
//
// After mutating any state your tray reads, call `manager.tray.refresh()`.

module.exports = ({ manager, tray }) => {
  tray.icon('src/assets/icons/tray-Template.png');
  tray.tooltip(manager.config?.app?.productName || 'App');

  tray.item({
    label: `Open ${manager.config?.app?.productName || 'App'}`,
    click: () => manager.windows.show('main'),
  });

  tray.separator();

  tray.item({
    label: 'Quit',
    click: () => {
      const { app } = require('electron');
      app.quit();
    },
  });
};
