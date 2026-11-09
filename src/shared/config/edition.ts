export type AppEdition = "local" | "cloud";

const rawEdition = (import.meta.env.VITE_EDITION ?? "cloud").toLowerCase();
export const APP_EDITION: AppEdition = rawEdition === "local" ? "local" : "cloud";
export const CLOUD_SYNC_ENABLED = APP_EDITION === "cloud";

/**
 * The WebDAV engine is retired: the JNClub API replaced it, and two engines
 * against one database would double every record that travels. The settings
 * UI is gone by default; build with `VITE_WEBDAV_SYNC=1` to bring it back
 * (e.g. to migrate an old WebDAV deployment by hand).
 */
export const WEBDAV_SYNC_UI = import.meta.env.VITE_WEBDAV_SYNC === "1";
