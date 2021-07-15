<p align="center">
  <a href="https://cdn.itwcreativeworks.com/assets/itw-creative-works/images/logo/itw-creative-works-brandmark-black-x.svg">
    <img src="https://cdn.itwcreativeworks.com/assets/itw-creative-works/images/logo/itw-creative-works-brandmark-black-x.svg">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/itw-creative-works/electron-manager.svg">
  <br>
  <img src="https://img.shields.io/david/itw-creative-works/electron-manager.svg">
  <img src="https://img.shields.io/david/dev/itw-creative-works/electron-manager.svg">
  <img src="https://img.shields.io/bundlephobia/min/electron-manager.svg">
  <img src="https://img.shields.io/codeclimate/maintainability-percentage/itw-creative-works/electron-manager.svg">
  <img src="https://img.shields.io/npm/dm/electron-manager.svg">
  <img src="https://img.shields.io/node/v/electron-manager.svg">
  <img src="https://img.shields.io/website/https/itwcreativeworks.com.svg">
  <img src="https://img.shields.io/github/license/itw-creative-works/electron-manager.svg">
  <img src="https://img.shields.io/github/contributors/itw-creative-works/electron-manager.svg">
  <img src="https://img.shields.io/github/last-commit/itw-creative-works/electron-manager.svg">
  <br>
  <br>
  <a href="https://itwcreativeworks.com">Site</a> | <a href="https://www.npmjs.com/package/electron-manager">NPM Module</a> | <a href="https://github.com/itw-creative-works/electron-manager">GitHub Repo</a>
  <br>
  <br>
  <strong>Electron Manager</strong> is an NPM module for Electron developers with tools, helper functions, and utilities for building a flawless Electron app 🚀
</p>

## Install
Install with npm:
```shell
npm install electron-manager
```
**Note**: This module requires a peer dependency of Electron. The required version can be found in the package.json.

## Features
* Correctly handles a **ton** of things that Electron falls short on in cross-platform cases like: `setAsDefaultProtocolClient`, `getApplicationNameForProtocol`, `isDefaultProtocolClient`, and more
* Provides a simple cross-platform method to set your app to **auto launch** at startup (Includes Windows Store and some Linux distros)
* Provides an easy cross-platform method to set your app as the **default browser**

## Example Setup
After installing via npm, simply `require` the library and begin enjoying this simple tool 🧰.
```js
// In your main.js file
const Manager = new (require('electron-manager'))({
  appName: 'Electron',
  appId: 'electron',
})
```
### Options
  * `appName`: This should be the name of your app and what end users would see, such as `Electron.`
    * The `appName` is used to get/set things on **Windows** so it should be whatever your `Applications\\*.exe` file's name is.
  * `appId`: This should be the id of your app such as `electron.`
    * The `appId` is used to get/set protocols on **Linux** so it should be whatever your `*.desktop` file's name.

### Properties
  * `environment`: Can be either `development` or `production` (uses `electron-is-dev`).
  * `isLinux`: Will be true if your app is running on **Linux**.
  * `isSnap`: Will be true if your app is running as a **Linux Snap** (uses `electron-is-snap`).
  * `storeName`: Can be either `mac`, `windows`, `snap`, or `none`.

## .app() Library
This library practically replaces some methods of Electron's `app` API. You don't need to use these and the original APIs as these methods can replace the existing ones.

### .app().setAsDefaultProtocolClient(protocol, options)
Correctly sets your app as the default handler for a `protocol`. Calls `xdg-mime default` and `xdg-settings set` under the hood which Electron fails to do for **Linux**.
```js
await Manager.app().setAsDefaultProtocolClient('electron');

// Output: null (for now)
```

### .app().getApplicationNameForProtocol(protocol)
Correctly gets the app name that handles a `protocol`. Protocol must include `://` just like normal. Calls `xdg-settings get default-url-scheme-handler` under the hood which Electron fails to do for **Linux**.
```js
await Manager.app().getApplicationNameForProtocol('electron');

// Output: String
```

### .app().isDefaultProtocolClient(protocol, options)
Correctly checks whether your app is the default handler for a `protocol`. Calls `xdg-settings get default-url-scheme-handler` under the hood which Electron fails to do for **Linux**.
```js
await Manager.app().isDefaultProtocolClient('electron');

// Output: Boolean
```

### .app().setLoginItemSettings(options)
This is how you get an **auto-launching** app!. Automatically adds a super helpful flag: `--was-opened-at-login="true"`.

The only distros this doesn't seem to work on are **MAS** and **Linux Snap**. RIP.
```js
await Manager.app().setLoginItemSettings({
  openAtLogin: true,
});

// Output: null (for now)
```

### .app().setAsDefaultBrowser(options)
Correctly sets your app as a default browser for every platform. Yes, even on **Windows**!.
```js
await Manager.app().setAsDefaultBrowser();

// Output: null (for now)
```

**Note**: If you want to do this on Windows, you need to somehow distribute a helper executable called [SetUserFTA](http://kolbi.cz/blog/2017/10/25/setuserfta-userchoice-hash-defeated-set-file-type-associations-per-user/) and then supply the path to this in the option `setUserFTAPath`. This option has no effect on other platforms since other platforms work more easily.

```js
const { app } = require('electron');
const path = require('path');
const appDataPath = path.resolve(app.getPath('appData'), 'set-user-fta.exe')
await Manager.app().setAsDefaultBrowser({
  setUserFTAPath: appDataPath,
});

// Output: null (for now)
```

### .app().isDefaultBrowser(options)
Correctly returns whether your app is the default browser on any platform.
```js
await Manager.app().isDefaultBrowser();

// Output: Boolean
```

### .app().wasOpenedAtLogin(options)
Correctly returns whether your app was opened at login. Remember that `--was-opened-at-login="true"` flag we set earlier when we called `await Manager.app().setLoginItemSettings()`? Wow this is so **easy**!.
```js
await Manager.app().wasOpenedAtLogin();

// Output: Boolean
```

**Note**: Before you get your hopes *too* high, there's **no way** to set or get the `--was-opened-at-login="true"` flag on **Linux** or **Windows Store** yet. To compensate, this method will check to see if the app was opened within `120` seconds of the OS booting up or the user logging in. Thus, it's best to call this as early as possible in your app.

It's by no means a perfect solution but it will work 90% of the time. You can change the `threshold` to whatever seconds you want:

```js
await Manager.app().wasOpenedAtLogin({
  threshold: 60, // Don't go too low (most people have slow-ass computers)
});

// Output: Boolean
```

## Other libraries and features
This is just the beginning. More great features and fixes will be coming soon

## Final Words
If you are still having difficulty, we would love for you to post a question to [the Electron is Snap issues page](https://github.com/itw-creative-works/electron-manager/issues). It is much easier to answer questions that include your code and relevant files! So if you can provide them, we'd be extremely grateful (and more likely to help you find the answer!)

## Projects Using this Library
[Somiibo](https://somiibo.com/): A Social Media Bot with an open-source module library. <br>
[JekyllUp](https://jekyllup.com/): A website devoted to sharing the best Jekyll themes. <br>
[Slapform](https://slapform.com/): A backend processor for your HTML forms on static sites. <br>
[Sniips](https://sniips.com/): A modern, hackable snippet manager <br>
[Proxifly](https://proxifly.com/): An API to get free proxies for your services. <br>
[Optiic](https://optiic.dev/): A free OCR image processing API. <br>
[SoundGrail Music App](https://app.soundgrail.com/): A resource for producers, musicians, and DJs. <br>

Ask us to have your project listed! :)

## Other Great Libraries
[node-powertools](https://www.npmjs.com/package/node-powertools): An NPM module for backend and frontend developers that exposes powerful utilities and tools. <br>
[electron-is-snap](https://www.npmjs.com/package/electron-is-snap): An NPM module for checking if your app is running in a snap environment <br>
[optiic](https://www.npmjs.com/package/optiic): An OCR image processing API. <br>
[proxifly](https://www.npmjs.com/package/proxifly): An API to find proxies for your apps. <br>
[slapform](https://www.npmjs.com/package/slapform): A form backend API. <br>
