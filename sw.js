// File: sw.js
const CACHE_NAME = 'ayo-club-cache-v2'; // Ho incrementato la versione per forzare l'aggiornamento
const urlsToCache = [
  '/',
  '/index.html',
  '/club.html',
  '/club-login.html',
  '/guida-degustazione.html', // <-- PAGINA AGGIUNTA
  '/ricette.html',           // <-- PAGINA AGGIUNTA
  '/style.css',
  '/script.js',
  '/immagini/logo.svg',
  '/favicon.svg'
];

// Evento di installazione: apriamo la cache e aggiungiamo i file
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aperta e file aggiunti');
        return cache.addAll(urlsToCache);
      })
  );
});

// Evento fetch: intercetta le richieste di rete
self.addEventListener('fetch', event => {
  event.respondWith(
    // Cerca prima nella cache
    caches.match(event.request)
      .then(response => {
        // Se la risorsa è in cache, la restituiamo, altrimenti facciamo la richiesta di rete
        return response || fetch(event.request);
      })
  );
});

// Pulisce le vecchie cache
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});