const swUrl = new URL(self.location.href);
const SW_BUILD = swUrl.searchParams.get("build") || "dev";
const SW_VERSION = `xpense-pwa-${SW_BUILD}`;
const STATIC_CACHE = `${SW_VERSION}-static`;
const DYNAMIC_CACHE = `${SW_VERSION}-dynamic`;
const API_CACHE = `${SW_VERSION}-api`;
const MAX_DYNAMIC_ENTRIES = 120;

const APP_SHELL = [
  "/",
  "/index.html",
  "/tracker-login",
  "/expense-tracker",
  "/user-manual",
  "/css/tokens.css",
  "/css/styles.css",
  "/css/styles.css?v=2.0.0",
  "/css/tracker.css",
  "/css/tracker.css?v=2.2.3",
  "/css/landing.css",
  "/css/pwa.css",
  "/js/localDataStore.js",
  "/js/localDataStore.js?v=1.0.0",
  "/js/tracker.js",
  "/js/tracker.js?v=1.3.0",
  "/js/chat.js",
  "/js/chat.js?v=1.3.0",
  "/js/pwa.js",
  "/js/pwa.js?v=1.1.0",
  "/assets/hehehe.png",
  "/assets/hero-mockup.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/screenshots/desktop.png",
  "/assets/screenshots/mobile.png",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ![STATIC_CACHE, DYNAMIC_CACHE, API_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "SW_READY", version: SW_VERSION });
    }
  })());
});

self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || !url.protocol.startsWith("http")) {
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  const isStyleOrScript =
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "font" ||
    /\.(?:css|js|woff2?|ttf)$/.test(url.pathname);

  const isImageAsset =
    request.destination === "image" ||
    /\.(?:png|jpg|jpeg|svg|webp|gif|ico)$/.test(url.pathname);

  if (isStyleOrScript) {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }

  if (isImageAsset) {
    event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, DYNAMIC_CACHE));
});

async function handleNavigation(request) {
  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(DYNAMIC_CACHE);
    await safeCachePut(cache, request, networkResponse.clone());
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    return (
      (await caches.match("/expense-tracker")) ||
      (await caches.match("/index.html")) ||
      new Response("Offline", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain" }
      })
    );
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    await safeCachePut(cache, request, networkResponse.clone());
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const fallback = await caches.match("/expense-tracker");
      if (fallback) return fallback;
    }

    return new Response("Offline", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain" }
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    await safeCachePut(cache, request, networkResponse.clone());
    return networkResponse;
  } catch {
    return cachedResponse || new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkFetch = fetch(request)
    .then(async (networkResponse) => {
      await safeCachePut(cache, request, networkResponse.clone());
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;

  return new Response("Offline", { status: 503 });
}

async function safeCachePut(cache, request, response) {
  if (!response || response.status >= 400) return;

  try {
    await cache.put(request, response);
    await pruneCache(cache);
  } catch (error) {
    const isQuotaError =
      error &&
      (error.name === "QuotaExceededError" || String(error).includes("Quota"));

    if (!isQuotaError) return;

    const keys = await cache.keys();
    if (keys.length > 0) {
      await cache.delete(keys[0]);
      try {
        await cache.put(request, response);
      } catch {
        // Ignore failures after eviction.
      }
    }
  }
}

async function pruneCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_DYNAMIC_ENTRIES) return;

  const deleteCount = keys.length - MAX_DYNAMIC_ENTRIES;
  for (let i = 0; i < deleteCount; i += 1) {
    await cache.delete(keys[i]);
  }
}
