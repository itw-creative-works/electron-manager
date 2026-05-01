// Main-process entry. Config is auto-loaded from config/electron-manager.json (JSON5).
const Manager = require('electron-manager/main');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger, ipc, storage, windows, tray, menu, deepLink, autoUpdater, webManager, appState, sentry } = manager;

    // Add your project-specific main-process logic here.
    // To disable a feature: manager.tray.disable() / manager.menu.disable() / manager.contextMenu.disable()
    // To listen for deep links: manager.deepLink.on('my-route', (ctx) => { ... })
    // ...

    logger.log('Main initialized!');
  });
