// Minimal preload for the boot-layer self-test fixture. Exposes window.em to the renderer.
const Manager = require('electron-manager/preload');

new Manager().initialize();
