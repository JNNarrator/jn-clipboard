/** Browser stand-in for `@tauri-apps/plugin-opener`. */

/** Opens a URL in a new tab. Only http(s) is allowed, matching the desktop allowlist. */
export async function openUrl(url: string): Promise<void> {
  const scheme = url.slice(0, url.indexOf(":") + 1).toLowerCase();
  if (scheme !== "http:" && scheme !== "https:" && scheme !== "mailto:") {
    console.warn(`[web] refusing to open unsupported URL scheme: ${url}`);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** The web build has no filesystem paths to reveal. */
export async function openPath(_path: string): Promise<void> {
  console.warn("[web] openPath is unavailable in the browser");
}

export async function revealItemInDir(_path: string): Promise<void> {
  console.warn("[web] revealItemInDir is unavailable in the browser");
}
