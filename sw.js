const CACHE = 'plantfinc-v2.2.0';
const SHELL = ['./', './index.html', './core.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== 'plantfinc-tiles').map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin === location.origin) {
    // propio: red primero, caché si no hay conexión
    e.respondWith(fetch(e.request).then((r) => {
      const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r;
    }).catch(() => caches.match(e.request)));
  } else if ((u.hostname === 'unpkg.com' || u.hostname === 'cdn.jsdelivr.net')) {
    // librerías: caché primero
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => {
      const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r;
    })));
  }
  else if (/tile\.openstreetmap\.org|opentopomap\.org|ign\.es\/wmts/.test(u.hostname + u.pathname)) {
    // teselas: red primero; si falla, las guardadas con «Descargar mapa sin conexión»
    e.respondWith(fetch(e.request).catch(() => caches.open('plantfinc-tiles').then((c) => c.match(e.request.url)).then((m) => m || Response.error())));
  }
  // APIs: siempre red
});
