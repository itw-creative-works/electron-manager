const path = require('path');
const jetpack = require('fs-jetpack');
const MenuHelper = require('./helpers/menu.js');

function Tray(Manager) {
  const self = this;
  self.Manager = Manager;

  self.initialized = false;
  self.instance = null;
  self.generate = null;
  self.menuTemplate = [];
  self.contextMenu = null;
  self._internal = {
    handlers: {
      onClick: () => {},
      onRightClick: () => {},
      onDoubleClick: () => {},
    }
  };
  self.onClick = function (fn) {
    self._internal.handlers.onClick = fn
  }
  self.onRightClick = function (fn) {
    self._internal.handlers.onRightClick = fn
  }
  self.onDoubleClick = function (fn) {
    self._internal.handlers.onDoubleClick = fn
  }

  self.analyticsCategory = 'tray-menu'

  MenuHelper.init(self);
  // self.item = MenuHelper.item;
  // self.insert = MenuHelper.insert;
}

Tray.prototype.init = function (options) {
  const self = this;

  return new Promise(function(resolve, reject) {
    const Manager = self.Manager;
    const { app, Tray, Menu, nativeImage } = Manager.libraries.electron;
    const appPath = app.getAppPath();
    const buildPath = path.join(appPath, 'electron-manager', '_generated', 'icons');
    const fileMac = jetpack.list(buildPath).find(file => file.includes('Template.png'));
    const fileWin = jetpack.list(buildPath).find(file => file.includes('.ico'));
    const fileLinux = jetpack.list(buildPath).find(file => file.includes('.png') && !file.includes('Template'));

    app.whenReady().then(() => {
      // if (self.instance) {
      //   self.instance.destroy()
      // }
      // self.instance = null;
      self.menuTemplate = [];
      self.generate = null;
      self.contextMenu = null;

      self._internal = {
        handlers: {
          onClick: () => {},
          onRightClick: () => {},
          onDoubleClick: () => {},
        }
      };

      if (self.initialized) {
        self.instance.removeAllListeners();
      } else {
        if (process.platform === 'darwin') {
          self.instance = new Tray(path.join(buildPath, fileMac))
        } else if (process.platform === 'win32') {
          self.instance = new Tray(nativeImage.createFromPath(path.join(buildPath, fileWin)))
        } else {
          self.instance = new Tray(nativeImage.createFromPath(path.join(buildPath, fileLinux)))
        }
      }

      self.generateDefault();

      try {
        self.generate = require(path.join(appPath, 'electron-manager', 'tray-menu.js'));
        self.generate(self);
      } catch (e) {
        self.menuTemplate = [];
        console.error('Failed to build from template', e);
      }

      self.dedupe();

      self.contextMenu = Menu.buildFromTemplate(self.menuTemplate);

      self.instance.setToolTip(Manager.options.app.name);
      // self.instance.setTitle(Manager.options.app.name);

      // console.log('----HERE');
      self.instance.on('click', function (event, bounds, position) {
        // console.log('----click');
        if (self._internal.handlers.onClick(...arguments) === false) {
          return
        };

        if (process.platform === 'win32') {
          const mainWindow = Manager.window().get('main');
          if (mainWindow) {
            Manager.window().toggle(mainWindow.id);
          } else {
            self.instance.popUpContextMenu();
          }
        }
      })

      self.instance.on('right-click', function (event, bounds) {
        if (self._internal.handlers.onRightClick(...arguments) === false) {
          return
        };
      })

      self.instance.on('double-click', function (event, bounds) {
        if (self._internal.handlers.onDoubleClick(...arguments) === false) {
          return
        };
      })

      self.contextMenu.on('menu-will-show', function (event) {
        Manager.analytics().event({category: self.analyticsCategory, action: 'open'})
      })

      self.contextMenu.on('menu-will-close', function (event) {
        Manager.analytics().event({category: self.analyticsCategory, action: 'close'})
      })

      self.instance.setContextMenu(self.contextMenu);

      self.initialized = true;
      return resolve(self);
    })
  });
};

Tray.prototype.generateDefault = function () {
  const self = this;
  const Manager = self.Manager;
  const { app, Menu, shell } = Manager.libraries.electron;

  // Set default
  self.menuTemplate = [
    {
      id: 'main',
      label: Manager.options.app.name,
      enabled: false
    },
    { type: 'separator' },
    {
      id: 'expand',
      label: 'Expand',
      click: async (event) => {
        Manager.window().toggle(1);
        self.analytics(event);
      }
    },
    {
      id: 'website',
      label: 'Website',
      click: async (event) => {
        shell.openExternal(Manager.package.homepage)
        self.analytics(event);
      }
    },
    { type: 'separator' },
    {
      id: 'quit',
      label: 'Quit',
      accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Alt+F4',
      click: async (event) => {
        // const mainWindow = Manager.window().get(1);
        // if (mainWindow && mainWindow.browserWindow) {
        //   mainWindow.browserWindow.destroy();
        // }
        self.analytics(event);
        Manager.quit({force: true});
      }
    },
  ]

  self.dedupe();

  return self;
}

module.exports = Tray;
