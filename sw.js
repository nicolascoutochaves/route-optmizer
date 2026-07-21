// sw.js — cache simples para funcionar offline / instalar como app
// Mude o número da versão sempre que atualizar style.css, script.js ou os .html
const CACHE_VERSION = "roteiros-v1";

const CORE_ASSETS = [
  "./index.html",
  "./tutoriais.html",
  "./ajuda/ajuda_rapida.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // addAll falha se QUALQUER arquivo der 404 — por isso adiciona um a um
      Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn("[sw] não cacheou:", url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Estratégia: network-first para HTML/JS/CSS (pega versão nova quando online),
// cache-first como fallback (funciona offline / rede instável).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Nunca intercepta chamadas de API externas (Mapbox, Google Maps) — precisam ser sempre "ao vivo"
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
