// Service worker: guarda la app en caché para que abra rápido y funcione sin conexión (p. ej. en el club).
// Los datos de la red social (Supabase) y las fotos nunca se cachean aquí: siempre van a la red.
const CACHE = 'padelfit-v3';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'css/styles.css',
  'css/social.css',
  'css/publish.css',
  'css/train.css',
  'css/profile.css',
  'js/app.js',
  'js/config.js',
  'js/ui.js',
  'js/photos.js',
  'js/components.js',
  'js/activities.js',
  'js/stats.js',
  'js/challenges.js',
  'js/plans.js',
  'js/data.js',
  'js/generator.js',
  'js/player.js',
  'js/backend/index.js',
  'js/backend/local.js',
  'js/backend/demo-data.js',
  'js/backend/supabase.js',
  'js/views/feed.js',
  'js/views/activity.js',
  'js/views/notifications.js',
  'js/views/search.js',
  'js/views/publish.js',
  'js/views/celebrate.js',
  'js/views/onboarding.js',
  'js/views/challenges.js',
  'js/views/profile.js',
  'js/views/settings.js',
  'js/views/train.js',
  'js/views/exercises.js',
  'js/views/premium.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Red primero (para recibir actualizaciones) y caché como respaldo sin conexión. Solo archivos de la propia app.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
