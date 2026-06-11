// Enregistrement du Service Worker (PWA). Externalisé des pages HTML pour
// permettre, à terme, une CSP sans `unsafe-inline` sur script-src.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
