/**
 * Background sync loop for the web build.
 *
 * A browser cannot run in the background the way the desktop tray app does, so
 * this only syncs while a tab is visible: on start, when the tab is brought
 * back to the front, when the network returns, and on a slow timer that covers
 * the case of a tab left open. Everything here is best-effort — a failed round
 * trip is recorded on the row by the engine and retried on the next tick, never
 * surfaced as a dialog.
 */
import { invoke } from "@tauri-apps/api/core";
import { db } from "../backend/db";
import { syncNow } from "./engine";
import { adoptTokenFromUrl, readToken } from "./token";

const ENABLED_KEY = "web.sync_enabled";
const SERVER_KEY = "web.sync_base_url";

/** How often an idle tab checks whether there is anything to do. */
const TICK_MS = 30_000;
/** An idle tab still pulls this often: another device may have written. */
const PULL_EVERY_MS = 5 * 60_000;

function defaultBaseUrl(): string {
  return window.location.origin;
}

async function hasPendingPush(): Promise<boolean> {
  const [entries, settings] = await Promise.all([
    db.entries.where("dirty").equals(1).count(),
    db.settings.where("dirty").equals(1).count(),
  ]);
  return entries + settings > 0;
}

/** Start the loop; the returned function stops it. */
export function startWebSync(): () => void {
  // The SSO client redirects back with `?token=`; consume it before the first
  // round trip so the very first sync is already authenticated.
  adoptTokenFromUrl();

  let cancelled = false;
  let running = false;

  const tick = async (force: boolean) => {
    if (cancelled || running) return;
    if (document.visibilityState === "hidden") return;

    const token = readToken();
    if (!token) return;

    const settings = (await invoke("get_settings")) as Record<string, string>;
    if (settings[ENABLED_KEY] !== "true") return;

    if (!force && !(await hasPendingPush())) {
      const meta = await db.meta.get("sync");
      if (Date.now() - (meta?.last_sync_at ?? 0) < PULL_EVERY_MS) return;
    }

    running = true;
    try {
      await syncNow({ baseUrl: settings[SERVER_KEY] || defaultBaseUrl(), token });
    } catch {
      // Recorded in `meta` by the engine; the next tick retries.
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(() => void tick(false), TICK_MS);

  const onWake = () => {
    if (document.visibilityState === "visible") void tick(true);
  };

  void tick(true);
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);

  return () => {
    cancelled = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
  };
}
