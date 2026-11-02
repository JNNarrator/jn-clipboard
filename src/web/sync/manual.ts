/**
 * One-shot manual sync for the browser build.
 *
 * The settings panel owns the enabled flag and the server URL, so this reads
 * them back rather than keeping a second copy: the header button and the panel
 * would otherwise disagree after someone edits the address.
 */
import { invoke } from "@tauri-apps/api/core";

import { syncNow, type SyncDirection, type SyncOutcome } from "./engine";
import { notifyIfChanged } from "./notify";
import { readToken } from "./token";

const ENABLED_KEY = "web.sync_enabled";
const SERVER_KEY = "web.sync_base_url";

function defaultBaseUrl(): string {
  if (typeof window === "undefined") return "";
  return import.meta.env.VITE_JNCLUB_BASE_URL ?? `${window.location.origin}/jnclub`;
}

export async function runWebSync(direction: Exclude<SyncDirection, "both">): Promise<SyncOutcome> {
  const settings = await invoke<Record<string, string>>("get_settings");
  if (settings[ENABLED_KEY] !== "true") {
    throw new Error("web_sync_sign_in_required");
  }
  const token = readToken();
  if (!token) {
    throw new Error("web_sync_sign_in_required");
  }
  const baseUrl = settings[SERVER_KEY] || defaultBaseUrl();
  const outcome = await syncNow({ baseUrl, token }, { direction });
  // A pull that brought new clips has to tell the list to re-read the database;
  // the panel does the same thing and the listener is shared.
  notifyIfChanged(outcome);
  return outcome;
}
