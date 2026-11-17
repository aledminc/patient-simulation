const CACHE_VERSION = "patient-simulator-app-v1";
const APP_SHELL = /* APP_SHELL_MANIFEST */ [];
const MODEL_CACHE = "patient-model-assets-v1";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith("patient-simulator-app-") && name !== CACHE_VERSION)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    event.respondWith((async () => {
      const modelCache = await caches.open(MODEL_CACHE);
      return (await modelCache.match(event.request.url)) || fetch(event.request);
    })());
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          await cache.put("/index.html", response.clone());
        }
        return response;
      } catch (_error) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match("/index.html")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});

