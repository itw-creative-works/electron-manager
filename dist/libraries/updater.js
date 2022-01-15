let electronUpdater;
let electron;
let status = {
  status: 'not-started', // not-started, checking, error, not-available, downloading, downloaded
  percent: 0,
  error: false,
};

function Updater() {
}

Updater.update = async function (options) {
  function statusUpdate() {
    options.Manager.sendToRegisteredRenderers('updater:status', status)
  }

  if (!electronUpdater) {
    electronUpdater = options.Manager.electronUpdater || require('electron-updater');
    electronUpdater = electronUpdater.autoUpdater;

    electronUpdater.on('error', function (error) {
      status = {
        status: 'error',
        percent: 0,
        error: error
      }
      statusUpdate();
    })
    electronUpdater.on('checking-for-update', function (error) {
      status = {
        status: 'checking',
        percent: 0,
        error: false
      }
      statusUpdate();
    })
    electronUpdater.on('update-available', function (info) {
      status = {
        status: 'downloading',
        percent: 0,
        error: false
      }
      statusUpdate();
    })
    electronUpdater.on('update-not-available', function (info) {
      status = {
        status: 'not-available',
        percent: 0,
        error: false
      }
      statusUpdate();
    })
    electronUpdater.on('download-progress', function (progress) {
      // console.log('download-progress', progress);
      status = {
        status: 'downloading',
        // percent: progress.percent.toFixed(2),
        percent: progress && progress.percent && typeof progress.percent === 'number'
          ? progress.percent.toFixed(2)
          : 0,
        error: false
      }
      statusUpdate();
    })
    electronUpdater.on('update-downloaded', function (info) {
      status = {
        status: 'downloaded',
        percent: 100,
        error: false
      }
      statusUpdate();
      setTimeout(function () {
        options.Manager.allowQuit = true;
        electronUpdater.quitAndInstall();
      }, 5000);
    })
  }

  statusUpdate()

  await electronUpdater.checkForUpdates();
};


module.exports = Updater;
