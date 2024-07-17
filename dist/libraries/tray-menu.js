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

    // Wait for the app to be ready
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

      // Set the tray instance depending on the status and platform
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

      // Generate default
      self.generateDefault();

      // Generate from template
      try {
        self.generate = require(path.join(appPath, 'electron-manager', 'tray-menu.js'));
        self.generate(self);
      } catch (e) {
        self.menuTemplate = [];
        console.error('Failed to build from template', e);
      }

      // Dedupe the menu
      self.dedupe();

      // Set the context menu
      self.contextMenu = Menu.buildFromTemplate(self.menuTemplate);

      // Set the tooltip
      self.instance.setToolTip(Manager.options.app.name);

      // Set the title
      // self.instance.setTitle(Manager.options.app.name);

      // Handle the click event
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

      // Handle the right-click event
      self.instance.on('right-click', function (event, bounds) {
        if (self._internal.handlers.onRightClick(...arguments) === false) {
          return
        };
      })

      // Handle the double-click event
      self.instance.on('double-click', function (event, bounds) {
        if (self._internal.handlers.onDoubleClick(...arguments) === false) {
          return
        };
      })

      // Handle the show event
      self.contextMenu.on('menu-will-show', function (event) {
        Manager.analytics().event(`${self.analyticsCategory}_open`);
      })

      // Handle the close event
      self.contextMenu.on('menu-will-close', function (event) {
        Manager.analytics().event(`${self.analyticsCategory}_close`);
      })

      // Open the context menu
      self.instance.setContextMenu(self.contextMenu);

      // Set initialized
      self.initialized = true;

      // Resolve
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
