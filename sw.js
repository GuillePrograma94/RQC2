/**
 * Service Worker para Scan as You Shop PWA
 * Maneja cache y funcionamiento offline
 */

const CACHE_NAME = 'scan-as-you-shop-v14';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/config.js',
    '/js/ui.js',
    '/js/supabase.js',
    '/js/cart.js',
    '/js/scanner.js',
    '/js/app.js',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

// Instalación del Service Worker
self.addEventListener('install', event => {
    console.log('Service Worker: Instalando...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Cacheando archivos');
                return cache.addAll(urlsToCache);
            })
            .catch(error => {
                console.error('Service Worker: Error al cachear:', error);
            })
    );
});

// Activación del Service Worker
self.addEventListener('activate', event => {
    console.log('Service Worker: Activando...');
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Eliminando cache antiguo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Interceptar peticiones
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Ignorar peticiones no HTTP/HTTPS (extensiones, chrome:// etc)
    if (!url.protocol.startsWith('http')) {
        return;
    }
    
    // Ignorar peticiones a Supabase
    if (url.hostname.includes('supabase.co')) {
        return;
    }
    
    // Ignorar peticiones a otros dominios externos
    if (url.origin !== location.origin) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Retornar desde cache si existe
                if (response) {
                    return response;
                }

                // Si no está en cache, hacer fetch
                return fetch(event.request)
                    .then(response => {
                        // Verificar respuesta válida
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clonar respuesta
                        const responseToCache = response.clone();

                        // Añadir a cache
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(() => {
                        // Si falla, mostrar página offline (opcional)
                        return caches.match('/index.html');
                    });
            })
    );
});

// Mensajes desde la app
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

