/**
 * Service Worker para Scan as You Shop PWA
 * Maneja cache y funcionamiento offline
 */

// __SW_VERSION__ es reemplazado por build.js en cada deployment de Vercel
// con los primeros 8 caracteres del SHA del commit de Git.
// En desarrollo local (sin build), permanece como literal y funciona igualmente.
const CACHE_NAME = 'scan-as-you-shop-__SW_VERSION__';
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
    console.log('Service Worker: Instalando version ' + CACHE_NAME);

    // skipWaiting hace que el nuevo SW se active inmediatamente,
    // sin esperar a que todas las pestanas del cliente se cierren.
    self.skipWaiting();

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
    console.log('Service Worker: Activando version ' + CACHE_NAME);

    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Service Worker: Eliminando cache antiguo:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                // clients.claim hace que el nuevo SW controle todas las pestanas
                // abiertas de inmediato, sin esperar a que las recarguen.
                return self.clients.claim();
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

    // La Cache API solo admite GET; no interceptar POST ni otros metodos
    if (event.request.method !== 'GET') {
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

// Background Sync: cuando vuelve la conexion, el navegador dispara este evento
// (Chrome/Edge Android; no soportado en Safari/iOS)
const OFFLINE_ORDERS_SYNC_TAG = 'offline-orders';

self.addEventListener('sync', event => {
    if (event.tag !== OFFLINE_ORDERS_SYNC_TAG) return;
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                return Promise.all(
                    clientList.map(client => {
                        if (client.url.startsWith(self.registration.scope)) {
                            return client.postMessage({ type: 'PROCESS_OFFLINE_ORDERS' });
                        }
                        return Promise.resolve();
                    })
                );
            })
    );
});

// Mensajes desde la app
self.addEventListener('message', event => {
    // SKIP_WAITING ya no es necesario (skipWaiting se llama automaticamente en install),
    // pero se mantiene por compatibilidad por si alguna parte del codigo lo envia.
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Evento de notificación push
self.addEventListener('push', event => {
    console.log('Push recibido:', event);
    
    let notificationData = {
        title: 'Pedido Listo',
        body: 'Tu pedido está listo para recoger',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'order-ready',
        requireInteraction: true,
        data: {
            url: '/'
        }
    };

    if (event.data) {
        try {
            const data = event.data.json();
            if (data.title) notificationData.title = data.title;
            if (data.body) notificationData.body = data.body;
            if (data.url) notificationData.data.url = data.url;
            if (data.tag) notificationData.tag = data.tag;
        } catch (error) {
            console.error('Error al parsear datos de push:', error);
        }
    }

    event.waitUntil(
        self.registration.showNotification(notificationData.title, {
            body: notificationData.body,
            icon: notificationData.icon,
            badge: notificationData.badge,
            tag: notificationData.tag,
            requireInteraction: notificationData.requireInteraction,
            data: notificationData.data,
            vibrate: [200, 100, 200],
            actions: [
                {
                    action: 'open',
                    title: 'Ver Pedido'
                },
                {
                    action: 'close',
                    title: 'Cerrar'
                }
            ]
        })
    );
});

// Evento de click en notificación
self.addEventListener('notificationclick', event => {
    console.log('Notificación clickeada:', event);
    
    event.notification.close();

    if (event.action === 'close') {
        return;
    }

    // Abrir la app (o enfocar si ya está abierta)
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                // Si ya hay una ventana abierta, enfocarla
                for (let client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus();
                    }
                }
                
                // Si no hay ventana abierta, abrir una nueva
                if (clients.openWindow) {
                    const url = event.notification.data?.url || '/';
                    return clients.openWindow(url);
                }
            })
    );
});

