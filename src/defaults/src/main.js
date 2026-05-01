// Main-process entry. Config is auto-loaded from config/electron-manager.json (JSON5).
const Manager = require('electron-manager/main');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger, ipc, storage, windows, tray, menu, contextMenu, deepLink, autoUpdater, webManager, appState, sentry, startup } = manager;

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Surface the main window
    // ─────────────────────────────────────────────────────────────────────────────
    // EM doesn't auto-create any windows — your app decides when (and if) UI
    // appears. The typical pattern: create the main window unless we're in hidden
    // launch mode (agent / menubar apps with `startup.mode = 'hidden'`).
    if (!startup.isLaunchHidden()) {
      windows.create('main');
    }

    // Hidden / agent apps skip the create() above and surface UI later — typically
    // from a tray click. Example:
    //
    //   tray.update('open', { click: () => windows.create('main') });

    // ─── Window create() options (all optional; defaults shown) ───────────────────
    // windows.create('main', {
    //   view:            'main',     // src/views/<view>/index.html (defaults to name)
    //   width:           1024,       // initial width
    //   height:          720,        // initial height
    //   minWidth:        400,
    //   minHeight:       300,
    //   x:               undefined,  // initial x position (undefined = OS centers)
    //   y:               undefined,  // initial y position
    //   show:            true,       // auto-show on ready-to-show
    //   title:           'My App',   // defaults to app.productName
    //   backgroundColor: '#ffffff',  // pre-load bg color
    //   hideOnClose:     true,       // X-button hides instead of closes (default for 'main')
    //   persistBounds:   true,       // remember position+size across launches
    //   skipTaskbar:     false,      // suppress taskbar/dock entry for THIS window
    //   titleBar:        'inset',    // 'inset' (mac/win native overlay) or 'native'
    //   titleBarOverlay: {           // Windows-only: native overlay color/size
    //     color:       '#ffffff',
    //     symbolColor: '#000000',
    //     height:      36,
    //   },
    // });

    // Secondary windows — built-in defaults (800x600, hideOnClose:false) are good
    // enough for most cases. Examples:
    //
    //   windows.create('settings');                                  // baked defaults
    //   windows.create('about', { width: 480, height: 360 });        // override at call site

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Wire up your custom logic
    // ─────────────────────────────────────────────────────────────────────────────

    // Deep links: handle custom routes from <brand-id>://your-route URLs.
    //   deepLink.on('settings/open', () => windows.create('settings'));
    //   deepLink.on('checkout/success', ({ params }) => { /* params.session_id, etc. */ });

    // IPC handlers: respond to renderer requests.
    //   ipc.handle('my-app:get-data', async () => ({ ok: true, data: [] }));

    // Disable framework features you don't want (idempotent, safe pre/post-init):
    //   tray.disable();         // no tray icon
    //   menu.disable();         // no application menu
    //   contextMenu.disable();  // no right-click menus

    // Subscribe to auto-update status (renderer can also listen via window.em.autoUpdater):
    //   autoUpdater.onStatus((status) => logger.log('updater:', status.code));

    // First-launch detection / launch counter / crash recovery:
    //   if (appState.isFirstLaunch()) { /* welcome flow */ }
    //   logger.log(`launch #${appState.getLaunchCount()}`);

    logger.log('Main initialized!');
  });
