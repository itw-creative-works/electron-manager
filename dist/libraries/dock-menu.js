const path = require('path');
const MenuHelper = require('./helpers/menu.js');

function Dock(Manager) {
  const self = this;
  self.Manager = Manager;

  self.initialized = false;
  self.instance = null;
  self.generate = null;
  self.menuTemplate = [];
  self.contextMenu = null;

  self.analyticsCategory = 'dock-menu';

  MenuHelper.init(self);
}

Dock.prototype.init = function (options) {
  const self = this;

  return new Promise(function(resolve, reject) {
    const Manager = self.Manager;
    const { app, Menu } = Manager.libraries.electron;
    const appPath = app.getAppPath();

    app.whenReady().then(() => {
      self.instance = null;
      self.menuTemplate = [];
      self.generate = null;
      self.contextMenu = null;

      self.generateDefault();

      try {
        self.generate = require(path.join(appPath, 'electron-manager', 'dock-menu.js'));
        self.generate(self);
      } catch (e) {
        self.menuTemplate = [];
        console.error('Failed to build from template', e);
      }

      self.dedupe();

      self.contextMenu = Menu.buildFromTemplate(self.menuTemplate);

      if (process.platform === 'darwin') {
        app.dock.setMenu(self.contextMenu);

        self.instance = app.dock.getMenu();
      }      

      self.initialized = true;
      return resolve(self);
    })
  });
};

Dock.prototype.generateDefault = function () {
  const self = this;
  const Manager = self.Manager;
  const { app, Menu, shell } = Manager.libraries.electron;

  const resolvedDeveloper = Manager.resolveDeveloper();
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  // let resolvedDeveloper = false;

  let updaterStatus = {};
  try {
    updaterStatus = Manager.libraries.updater.status;
  } catch (e) {

  }

  // Set default
  self.menuTemplate = [
    // Main
    {
      id: 'main',
      label: app.name,
      submenu: [
        {
          id: 'main/about',
          label: `&About ${app.name}`,
          role: 'about',
        },
        {
          id: 'main/relaunch',
          label: '&Relaunch',
          accelerator: isMac ? 'Command+Option+R' : 'Ctrl+Shift+W',
          click: async (event) => {
            self.analytics(event);

            Manager.relaunch({force: true});
          }
        },
        {
          id: 'main/quit',
          label: '&Quit',
          accelerator: isMac ? 'Command+Q' : 'Alt+F4',
          click: async (event) => {
            self.analytics(event);

            Manager.quit({force: true});
          }
        },
      ]
    },
  ];

  self.dedupe();

  return self;
};

module.exports = Dock;
