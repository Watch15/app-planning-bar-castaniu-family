// ⚠️ Le token %%BUILD_TIME%% est remplacé par un timestamp au déploiement
// (`npm start`, cf. package.json) → nouvel id de cache à chaque déploiement =
// invalidation automatique. NE JAMAIS commiter ce fichier après substitution :
// si le token disparaît, l'id de cache se fige et les clients gardent une version
// périmée. En local, utiliser `npm run dev` (qui ne substitue pas).
const CACHE = 'templyo-' + '%%BUILD_TIME%%';
const STATIC = [
    '/login.html',
    '/set-password.html',
    // Coquilles applicatives : elles portent de la CSS en ligne (ex. .dispo-type-btn.selected-long
    // dans planning.html). Sans préchargement, ce HTML pouvait rester périmé pendant que le JS
    // préchargé se mettait à jour → classes sans style (« la couleur du Long disparaît »).
    '/index.html',
    '/planning.html',
    '/pointage.html',
    '/performance.html',
    '/login.js',
    '/set-password.js',
    '/script.js',
    '/planning.js',
    '/pointage.js',
    '/performance.js',
    '/index-init.js',
    '/sw-register.js',
    '/lib/shift-hours.js',
    '/lib/week.js',
    '/style.css',
    '/manifest.json',
    '/vendor/html2canvas.min.js',
    '/vendor/jspdf.umd.min.js',
    '/vendor/xlsx.full.min.js',
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

    // Cross-origin (Google Fonts, etc.) : ne PAS intercepter — laisser le navigateur
    // charger directement depuis le réseau. Sinon le fetch() du SW retombe sous la
    // directive CSP connect-src 'self' et est bloqué (la requête est alors servie en
    // fallback /login.html → erreur de MIME sur la feuille de style).
    if (url.origin !== self.location.origin) return;

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

// ── Web Push — réception et affichage ────────────────────────────────────────

self.addEventListener('push', event => {
    let data = {};
    try { if (event.data) data = event.data.json(); } catch { /* payload non-JSON ignoré */ }
    event.waitUntil(
        self.registration.showNotification(data.title || 'Templyo', {
            body:     data.body,
            icon:     '/icons/icon-192.png',
            badge:    '/icons/icon-72.png',
            tag:      data.tag || 'templyo-notif',
            renotify: true,
            actions:  data.actions || [],
            data:     { url: data.url || '/planning.html' },
            vibrate:  [200, 100, 200],
        })
    );
});

// Clic sur la notification — ouvrir / focus la page
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/planning.html';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
                if (client.url.includes(url.split('#')[0]) && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});