// Preload entry. Exposes window.em to the renderer via contextBridge.
const Manager = require('electron-manager/preload');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger } = manager;

    // Add any extra contextBridge-exposed APIs here. Be careful — anything you expose runs
    // in the renderer's context, so don't pass through privileged Node APIs without care.
    // ...

    logger.log('Preload initialized!');
  });
