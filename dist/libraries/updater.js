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

  if (!self.initialized) {
    // Setup library
    Manager.libraries.electronUpdater = Manager.libraries.electronUpdater || require('electron-updater');
    self.library = Manager.libraries.electronUpdater.autoUpdater;

    // Setup events
    self.library.on('error', function (e) {
      if (!(e instanceof Error)) {
        e = new Error('Unknown update error');
      }
      self.status = {
        code: 'error',
        percent: 0,
        error: e,
        version: Manager.package.version,
      }
      self.sendStatus();
    })

    self.library.on('checking-for-update', function () {
      self.status = {
        code: 'checking',
        percent: 0,
        error: null,
        version: Manager.package.version,
      }
      self.sendStatus();
    })

    self.library.on('update-available', function (info) {
      self.status = {
        code: 'downloading',
        percent: 0,
        error: null,
        version: info.version,
      }
      self.sentInitialProgressUpdate = false;
      self.sendStatus();
    })

    self.library.on('update-not-available', function (info) {
      self.status = {
        code: 'not-available',
        percent: 0,
        error: null,
        version: info.version,
      }
      self.sendStatus();
    })

    self.library.on('download-progress', function (progress) {
      // console.log('download-progress', progress);
      let percent = 0;
      if (progress && progress.percent && typeof progress.percent === 'number') {
        percent = parseFloat(progress.percent.toFixed(2)) || 0;
      }

      percent = Math.min(100, percent);

      self.status = {
        code: 'downloading',
        percent: percent,
        error: null,
        version: Manager.package.version,
      }
      self.sendStatus();
    })
    
    self.library.on('update-downloaded', function (info) {
      self.status = {
        code: 'downloaded',
        percent: 100,
        error: null,
        version: info.version,
      }
      self.sendStatus();
    })

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

    self.initialized = true;
  }

  return self;
}

Updater.prototype.isReadyToCheck = function () {
  const self = this;
  return ['not-started', 'error', 'not-available', 'downloaded'].includes(self.status.code)
}

Updater.prototype.update = async function (options) {
  const self = this;
  const Manager = self.Manager;

  options = options || {};
  options.userAction = typeof options.userAction === 'undefined' ? false : options.userAction;

  Manager.log(`Update check: ${self.status.code}`);

  if (!self.initialized) {
    self.init();
  }

  self.lastUpdateWasUserAction = options.userAction;

  self.sendStatus();

  if (self.isReadyToCheck()) {
    await self.library.checkForUpdates()
    .then(r => {
      if (Manager.isDevelopment) {
        self._simulateDevDownload();
      }
    })
    .catch(e => {
      self.status = {
        code: 'error',
        percent: 0,
        error: e,
        version: Manager.package.version,
      }
      self.sendStatus();
      Manager.log('checkForUpdates()', e);
    })
  } else {
    Manager.log(`Skipping new update check because status is: ${self.status.code}`);
  }

  return self;
};

Updater.prototype.sendStatus = async function () {
  const self = this;
  const Manager = self.Manager;

  try {
    if (Manager.libraries.appMenu.initialized) {
      Manager.libraries.appMenu.init();
    }
  } catch (e) {
    console.error('Failed to set new tray status', e);
  }

  Manager.sendToRegisteredRenderers('updater:status', self.status);
  Manager.log(`[Updater] status`, self.status)

  // self.status = {
  //   code: 'error',
  //   error: new Error('Help error nlow lol'),
  // }

  if (self.lastUpdateWasUserAction) {
    const { dialog, BrowserWindow } = Manager.libraries.electron;
    let bw;

    try {
      bw = Manager.window().get('main').browserWindow || BrowserWindow.getFocusedWindow();
    } catch (e) {
      console.error('Could not get browser window');
    }

    if (self.status.code === 'downloading') {
      if (!self.sentInitialProgressUpdate) {
        self.sentInitialProgressUpdate = true;
        dialog.showMessageBox(bw, {
          message: `Downloading v${self.status.version} now!`,
          type: 'info'
        })
        .then((result) => {

        })        
      }
    } else if (self.status.code === 'downloaded') {
      self.lastUpdateWasUserAction = false;

      // Relaunch in 60 seconds
      self.relaunchTimeout = setTimeout(function () {
        Manager.relaunch({force: true})
      }, 60000);

      // Show dialog
      dialog.showMessageBox(bw, {
        message: `Update v${self.status.version} has been downloaded. Would you like to use it now?`,
        buttons: ['Cancel', 'Install'],
        type: 'question'
      })
      .then((result) => {
        clearTimeout(self.relaunchTimeout);

        if (result.response === 1) {
          Manager.relaunch({force: true})
        }
      })
    } else if (self.status.code === 'not-available') {
      dialog.showMessageBox(bw, {
        title: `No update necessary`,
        message: `You are already using v${Manager.package.version}, which is the latest version!`,
        // buttons: ['Cancel', 'Install'],
        type: 'info'
      })
      .then((result) => {
        // console.log('---result 2', result);
      })
      self.lastUpdateWasUserAction = false;
    } else if (self.status.code === 'error') {
      dialog.showMessageBox(bw, {
        title: `Update check failed`,
        message: `Failed to check for update. Please re-install the app. \n\nError: ${self.status.error.message}`,
        // buttons: ['Cancel', 'Install'],
        type: 'error'
      })
      .then((result) => {
        // Open in browser
        Manager.libraries.electron.shell.openExternal(Manager.package.homepage + '/download');
      })
      self.lastUpdateWasUserAction = false;
    }

    // Set progress
    try {
      bw.setProgressBar(self.status.percent / 100);
    } catch (e) {
      console.error(`Failed to set progress bar`, e);
    }

  } else {
    if (self.status.code === 'downloaded') {
      clearTimeout(self.relaunchTimeout);
      self.relaunchTimeout = setTimeout(function () {
        Manager.relaunch({force: true})
      }, 5000);       
    }   
  }

  return self;
};

Updater.prototype._simulateDevDownload = async function () {
  const self = this;
  const Manager = self.Manager;
  const powertools = require('node-powertools');
  const status = Manager.storage.electronManager.get('data.current.argv.devUpdateStatus') || 'available'; // available, unavailable, error
  const NEW_VERSION = '999.0.0';

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


module.exports = Updater;
