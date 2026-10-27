/**
 * Browser stand-in for `@tauri-apps/plugin-updater`.
 *
 * There is no signed desktop bundle to swap out, so `check` reports no update.
 * The web app updates by reloading, which the service worker handles. The
 * `Update` class exists so `useAutoUpdate` can import and type-check it.
 */
export class Update {
  available = false;
  currentVersion = __APP_VERSION__;
  version = __APP_VERSION__;
  body?: string;

  async downloadAndInstall(): Promise<void> {
    window.location.reload();
  }

  async close(): Promise<void> {}
}

export async function check(): Promise<Update | null> {
  return null;
}
