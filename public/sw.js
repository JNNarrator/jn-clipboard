/*
 * Offline shell for the web build.
 *
 * Asset file names are content-hashed, so a precache list would have to be
 * generated at build time. Runtime caching avoids that: every same-origin GET is
 * served from cache when offline and refreshed in the background otherwise, and
 * navigations fall back to the cached shell so a cold start still boots.
 */
const CACHE = "jn-clipboard-shell-v1";
// Relative on purpose: the worker lives beside index.html, so this list works
// whether the app is served from the origin root or from a sub-path such as
// /clipboard/. The scope is derived from where the worker was registered.
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];
const SHELL_PAGE = "./index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL_PAGE, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_PAGE).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Everything else: cache first, then network (and remember it).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok || response.type === "opaque") return response;
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
