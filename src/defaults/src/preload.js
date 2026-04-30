// Preload entry. Exposes window.em to the renderer via contextBridge.
new (require('electron-manager/preload'))().initialize();
