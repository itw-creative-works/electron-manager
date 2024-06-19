const path = require('path');
const { ipcRenderer } = require('electron');

// Wait for loaded
function _ready() {
  const img = document.getElementById('preloader-icon');

  ipcRenderer.invoke('electron-manager-message', {
    command: 'app:get-app-path',
  })
  .then((result) => {
    img.src = path.join(result, '/electron-manager/_generated/icons/logo.svg');
  })
}

if (
  ['interactive', 'complete'].includes(document.readyState)
) {
  _ready();
} else {
  document.addEventListener('DOMContentLoaded', function () {
    _ready()
  });
}
