const path = require('path');
const jetpack = require('fs-jetpack');
const puppeteer = require('puppeteer');
const os = require('os');
const username = os.userInfo().username;
const platform = os.platform();

const USER_DATA = {
  darwin: `/Users/${username}/Library/Application\ Support/Google/Chrome`,
  linux: `/home/${username}/.config/google-chrome`,
  win32: `C:\\Users\\${username}\\AppData\\Local\\Google\\Chrome\\User\ Data`
}
const EXE_PATH = {
  darwin: '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
}
// const excludeList = [
//   'lockfile',
//   'LOCK',
//   'SingletonLock',
//   'SingletonCookie',
//   'SingletonSocket',
//   'SingletonSyncStarter',
//   './Profile 1/*',
//   './Profile 2/*',
//   './Profile 3/*',
//   '/Profile 1/*',
//   '/Profile 2/*',
//   '/Profile 3/*',
//   'Profile 1/*',
//   'Profile 2/*',
//   'Profile 3/*',
//   './**/Profile 1/*',
//   './**/Profile 2/*',
//   './**/Profile 3/*',
//   // '**/Profile ?',
//   // '**/Profile ??',
//   // '**Profile ?',
//   // '**Profile ??',
//   // 'Profile ?',
//   // 'Profile ??',
// ];
// const includeList = [
//   '*',
//   // 'Default',
//   // 'Cookies',
//   // 'Bookmarks',
//   // 'Affiliation Database',
// ];

const matching = [
  // Include
  '*',
  // Exclude
  '!lockfile',
  '!LOCK',
  '!SingletonLock',
  '!SingletonCookie',
  '!SingletonSocket',
  '!SingletonSyncStarter',
  "!Profile ?/**/*",
  "!Profile ??/**/*",
]

function Puppeteer(Manager) {
  const self = this;

  self.initialized = false;

  self.Manager = Manager;
}

Puppeteer.prototype.init = function () {
  const self = this;
  const Manager = self.Manager;
  const data = Manager.storage.electronManager.get('data.current');

  return new Promise(async function(resolve, reject) {

    if (self.initialized) {
      return resolve();
    }

    const workingDataBaseDir = USER_DATA[platform];
    const workingDataBaseNewDir = `${workingDataBaseDir}_`;
    const workingExePath = EXE_PATH[platform];

    console.log('[Puppeteer] Deleting Chrome User Data dir...');

    // Remove the destination directory
    jetpack.remove(workingDataBaseNewDir);

    console.log('[Puppeteer] Copying Chrome User Data dir...');

    // Create an empty destination directory
    jetpack.dir(workingDataBaseNewDir);

    // Copy the profile
    jetpack.copy(workingDataBaseDir, workingDataBaseNewDir, {
      overwrite: true,
      // matching: ['*', ...excludeList.map(item => `!${item}`)],
      // matching: includeList.concat(excludeList.map(item => `!${item}`)),
      matching: matching,
    });

    console.log(`[Puppeteer] Opening browser...`);
    console.log(`[Puppeteer] Working User Data dir: ${workingDataBaseDir}`);
    console.log(`[Puppeteer] Working New User Data dir: ${workingDataBaseNewDir}`);
    console.log(`[Puppeteer] Executable path: ${workingExePath}`);

    // https://stackoverflow.com/questions/59514049/unable-to-sign-into-google-with-selenium-automation-because-of-this-browser-or
    // https://www.reddit.com/r/puppeteer/comments/pc93sn/google_says_this_browser_or_app_may_not_be_secure/
    // https://www.reddit.com/r/webscraping/comments/11rzcz9/browser_automation_to_log_into_google_with/
    // https://www.reddit.com/r/node/comments/gw0chw/gmail_login_using_puppeteer/
    // https://www.reddit.com/r/AskProgramming/comments/okp7q4/how_to_really_fix_couldnt_sign_you_in_this/
    // https://github.com/puppeteer/puppeteer/issues/6832
    // https://marian-caikovski.medium.com/automatically-sign-in-with-google-using-puppeteer-cc2cc656da1c
    // https://stackoverflow.com/questions/55096771/connecting-browsers-in-puppeteer
    self.browser = await puppeteer.launch({
      // headless: true,
      headless: false,
      executablePath: workingExePath, // supply the user-specific path here
      defaultViewport: {
        width: 1280,
        height: 720
      },
      userDataDir: workingDataBaseNewDir, // supply the user-specific path here

      args: [
        '--mute-audio', // this mutes the entire browser, not just one tab
        // '--disable-features=ImprovedCookieControls', // disable the new cookie controls feature
        // '--no-sandbox', // required to run without privileges in Linux
        // '--disable-setuid-sandbox', // disable the setuid sandbox (Linux only)
        '--profile-directory=Default',
        // '--disable-web-security',
        // '--allow-running-insecure-content'
      ],
      ignoreDefaultArgs: [
        '--enable-automation',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-component-extensions-with-background-pages',
        '--allow-pre-commit-input',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-dev-shm-usage',
        '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--enable-blink-features=IdleDetection',
        '--enable-features=NetworkServiceInProcess2',
        '--export-tagged-pdf',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--password-store=basic',
        '--use-mock-keychain',
      ],
    });

    // WARNING: window.navigator.webdriver will be true


    // Test
    // const page = await self.browser.newPage();

    // await page.goto('https://somiibo.com', { waitUntil: 'domcontentloaded' });

    // // Make sure the page is loaded by waiting for the play button to appear
    // // Please note the selector might change as per Spotify's page updates
    // await page.waitForSelector('*', {
    //   visible: true
    // });
    // await page.evaluate(() => {
    //   const btn = document.querySelector('a');
    //   btn.click();
    // });

    self.initialized = true;

    return resolve(self);
  });
};

module.exports = Puppeteer;
