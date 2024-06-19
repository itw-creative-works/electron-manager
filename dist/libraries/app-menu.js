const path = require('path');
const MenuHelper = require('./helpers/menu.js');

function Menu(Manager) {
  const self = this;
  self.Manager = Manager;

  self.initialized = false;
  self.instance = null;
  self.generate = null;
  self.menuTemplate = [];
  self.contextMenu = null;

  self.analyticsCategory = 'app-menu';

  MenuHelper.init(self);
  // self.item = MenuHelper.item;
  // self.insert = MenuHelper.insert;
}

Menu.prototype.init = function (options) {
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
        self.generate = require(path.join(appPath, 'electron-manager', 'app-menu.js'));
        self.generate(self);
      } catch (e) {
        self.menuTemplate = [];
        console.error('Failed to build from template', e);
      }

      self.dedupe();

      self.contextMenu = Menu.buildFromTemplate(self.menuTemplate);

      // console.log('------1', self.contextMenu.commandsMap['75'].submenu.commandsMap['66'].submenu);
      // console.log('------2', self.contextMenu.commandsMap['75'].submenu.commandsMap['66'].menu);

      Menu.setApplicationMenu(self.contextMenu);
      self.instance = Menu.getApplicationMenu()

      // Not triggered :(
      // https://stackoverflow.com/questions/55009560/electron-listen-to-menu-will-show-event
      // self.instance.on('menu-will-show', (event) => {
      //   console.log('---instance show');
      //   // Manager.analytics().event({category: self.analyticsCategory, action: 'open'})
      // })
      //
      // self.instance.on('menu-will-close', (event) => {
      //   console.log('---instance close');
      //   // Manager.analytics().event({category: self.analyticsCategory, action: 'close'})
      // })

      self.initialized = true;
      return resolve(self);
    })
  });
};

Menu.prototype.generateDefault = function () {
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
          id: 'main/update-check',
          label: `Check for &Updates`,
          visible: !['downloading', 'downloaded'].includes(updaterStatus.code),
          enabled: !['downloading', 'downloaded'].includes(updaterStatus.code),
          click: async (event) => {
            self.analytics(event);
            Manager.sendToRegisteredRenderers('app-menu:choice', {id: event.id})

            Manager.libraries.updater.update({userAction: true});
          }
        },
        {
          id: 'main/update-install',
          label: `Install v${updaterStatus.version} &Update`,
          visible: updaterStatus.code === 'downloaded',
          enabled: updaterStatus.code === 'downloaded',
          click: async (event) => {
            self.analytics(event);
            Manager.sendToRegisteredRenderers('app-menu:choice', {id: event.id})

            Manager.relaunch({force: true});
          }
        },
        { type: 'separator' },
        {
          id: 'main/preferences',
          label: '&Preferences',
          accelerator: 'CommandOrControl+,',
          visible: false,
          click: async (event) => {
            self.analytics(event);
            Manager.sendToRegisteredRenderers('app-menu:choice', {id: event.id})
          }
        },

        // Mac options
        !isMac ? null :
        [
          {
            id: 'main/services',
            label: 'Services',
            role: 'services',
            // submenu: []
          },
          { type: 'separator' },
          {
            id: 'main/hide',
            label: `&Hide ${app.name}`,
            accelerator: 'Command+H',
            role: 'hide',
            // click: async (event) => {
            //   self.analytics(event);
            // }
          },
          {
            id: 'main/hide-others',
            label: 'Hide &Others',
            accelerator: 'Command+Shift+H',
            role: 'hideOthers',
            // click: async (event) => {
            //   self.analytics(event);
            // }
          },
          {
            id: 'main/show-all',
            label: '&Show All',
            role: 'unhide',
            // click: async (event) => {
            //   self.analytics(event);
            // }
          },
          {
            type: 'separator',
          },
        ],

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

    // File
    {
      id: 'file',
      label: '&File',
      visible: false,
      submenu: [

      ]
    },

    // Edit
    {
      id: 'edit',
      label: '&Edit',
      submenu: [
        {
          id: 'edit/undo',
          label: '&Undo',
          accelerator: 'CommandOrControl+Z',
          role: 'undo',
        },
        {
          id: 'edit/redo',
          label: '&Redo',
          accelerator: isMac ? 'Shift+Command+Z' : 'Control+Y',
          role: 'redo',
        },
        { type: 'separator'},
        {
          id: 'edit/cut',
          label: 'Cu&t',
          accelerator: 'CommandOrControl+X',
          role: 'cut',
        },
        {
          id: 'edit/copy',
          label: '&Copy',
          accelerator: 'CommandOrControl+C',
          role: 'copy',
        },
        {
          id: 'edit/paste',
          label: '&Paste',
          accelerator: 'CommandOrControl+V',
          role: 'paste',
        },
        {
          id: 'edit/paste-and-match-style',
          label: 'Paste and &Match Style',
          accelerator: 'CommandOrControl+Shift+V',
          role: 'pasteAndMatchStyle',
        },
        {
          id: 'edit/delete',
          label: '&Delete',
          role: 'delete',
        },            
        {
          id: 'edit/select-all',
          label: 'Select &All',
          accelerator: 'CommandOrControl+A',
          role: 'selectAll',
        },
        // { type: 'separator' },
        // {
        //   label: '&Find in Page',
        //   accelerator: 'Ctrl+F',
        //   click: async () => {
        //     showMainWindow();
        //     sendCommand('tab:find');
        //   }
        // },

      ]
    },

    // View
    {
      id: 'view',
      label: '&View',
      submenu: [
        // {
        //   id: 'view/toggle-tab-bar',
        //   role: 'toggleTabBar',
        //   enabled: false,
        //   visible: false,
        // },

        // Relaunch
        !resolvedDeveloper ? null :
        [
          {
            id: 'view/reload',
            label: 'Reload',
            accelerator: 'CommandOrControl+R',
            click: async (event) => {
              const mainWindow = Manager.window().get(1);
              if (mainWindow) {
                self.analytics(event);

                Manager.window().show(mainWindow.id);
                mainWindow.browserWindow.webContents.reload();
              }
            }
          },
          { type: 'separator' },
        ],
        {
          id: 'view/toggle-fullscreen',
          label: 'Toggle Full Screen',
          accelerator: isMac ? 'Ctrl+Command+F' : 'F11',
          click: async (event) => {
            const mainWindow = Manager.window().get(1);
            if (mainWindow) {
              self.analytics(event);
              
              mainWindow.browserWindow.setFullScreen(!mainWindow.browserWindow.isFullScreen())
            }
          }
        },

        // Dev tools
        !resolvedDeveloper ? null :
        [
          {
            id: 'view/toggle-developer-tools',
            label: 'Toggle Developer Tools',
            accelerator: isMac ? 'Command+Option+I' : 'Ctrl+Shift+I',
            click: async (event) => {
              const mainWindow = Manager.window().get(1);
              if (mainWindow) {
                self.analytics(event);

                Manager.window().show(mainWindow.id);
                mainWindow.browserWindow.webContents.toggleDevTools();
              }
            }
          }
        ],
      ]
    },

    // Shortcuts
    {
      id: 'shortcuts',
      label: '&Shortcuts',
      visible: false,
      submenu: [

      ]
    },

    // Window
    {
      id: 'window',
      label: '&Window',
      submenu: [
        {
          id: 'window/minimize',
          label: 'Minimize',
          accelerator: 'CommandOrControl+M',
          role: 'minimize',
        },
        { type: 'separator' },
        {
          id: 'window/bring-all-to-front',
          label: 'Bring All to Front',
          role: 'front',
        }
      ]
    },

    // Help
    {
      id: 'help',
      label: '&Help',
      role: 'help',
      submenu: [
        {
          id: 'help/website',
          label: `${app.name} Home`,
          click: async (event) => {
            self.analytics(event);

            shell.openExternal(Manager.package.homepage);
          },
        },
        {
          id: 'help/discord',
          label: `${app.name} Support Discord`,
          click: async (event) => {
            self.analytics(event);

            shell.openExternal(`${Manager.package.homepage}/discord`);
          },
        },
      ]
    },

    // Dev
    !resolvedDeveloper ? null : {
      id: 'development',
      label: '&Development',
      submenu: [
        {
          id: 'development/open-exe-folder',
          label: 'Open exe folder',
          click: async (event) => {
            self.analytics(event);

            shell.showItemInFolder(app.getPath('exe'))
          },
        },        
        {
          id: 'development/open-user-data',
          label: 'Open user data folder',
          click: async (event) => {
            self.analytics(event);

            shell.showItemInFolder(app.getPath('userData'))
          },
        },
        {
          id: 'development/open-logs',
          label: 'Open logs folder',
          click: async (event) => {
            self.analytics(event);
            
            shell.showItemInFolder(app.getPath('logs'))
          },
        },        
      ]
    },

  ];

  self.dedupe();

  return self;
};

module.exports = Menu;
