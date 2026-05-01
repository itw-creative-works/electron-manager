// Settings window renderer entry.
const Manager = require('electron-manager/renderer');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger } = manager;
    logger.log('Settings window initialized!');
  });
