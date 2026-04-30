// Build-layer tests for the gulp/tasks/mirror-downloads.js name normalization.
// We don't test the GH API path here — that's covered by the end-to-end release run.

const path = require('path');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'mirror-downloads — stableName + isUploadable',
  tests: [
    {
      name: 'mirror-downloads exports a function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(typeof mod).toBe('function');
        ctx.expect(typeof mod.stableName).toBe('function');
        ctx.expect(typeof mod.isUploadable).toBe('function');
      },
    },
    {
      name: 'isUploadable filters blockmaps + ymls',
      run: (ctx) => {
        const { isUploadable } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(isUploadable('MyApp-1.0.0.dmg')).toBe(true);
        ctx.expect(isUploadable('MyApp-1.0.0-mac.zip')).toBe(true);
        ctx.expect(isUploadable('MyApp-1.0.0.dmg.blockmap')).toBe(false);
        ctx.expect(isUploadable('latest-mac.yml')).toBe(false);
        ctx.expect(isUploadable('latest.yml')).toBe(false);
        ctx.expect(isUploadable('mac')).toBe(false);   // directory-like
      },
    },
    {
      name: 'stableName: macOS dmg variants',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(stableName('MyApp-1.0.1.dmg', 'MyApp')).toBe('MyApp-mac-x64.dmg');
        ctx.expect(stableName('MyApp-1.0.1-arm64.dmg', 'MyApp')).toBe('MyApp-mac-arm64.dmg');
      },
    },
    {
      name: 'stableName: macOS zip variants',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(stableName('MyApp-1.0.1-mac.zip', 'MyApp')).toBe('MyApp-mac-x64.zip');
        ctx.expect(stableName('MyApp-1.0.1-arm64-mac.zip', 'MyApp')).toBe('MyApp-mac-arm64.zip');
      },
    },
    {
      name: 'stableName: windows installer',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(stableName('MyApp-Setup-1.0.1.exe', 'MyApp')).toBe('MyApp-win-x64.exe');
        ctx.expect(stableName('MyApp-1.0.1-arm64.exe', 'MyApp')).toBe('MyApp-win-arm64.exe');
      },
    },
    {
      name: 'stableName: linux variants',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(stableName('MyApp-1.0.1.AppImage', 'MyApp')).toBe('MyApp-linux-x64.appimage');
        ctx.expect(stableName('MyApp-1.0.1-arm64.AppImage', 'MyApp')).toBe('MyApp-linux-arm64.appimage');
        ctx.expect(stableName('MyApp_1.0.1_amd64.deb', 'MyApp')).toBe('MyApp-linux-x64.deb');
      },
    },
    {
      name: 'stableName: returns null for unknown extension',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(stableName('MyApp-1.0.1.unknown', 'MyApp')).toBe(null);
        ctx.expect(stableName('latest-mac.yml', 'MyApp')).toBe(null);
      },
    },
    {
      name: 'stableName: sanitizes product name (spaces, weird chars)',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(stableName('MyApp-1.0.1.dmg', 'My App!')).toBe('MyApp-mac-x64.dmg');
      },
    },
  ],
};
