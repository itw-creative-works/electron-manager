const path = require('path');

function Updater(Manager) {
  const self = this;
  self.Manager = Manager;
  self.status = {
    code: 'not-started', // not-started, checking, error, not-available, downloading, downloaded
    percent: 0,
    error: null,
    version: Manager.package.version,
  };
  self.initialized = false;
  self.library = null;
  self.relaunchTimeout = null;
  self.lastUpdateWasUserAction = false;
  self.sentInitialProgressUpdate = false;
}

Updater.prototype.init = async function () {
  const self = this;
  const Manager = self.Manager;

  // Check if already initialized
  if (self.initialized) {
    return self;
  }

  // Setup library
  Manager.libraries.electronUpdater = Manager.libraries.electronUpdater || require('electron-updater');
  self.library = Manager.libraries.electronUpdater.autoUpdater;

  // Shortcuts
  const version = Manager.package.version;

  /*
    Setup events
  */
  // Event: error
  self.library.on('error', function (e) {
    // Ensure error is an instance of Error
    if (!(e instanceof Error)) {
      e = new Error('Unknown update error');
    }

    // Set status
    self.status = {
      code: 'error',
      percent: 0,
      error: e,
      version: version,
    }

    // Send status
    self.sendStatus();
  })

  // Event: checking-for-update
  self.library.on('checking-for-update', function () {
    // Set status
    self.status = {
      code: 'checking',
      percent: 0,
      error: null,
      version: version,
    }

    // Send status
    self.sendStatus();
  })

  // Event: update-available
  self.library.on('update-available', function (info) {
    // Set status
    self.status = {
      code: 'downloading',
      percent: 0,
      error: null,
      version: info.version,
    }

    // Set initial progress update
    self.sentInitialProgressUpdate = false;

    // Send status
    self.sendStatus();
  })

  // Event: update-not-available
  self.library.on('update-not-available', function (info) {
    // Set status
    self.status = {
      code: 'not-available',
      percent: 0,
      error: null,
      version: info.version,
    }

    // Send status
    self.sendStatus();
  })

  // Event: download-progress
  self.library.on('download-progress', function (progress) {
    // Format percent
    let percent = 0;
    if (progress && progress.percent && typeof progress.percent === 'number') {
      percent = parseFloat(progress.percent.toFixed(2)) || 0;
    }

    // Ensure percent is capped at 100
    percent = Math.min(100, percent);

    // Set status
    self.status = {
      code: 'downloading',
      percent: percent,
      error: null,
      version: version,
    }

    // Send status
    self.sendStatus();
  })

  // Event: update-downloaded
  self.library.on('update-downloaded', function (info) {
    // Set status
    self.status = {
      code: 'downloaded',
      percent: 100,
      error: null,
      version: info.version,
    }

    // Send status
    self.sendStatus();
  })

  // Handle dev mode custom flow
  if (Manager.isDevelopment) {
    const status = Manager.storage.electronManager.get('data.current.argv.devUpdateStatus') || 'available'; // available, unavailable, error
    let newPath = '';
    if (['available', 'unavailable', 'error'].includes(status)) {
      newPath = path.join(__dirname, '../electron-updater', `dev-app-update-${status}.yml`);
    }
    self.library.updateConfigPath = newPath;
    self.library._appUpdateConfigPath = newPath;
    self.library.autoDownload = false;
    console.log('Setting fake update path', newPath);
  }

  // Set initialized
  self.initialized = true;

  // Return
  return self;
}

Updater.prototype.isReadyToCheck = function () {
  const self = this;
  return ['not-started', 'error', 'not-available', 'downloaded'].includes(self.status.code)
}

Updater.prototype.update = async function (options) {
  const self = this;
  const Manager = self.Manager;

  // Set options
  options = options || {};
  options.userAction = typeof options.userAction === 'undefined' ? false : options.userAction;

  // Log
  Manager.log(`Update check: ${self.status.code}`);

  // Initialize if not already
  if (!self.initialized) {
    self.init();
  }

  // Set last update action
  self.lastUpdateWasUserAction = options.userAction;

  // Send status
  self.sendStatus();

  // If not ready to check, return
  if (!self.isReadyToCheck()) {
    Manager.log(`Skipping new update check because status is: ${self.status.code}`);

    return self;
  }

  // Check for updates
  await self.library.checkForUpdates()
  .then((r) => {
    if (Manager.isDevelopment) {
      self._simulateDevDownload();
    }
  })
  .catch((e) => {
    // Set status
    self.status = {
      code: 'error',
      percent: 0,
      error: e,
      version: Manager.package.version,
    }

    // Send status
    self.sendStatus();

    // Log
    Manager.log('checkForUpdates()', e);
  })
};

Updater.prototype.sendStatus = async function () {
  // Shortcuts
  const self = this;
  const Manager = self.Manager;

  // Try to set menu
  try {
    if (Manager.libraries.appMenu.initialized) {
      Manager.libraries.appMenu.init();
    }
  } catch (e) {
    console.error('Failed to set new tray status', e);
  }

  // Send to renderers
  Manager.sendToRegisteredRenderers('updater:status', self.status);

  // Log
  Manager.log(`[Updater] status`, self.status)

  // If update was initiated by user, show dialog
  if (self.lastUpdateWasUserAction) {
    // Handle status
    if (self.status.code === 'downloading') {
      if (!self.sentInitialProgressUpdate) {
        // Set initial progress update
        self.sentInitialProgressUpdate = true;

        // Show dialog
        self._showDialog({
          message: `Downloading v${self.status.version} now!`,
          type: 'info'
        })
      }
    } else if (self.status.code === 'downloaded') {
      // Set last update action
      self.lastUpdateWasUserAction = false;

      // Relaunch in 60 seconds
      self.relaunchTimeout = setTimeout(function () {
        Manager.relaunch({force: true})
      }, 60000);

      // Show dialog
      self._showDialog({
        message: `Update v${self.status.version} has been downloaded. Would you like to use it now?`,
        buttons: ['Cancel', 'Install'],
        type: 'question'
      })
      .then((result) => {
        clearTimeout(self.relaunchTimeout);

        // Relaunch
        if (result.response === 1) {
          Manager.relaunch({force: true})
        }
      })
    } else if (self.status.code === 'not-available') {
      // Set last update action
      self.lastUpdateWasUserAction = false;

      // Show dialog
      self._showDialog({
        title: `No update necessary`,
        message: `You are already using v${Manager.package.version}, which is the latest version!`,
        // buttons: ['Cancel', 'Install'],
        type: 'info'
      })
    } else if (self.status.code === 'error') {
      // Set last update action
      self.lastUpdateWasUserAction = false;

      // Show dialog
      self._showDialog({
        title: `Update check failed`,
        message: `Failed to check for update. Please re-install the app. \n\nError: ${self.status.error.message}`,
        // buttons: ['Cancel', 'Install'],
        type: 'error'
      })
      .then((result) => {
        // Open in browser
        Manager.libraries.electron.shell.openExternal(`${Manager.package.homepage}/download?error=${encodeURIComponent(self.status.error.message)}`);
      })
    }

    // Handle progress bar
    self._handleProgressBar();

  // If update was not initiated by user, relaunch automatically
  } else {
    // Handle download completion
    if (self.status.code === 'downloaded') {
      // Clear timeout
      clearTimeout(self.relaunchTimeout);

      // Relaunch in 5 seconds
      self.relaunchTimeout = setTimeout(function () {
        Manager.relaunch({force: true})
      }, 5000);
    }
  }

  // Return
  return self;
};

Updater.prototype._simulateDevDownload = async function () {
  // Shortcuts
  const self = this;
  const Manager = self.Manager;

  // Libraries
  const powertools = require('node-powertools');

  // Get status
  const status = Manager.storage.electronManager.get('data.current.argv.devUpdateStatus') || 'available'; // available, unavailable, error
  const NEW_VERSION = '999.0.0';

  // If different than not-started, return
  if (self.status.code !== 'not-started') {
    return;
  }

  await powertools.wait(1000);

  self.library.emit('checking-for-update')

  await powertools.wait(1000);

  if (status === 'available') {
    self.library.emit('update-available', {
      version: NEW_VERSION,
    })

    await powertools.wait(1000);
  } else {
    if (status === 'unavailable') {
      self.library.emit('update-not-available', {
        version: Manager.package.version,
      })
    } else if (status === 'error') {
      self.library.emit('error', new Error('Simulated error'));
    }

    await powertools.wait(1000);

    self.library.emit('not-started', {});

    return
  }

  const progressInterval = setInterval(function () {
    if (self.status.percent >= 100) {
      self.library.emit('update-downloaded', {
        version: NEW_VERSION,
      })

      return clearInterval(progressInterval);
    }

    self.library.emit('download-progress', {
      percent: Math.min(100, self.status.percent + (Math.random() * 20)),
    })
  }, 1000);

}

Updater.prototype._getUsableBrowserWindow = function (options) {
  // Shortcuts
  const self = this;
  const Manager = self.Manager;

  // Libraries
  const { BrowserWindow } = require('electron');

  // Get browser window
  try {
    return Manager.window().get('main').browserWindow || BrowserWindow.getFocusedWindow();
  } catch (e) {
    console.error('Could not get browser window', e);

    // Return null
    return null;
  }
};

Updater.prototype._showDialog = function (options) {
  // Shortcuts
  const self = this;
  const Manager = self.Manager;

  // Libraries
  const { dialog } = require('electron');
  const bw = self._getUsableBrowserWindow();

  // Show dialog
  return dialog.showMessageBox(bw, options);
};

Updater.prototype._handleProgressBar = function () {
  // Shortcuts
  const self = this;
  const Manager = self.Manager;

  // Libraries
  const bw = self._getUsableBrowserWindow();

  // Set progress
  try {
    const double = self.status.percent / 100;

    // Set progress bar
    // -1 disables the progress bar
    bw.setProgressBar(double <= 0 || double >= 1 ? -1 : double);
  } catch (e) {
    console.error(`Failed to set progress bar`, e);
  }
};

module.exports = Updater;
