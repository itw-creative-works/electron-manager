let Manager = new (require('electron-manager'));

let Manager = new (require('electron').remote.require('electron-manager'))({
  appName: 'Somiibo',
  appId: 'somiibo',

  electron: require('electron').remote,
})


console.log(await Manager.app().getApplicationNameForProtocol('somiibo'));
console.log(await Manager.app().getApplicationNameForProtocol('http'));
console.log(await Manager.app().getApplicationNameForProtocol('https'));

console.log(await Manager.app().isDefaultProtocolClient('somiibo'));
console.log(await Manager.app().isDefaultProtocolClient('http'));
console.log(await Manager.app().isDefaultProtocolClient('https'));

console.log(await Manager.app().setAsDefaultProtocolClient('somiibo'));
console.log(await Manager.app().setAsDefaultProtocolClient('http'));
console.log(await Manager.app().setAsDefaultProtocolClient('https'));

console.log(await Manager.app().setLoginItemSettings({
  openAtLogin: true
}));

console.log(await Manager.app().setAsDefaultBrowser({
  setUserFTAPath: `${Renderer.Global.addresses.assets}/data/resources/binary/${Renderer.Global.resources.main.resources.binary.SetUserFTA.url}`
}));


console.log(await Manager.app().isDefaultBrowser());

console.log(await Manager.app().wasOpenedAtLogin());
