// Main-process entry. One-line bootstrap. Config is auto-loaded from config/electron-manager.json (JSON5).
new (require('electron-manager/main'))().initialize();
