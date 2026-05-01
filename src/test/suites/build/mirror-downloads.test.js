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
      name: 'stableName: macOS dmg — x64 keeps legacy URL, arm64 gets suffix',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        // Legacy URL for x64: `Somiibo.dmg` (no platform/arch in name).
        ctx.expect(stableName('Somiibo-1.0.1.dmg', 'Somiibo')).toBe('Somiibo.dmg');
        ctx.expect(stableName('Somiibo-1.0.1-arm64.dmg', 'Somiibo')).toBe('Somiibo-arm64.dmg');
      },
    },
    {
      name: 'stableName: macOS auto-updater zip',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        // Always include `mac` in zip name (disambiguates from any future Windows zip target).
        ctx.expect(stableName('Somiibo-1.0.1-mac.zip', 'Somiibo')).toBe('Somiibo-mac.zip');
        ctx.expect(stableName('Somiibo-1.0.1-arm64-mac.zip', 'Somiibo')).toBe('Somiibo-mac-arm64.zip');
      },
    },
    {
      name: 'stableName: windows installer keeps legacy `-Setup.exe` form',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        // Legacy URL: Somiibo-Setup.exe.
        ctx.expect(stableName('Somiibo-Setup-1.0.1.exe', 'Somiibo')).toBe('Somiibo-Setup.exe');
        ctx.expect(stableName('Somiibo-1.0.1.exe', 'Somiibo')).toBe('Somiibo-Setup.exe');
        ctx.expect(stableName('Somiibo-1.0.1-arm64.exe', 'Somiibo')).toBe('Somiibo-Setup-arm64.exe');
      },
    },
    {
      name: 'stableName: linux deb uses legacy `lowercase_arch.deb` convention',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        // Legacy URL: somiibo_amd64.deb (lowercase product, debian arch naming).
        ctx.expect(stableName('Somiibo_1.0.1_amd64.deb', 'Somiibo')).toBe('somiibo_amd64.deb');
      },
    },
    {
      name: 'stableName: linux AppImage keeps `Product.AppImage` form (case preserved)',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        ctx.expect(stableName('Somiibo-1.0.1.AppImage', 'Somiibo')).toBe('Somiibo.AppImage');
        ctx.expect(stableName('Somiibo-1.0.1-arm64.AppImage', 'Somiibo')).toBe('Somiibo-arm64.AppImage');
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
      name: 'stableName: sanitizes product name (spaces → hyphens, weird chars stripped)',
      run: (ctx) => {
        const { stableName } = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'mirror-downloads.js'));
        // Multi-word product names → hyphenated stable names. "My App!" → "My-App".
        ctx.expect(stableName('MyApp-1.0.1.dmg', 'My App!')).toBe('My-App.dmg');
        // Real example from deployment-playground.
        ctx.expect(stableName('Deployment Playground-1.0.1.dmg', 'Deployment Playground')).toBe('Deployment-Playground.dmg');
        ctx.expect(stableName('Deployment Playground-Setup-1.0.1.exe', 'Deployment Playground')).toBe('Deployment-Playground-Setup.exe');
        ctx.expect(stableName('Deployment Playground-1.0.1.AppImage', 'Deployment Playground')).toBe('Deployment-Playground.AppImage');
        // .deb uses lowercase product name + underscores per Debian convention.
        ctx.expect(stableName('deployment-playground_1.0.1_amd64.deb', 'Deployment Playground')).toBe('deployment-playground_amd64.deb');
      },
    },
  ],
};
