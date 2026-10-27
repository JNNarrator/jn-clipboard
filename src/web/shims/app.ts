/** Browser stand-in for `@tauri-apps/api/app`. */

/** Package version, injected by vite (`define: __APP_VERSION__`). */
export async function getVersion(): Promise<string> {
  return __APP_VERSION__;
}

export async function getName(): Promise<string> {
  return "TieZ Clipboard";
}

/** Not applicable on the web: the page cannot register OS-level startup. */
export async function getTauriVersion(): Promise<string> {
  return "web";
}
