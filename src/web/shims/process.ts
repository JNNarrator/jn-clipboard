/** Browser stand-in for `@tauri-apps/plugin-process`. */

/** "Restart the app" means reload the page in the browser. */
export async function relaunch(): Promise<void> {
  window.location.reload();
}

export async function exit(_code?: number): Promise<void> {
  console.warn("[web] a page cannot exit the process; ignoring");
}
