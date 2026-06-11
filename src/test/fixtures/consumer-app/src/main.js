// Minimal main entry for EM's boot-layer self-test fixture. Mirrors a real consumer:
// one-line bootstrap, then create the main window once initialize() resolves. The boot
// harness (src/test/harness/boot-entry.js) inspects the live manager after this runs.
const Manager = require('electron-manager/main');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { windows, logger } = manager;

    // Force show:false — the boot harness runs headless and only asserts the window
    // EXISTS + loaded the built view, never that it's visible on screen.
    windows.create('main', { show: false });

    logger.log('EM fixture consumer main initialized!');
  });
