/**
 * GlidePay Service Worker
 * Provides offline caching for static app shell assets and fast load times.
 */

const CACHE_NAME = 'glidepay-v1.0.0';
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './config.js',
    './supabase.js',
    './billing.js',
    './payroll-engine.js',
    './efile-exports.js',
    './components.js',
    './app.js',
    './manifest.json',
    './assets/logo.svg',
    './assets/logo-200.png',
    './assets/logo-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] Cache addAll warning:', err);
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only cache GET requests for static assets; bypass API / edge calls
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                const networkFetch = fetch(event.request).then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    }
                    return response;
                }).catch(() => cached);
                return cached || networkFetch;
            })
        );
    }
});
