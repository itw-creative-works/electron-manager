// Context-menu definition. Called by electron-manager EVERY time the user right-clicks.
//
// `manager`     — the running EM Manager.
// `menu`        — builder API: item(descriptor), separator(), submenu(label, items).
// `params`      — Electron's context-menu params (selectionText, isEditable, linkURL,
//                 srcURL, mediaType, editFlags, x, y, etc.). Use these to vary the menu.
// `webContents` — the webContents that fired the event.
//
// Building no items (calling no menu.* methods) suppresses the popup entirely.

module.exports = ({ manager, menu, params }) => {
  // Editable fields (inputs, textareas) — full edit menu.
  if (params.isEditable) {
    menu.item({ role: 'cut',   enabled: params.editFlags?.canCut !== false });
    menu.item({ role: 'copy',  enabled: params.editFlags?.canCopy !== false });
    menu.item({ role: 'paste', enabled: params.editFlags?.canPaste !== false });
  } else if (params.selectionText) {
    // Plain text selection — copy only.
    menu.item({ role: 'copy' });
  }

  // Links — open / copy address.
  if (params.linkURL) {
    if (params.isEditable || params.selectionText) menu.separator();
    menu.item({
      label: 'Open Link in Browser',
      click: () => {
        const { shell } = require('electron');
        shell.openExternal(params.linkURL);
      },
    });
    menu.item({
      label: 'Copy Link Address',
      click: () => {
        const { clipboard } = require('electron');
        clipboard.writeText(params.linkURL);
      },
    });
  }

  // Dev-only: Inspect Element.
  if (manager.isDevelopment()) {
    menu.separator();
    menu.item({ role: 'inspectElement' });
    menu.item({ role: 'toggleDevTools' });
  }
};
