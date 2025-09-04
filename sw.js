// sw.js — strategia semplice e sicura
const CACHE_NAME = 'ayo-v3';
const PRECACHE = [
  '/style.css',
  '/script.js',
  '/immagini/logo.svg',
  '/favicon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Pagine HTML: network-first (mai cacheare club/success/cancel)
  if (req.mode === 'navigate') {
    const url = new URL(req.url);
    const path = url.pathname;
    if (['/club.html','/club-login.html','/success.html','/cancel.html'].includes(path)) {
      event.respondWith(fetch(req)); // sempre rete
      return;
    }
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Asset statici: cache-first
  event.respondWith(
    caches.match(req).then((res) => res || fetch(req))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
});
