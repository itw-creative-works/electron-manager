# Restart Manager

EM apps don't restart themselves directly — they delegate to **Restart Manager** (RM), a tiny auxiliary helper app that's always alive. RM sits outside the host app's process tree, so it can wait, observe, and re-launch us cleanly through edge cases that are impossible to handle from inside our own quitting process (post-update install, hidden-mode rehydrate, crashed-then-relaunch, etc.).

This is a 1:1 conceptual port of the legacy electron-manager mechanism, with cleaner installer UX (no DMG mounting on macOS).

## When it runs

After `whenReady` (15s prod / 3s dev) EM auto-registers this app with RM via the custom URL scheme:

```
restart-manager://message?command=register&payload=<JSON>
```

On clean `before-quit` it auto-unregisters. The handshake is fire-and-forget — `shell.openExternal` opens the URL, RM (which registered itself as the OS handler for `restart-manager://`) parses it.

## Bail conditions

EM skips the entire dance when:

- `manager.config.brand.id === 'restart-manager'` — RM doesn't manage itself.
- `config.restartManager.enabled === false` — explicit opt-out.
- `manager.isDevelopment() === true` and `EM_RESTART_MANAGER_DEV !== '1'` — silently skipped in dev. Set `EM_RESTART_MANAGER_DEV=1` to exercise the flow against a locally installed RM.
- 3 install attempts already burned in this process.

## Auto-install

If `app.getApplicationNameForProtocol('restart-manager://')` returns nothing (or `'Electron'`, meaning we're the only handler — i.e. RM isn't installed), EM downloads + installs RM:

| Platform | Install path | UX |
| --- | --- | --- |
| **mac** | Download `Restart-Manager-mac.zip` → unzip into `~/Library/Application Support/Restart Manager/resources/Restart Manager.app` → `open` it. | Silent. The zip is already signed + notarized as part of RM's normal mac release (electron-builder produces it for differential auto-updates). No DMG mount, no `/Volumes/` flash, no prompts. |
| **windows** | Download `Restart-Manager-Setup.exe` → spawn it. | Brief. NSIS one-click installer pops, registers itself with the OS protocol-handler list, exits. |
| **linux** | Open `restart-manager_amd64.deb` URL in the user's browser. | User-driven. Their package manager (Software Center / gdebi / apt) handles the rest. EM does NOT `sudo apt install` — that requires a TTY or pkexec dance we can't guarantee. |

After install, EM waits 5s for the OS to pick up the new protocol handler, then retries the original `register` / `unregister` once. Subsequent failures fall through silently (no infinite loop) — they'll retry on the next call.

## Config

```json5
{
  restartManager: {
    enabled: true,        // false → fully off
  },
}
```

That's it. The download URLs are framework constants pointing at `restart-manager/download-server`. Consumers don't fork RM. (For air-gapped enterprise mirrors you can override `manager.restartManager._urls` post-init, but that's not a config field.)

## API

```js
manager.restartManager.register()           // send register URL (auto-called after whenReady)
manager.restartManager.unregister()         // send unregister URL (auto-called on before-quit)
manager.restartManager.ensureInstalled()    // force the download + install path
```

`register()` and `unregister()` return promises that resolve when the handshake URL has been opened (or when install + retry has been attempted). They never throw — failures are logged.

## Why a separate helper?

You can `app.relaunch() + app.quit()` from inside the app and it works for the common case. But:

- **Post-update install on macOS**: `electron-updater` calls `quitAndInstall` which spawns a separate updater process that copies the new .app over the old one. If the old app isn't fully exited before that, the copy fails. RM watches our PID from outside and only relaunches us once we're truly gone.
- **Hidden-mode rehydrate**: An app launched at login with `LSUIElement: true` that goes invisible may need to be respawned in a different mode (e.g. user-driven launch). Self-relaunch can't change `LSUIElement` mid-flight; RM can spawn us with the right `--em-launched-at-login` flag.
- **Crash recovery**: If we crashed, we can't relaunch ourselves. RM's `restart-manager://` URL can be triggered by anything (a crash sentinel watcher, a deep link, a tray menu in another app).

## Source

- Lib: [`src/lib/restart-manager.js`](../src/lib/restart-manager.js)
- Tests: [`src/test/suites/main/restart-manager.test.js`](../src/test/suites/main/restart-manager.test.js)
- Download server: <https://github.com/restart-manager/download-server>

## TODO: ship `Restart-Manager-mac.zip`

The mac silent-install path expects `Restart-Manager-mac.zip` on the `installer` tag. As of writing the release ships only `Restart-Manager.dmg` + `Restart-Manager-Setup.exe` + `restart-manager_amd64.deb` + `restart-manager_i386.deb`. Once Restart Manager itself adopts EM (which already mirrors `*-mac.zip` to `download-server` automatically), the asset will land and the mac path will start working. Until then, mac falls back gracefully — `_send` just logs the missing handler and the download fails with a 404 (caught + logged, no crash).
