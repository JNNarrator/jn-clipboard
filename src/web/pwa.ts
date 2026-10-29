/**
 * Progressive-web-app wiring for the browser build.
 *
 * Only the service worker needs code: the manifest is static (`public/manifest.webmanifest`),
 * and the install prompt is left to the browser's own UI. Registration is
 * skipped in dev so hot reload is never served stale assets.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return;

  const register = () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.warn("[web] service worker registration failed", error);
    });
  };

  // This module is imported dynamically, so the load event may already have
  // fired by the time it runs; never rely on the listener alone.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}

/**
 * Ask the browser to keep our IndexedDB data out of automatic eviction. Without
 * this, a phone under storage pressure may drop the clipboard history, which is
 * the only copy the web build keeps.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
