const path = require('path');
const jetpack = require('fs-jetpack');
const MenuHelper = require('./helpers/menu.js');

function ContextMenu(Manager) {
  const self = this;
  self.Manager = Manager;

  self.initialized = false;
  self.instance = null;
  self.menuTemplate = [];
  self.generate = null;
  // self.contextMenu = null;
  self.webContents = null;
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

  self.analyticsCategory = 'context-menu'

  MenuHelper.init(self);
}

ContextMenu.prototype.init = function (options) {
  const self = this;

  return new Promise(function(resolve, reject) {
    const Manager = self.Manager;
    const { app, Menu } = Manager.libraries.remote;

    // self.contextMenu = null;
    self.webContents = Manager.webContents;

    if (!self.initialized) {
      Manager.libraries.remote.getCurrentWebContents().on('context-menu', function (event, params) {
        // self.open('main', event, params)
        self.open(event, params)
      });
    }


    self.initialized = true;
    return resolve(self);
  });
};

ContextMenu.prototype.generateDefault = function (payload) {
  const self = this;
  const Manager = self.Manager;
  const { app, Menu, shell, clipboard } = Manager.libraries.electron;

  const canSelectAll = payload.params.editFlags.canSelectAll || payload.isInputElement;
  const isLink = !!payload.params.linkURL && !payload.params.linkURL.startsWith('file:');
  const resolvedDeveloper = Manager.resolveDeveloper();

  // Auto-hide bootstrap tooltips
  try {
    $('[data-toggle="tooltip"]').tooltip('hide')
  } catch (e) {
  }

  // 6/25/2022 - This makes tooltips stuck open if you right click an element that pops up a tooltip
  // try {
  //   setTimeout(function () {
  //     (document.querySelectorAll('[data-bs-toggle="tooltip"]') || [])
  //     .forEach((el, i) => {
  //       new bootstrap.Tooltip(el).hide()
  //     });
  //   }, 1000);
  // } catch (e) {
  // }

  self.menuTemplate = [
    {
      id: 'undo',
      label: '&Undo',
      accelerator: 'CommandOrControl+Z',
      visible: payload.params.editFlags.canUndo,
      click: async (event) => {
        self.webContents.undo();
        self.analytics(event);
      }
    },
    {
      id: 'redo',
      label: '&Redo',
      accelerator: process.platform === 'darwin' ? 'Command+Shift+Z' : 'Ctrl+Y',
      visible: payload.params.editFlags.canRedo,
      click: async (event) => {
        self.webContents.redo();
        self.analytics(event);
      }
    },
    {
      type: 'separator',
    },
    {
      id: 'cut',
      label: 'Cu&t',
      accelerator: 'CommandOrControl+X',
      visible: payload.params.editFlags.canCut || payload.isInputElement,
      click: async (event) => {
        clipboard.writeText(payload.selectionText);
        self.webContents.cut();
        self.analytics(event);
      }
    },
    {
      id: 'copy',
      label: '&Copy',
      accelerator: 'CommandOrControl+C',
      visible: payload.params.editFlags.canCopy || payload.isInputElement,
      click: async (event) => {
        clipboard.writeText(payload.selectionText);
        self.webContents.copy();
        self.analytics(event);
      }
    },
    {
      id: 'paste',
      label: '&Paste',
      accelerator: 'CommandOrControl+V',
      visible: payload.params.editFlags.canPaste || payload.isInputElement,
      click: async (event) => {
        clipboard.readText();
        self.webContents.paste();
        self.analytics(event);
      }
    },
    {
      id: 'paste-and-match-style',
      label: 'Paste and &Match Style',
      accelerator: 'CommandOrControl+Shift+V',
      visible: payload.params.editFlags.canPaste || payload.isInputElement,
      click: async (event) => {
        clipboard.readText();
        self.webContents.pasteAndMatchStyle();
        self.analytics(event);
      }
    },    
    {
      type: 'separator',
    },
    {
      id: 'select-all',
      label: 'Select &All',
      accelerator: 'CommandOrControl+A',
      visible: canSelectAll,
      click: async (event) => {
        self.webContents.selectAll();
        self.analytics(event);
      }
    },
    {
      type: 'separator',
    },
    {
      id: 'copy-link',
      label: 'Copy Link Address',
      visible: isLink,
      click: async (event) => {
        clipboard.write({
          bookmark: payload.params.linkURL,
          text: payload.params.linkURL,
        });
        // clipboard.write(payload.params.linkURL);
        self.analytics(event);
      }
    },
    {
      type: 'separator',
    },
    {
      id: 'print',
      label: 'Print...',
      visible: false,
      click: async (event) => {
        self.webContents.print()
        self.analytics(event);
      }
    },
    {
      id: 'save-as-pdf',
      label: 'Save as PDF...',
      visible: false,
      click: async (event) => {
        self.webContents.printToPDF({})
        .then(data => {
          const { app, Menu } = Manager.libraries.remote;
          jetpack.writeAsync(path.join(app.getPath('downloads'), `${app.getName()}-${new Date().toISOString()}.pdf`), data)
        })
        self.analytics(event);
      }
    },
    {
      type: 'separator',
    },
    {
      id: 'inspect',
      label: 'Inspect',
      accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
      visible: resolvedDeveloper,
      enabled: resolvedDeveloper,
      click: async (event) => {
        self.webContents.inspectElement(payload.params.x, payload.params.y);

        if (self.webContents.isDevToolsOpened()) {
          self.webContents.devToolsWebContents.focus();
        }
        self.analytics(event);
      }
    },
  ];

  self.dedupe();

  return self;
}

ContextMenu.prototype.open = function (event, params) {
  const self = this;
  const Manager = self.Manager;
  const { app, Menu } = Manager.libraries.remote;

  const element = document.elementFromPoint(params.x, params.y)
  const selectionText = params.selectionText.trim();
  const isInputElement = element && element.matches('input, textarea');
  const canCutCopyOrPaste = (params.editFlags.canCut && selectionText)
    || (params.editFlags.canCopy && selectionText)
    || (params.editFlags.canPaste && isInputElement);
  const hasText = selectionText.length > 0;

  const payload = {
    event: event,
    params: params,
    element: element,
    selectionText: selectionText,
    canCutCopyOrPaste: canCutCopyOrPaste,
    isInputElement: isInputElement,
    hasText: hasText,
  }

  self.instance = null;
  self.generate = null;

  self._internal = {
    handlers: {
      onClick: () => {},
      onRightClick: () => {},
      onDoubleClick: () => {},
    }
  };

  self.generateDefault(payload);

  try {
    self.generate = require(path.join(Manager.appPath, 'electron-manager', 'context-menu.js'));
    self.generate(self, payload);
  } catch (e) {
    self.menuTemplate = [];
    console.error('Failed to build from template', e);
  }

  self.dedupe();

  self.instance = Menu.buildFromTemplate(self.menuTemplate);

  // self.instance.on('click', (event, bounds, position) => {
  //   if (self._internal.handlers.onClick(...arguments) === false) {
  //     return
  //   };
  //
  //   if (process.platform === 'win32') {
  //     const mainWindow = Manager.window().get(1);
  //     if (mainWindow) {
  //       Manager.window().toggle(mainWindow.id);
  //     } else {
  //       self.instance.popUpContextMenu()
  //     }
  //   }
  // })
  //
  // self.instance.on('right-click', (event, bounds) => {
  //   if (self._internal.handlers.onRightClick(...arguments) === false) {
  //     return
  //   };
  // })
  //
  // self.instance.on('double-click', (event, bounds) => {
  //   if (self._internal.handlers.onDoubleClick(...arguments) === false) {
  //     return
  //   };
  // })

  self.instance.on('menu-will-show', (event) => {
    Manager.analytics().event({category: self.analyticsCategory, action: 'open'})
  })

  self.instance.on('menu-will-close', (event) => {
    setTimeout(function () {
      Manager.analytics().event({category: self.analyticsCategory, action: 'close'})
    }, 1000);
  })

  self.instance.popup(self.webContents)

  return self;
};

module.exports = ContextMenu;
