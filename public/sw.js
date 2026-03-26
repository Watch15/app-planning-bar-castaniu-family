const CACHE = 'planning-bar-v3';
const STATIC = [
    '/login.html',
    '/set-password.html',
    '/script.js',
    '/style.css',
    '/manifest.json',
];

// Installation — mise en cache des fichiers statiques
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())
    );
});

// Activation — nettoyage des anciens caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch — stratégie Network First pour l'API, Cache First pour les assets
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // API et auth — toujours réseau, jamais de cache
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
        e.respondWith(
            fetch(e.request).catch(() =>
                new Response(JSON.stringify({ error: 'Hors ligne' }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 503,
                })
            )
        );
        return;
    }

    // Assets statiques — Cache First avec fallback réseau
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(res => {
                if (res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then(cache => cache.put(e.request, clone));
                }
                return res;
            });
        }).catch(() => caches.match('/login.html'))
    );
});

// Message pour forcer la mise à jour du cache
self.addEventListener('message', e => {
    if (e.data === 'skipWaiting') self.skipWaiting();
});