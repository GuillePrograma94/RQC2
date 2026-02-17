/**
 * Cola de pedidos que no pudieron enviarse porque no habia conexion (Supabase inalcanzable).
 * Al volver online: crea el pedido en Supabase, anade lineas, envia al ERP (o encola en erpRetryQueue si falla ERP).
 */

const OFFLINE_QUEUE_DB = 'ScanAsYouShop_OfflineOrders';
const OFFLINE_QUEUE_STORE = 'offline_orders';

function generateId() {
    return 'offline_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

class OfflineOrderQueue {
    constructor() {
        this.db = null;
        this._onlineBound = null;
        this._visibilityBound = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(OFFLINE_QUEUE_DB, 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                this.db = req.result;
                if (typeof window !== 'undefined' && !this._onlineBound) {
                    this._onlineBound = () => this.processAll();
                    window.addEventListener('online', this._onlineBound);
                }
                if (typeof document !== 'undefined' && !this._visibilityBound) {
                    this._visibilityBound = () => {
                        if (document.visibilityState === 'visible') {
                            this.processAll();
                            if (window.erpRetryQueue && typeof window.erpRetryQueue.runRetries === 'function') {
                                window.erpRetryQueue.runRetries([]);
                            }
                        }
                    };
                    document.addEventListener('visibilitychange', this._visibilityBound);
                }
                resolve();
            };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
                    db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id' });
                }
            };
        });
    }

    registerBackgroundSync() {
        if (typeof navigator === 'undefined' || !navigator.serviceWorker || !navigator.serviceWorker.ready) return;
        navigator.serviceWorker.ready.then(function (registration) {
            if (registration.sync && typeof registration.sync.register === 'function') {
                registration.sync.register('offline-orders').catch(function (err) {
                    console.warn('Background Sync no registrado:', err);
                });
            }
        }).catch(function () {});
    }

    /**
     * Anade un pedido a la cola. Evita duplicados: si ya existe un item del mismo usuario
     * y almacen creado en los ultimos 90 segundos, no anade otro (evita doble clic).
     */
    async enqueue(item) {
        if (!this.db) return Promise.reject(new Error('OfflineOrderQueue no inicializado'));
        const now = Date.now();
        const record = Object.assign({}, item, { id: item.id || generateId(), createdAt: item.createdAt || now });

        const existing = await this.getAll();
        const windowMs = 90000;
        const duplicate = existing.find(function (x) {
            return x.usuario_id === record.usuario_id &&
                x.almacen === record.almacen &&
                (now - (x.createdAt || 0)) < windowMs;
        });
        if (duplicate) {
            this.registerBackgroundSync();
            return duplicate.id;
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
            tx.objectStore(OFFLINE_QUEUE_STORE).put(record);
            tx.oncomplete = () => {
                this.registerBackgroundSync();
                resolve(record.id);
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    getAll() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve([]);
                return;
            }
            const tx = this.db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
            const req = tx.objectStore(OFFLINE_QUEUE_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    remove(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve();
                return;
            }
            const tx = this.db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
            tx.objectStore(OFFLINE_QUEUE_STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async processAll() {
        if (!this.db || !window.supabaseClient) return;
        if (this._processing) return;
        this._processing = true;
        try {
            const items = await this.getAll();
            if (items.length === 0) return;
            for (const item of items) {
                try {
                    try {
                        await this.remove(item.id);
                    } catch (e) {
                        console.warn('OfflineOrderQueue remove before process:', e);
                        continue;
                    }
                    let result;
                try {
                    result = await window.supabaseClient.crearPedidoRemoto(
                        item.usuario_id,
                        item.almacen,
                        item.observaciones != null ? String(item.observaciones) : null,
                        item.user_snapshot && item.user_snapshot.is_operario ? (item.user_snapshot.nombre_operario || null) : null
                    );
                } catch (e) {
                    try {
                        await this.enqueue(item);
                    } catch (e2) {
                        console.warn('OfflineOrderQueue re-enqueue after crearPedidoRemoto fail:', e2);
                    }
                    continue;
                }
                if (!result || !result.success) {
                    try {
                        await this.enqueue(item);
                    } catch (e2) {
                        console.warn('OfflineOrderQueue re-enqueue after no success:', e2);
                    }
                    continue;
                }
                const carritoId = result.carrito_id;
                const codigoQr = result.codigo_qr || '';
                const cart = item.cart || {};
                const productos = cart.productos || [];
                for (const p of productos) {
                    await window.supabaseClient.addProductToRemoteOrder(
                        carritoId,
                        {
                            codigo: p.codigo_producto || p.codigo,
                            descripcion: p.descripcion_producto || p.descripcion,
                            pvp: p.precio_unitario != null ? p.precio_unitario : p.pvp
                        },
                        p.cantidad != null ? p.cantidad : 0
                    );
                }
                const referencia = 'RQC/' + carritoId + '-' + codigoQr;
                const codigoClienteUsuario = result.codigo_cliente_usuario || null;
                const erpPayload = typeof window.app !== 'undefined' && typeof window.app.buildErpPayloadFromOfflineItem === 'function'
                    ? window.app.buildErpPayloadFromOfflineItem(item, carritoId, codigoQr, codigoClienteUsuario)
                    : null;
                if (!erpPayload || !window.erpClient) {
                    if (window.purchaseCache && item.usuario_id) window.purchaseCache.invalidateUser(item.usuario_id);
                    continue;
                }
                try {
                    const response = await window.erpClient.createRemoteOrder(erpPayload);
                    if (response && response.success === false) {
                        await window.supabaseClient.updateCarritoEstadoProcesamiento(carritoId, 'error_erp');
                        continue;
                    }
                    const pedidoErp = response && response.data && response.data.pedido != null ? response.data.pedido : null;
                    if (pedidoErp) {
                        await window.supabaseClient.updatePedidoErp(carritoId, pedidoErp);
                    }
                    try {
                        await window.supabaseClient.registrarHistorialDesdeCarrito(carritoId);
                    } catch (e) {
                        console.warn('registrarHistorialDesdeCarrito en offline queue:', e);
                    }
                    if (window.purchaseCache && item.usuario_id) window.purchaseCache.invalidateUser(item.usuario_id);
                } catch (erpErr) {
                    const isValidation = /400|Bad Request|obligatorio|ERP error 4\d\d/i.test(String(erpErr && erpErr.message));
                    if (isValidation) {
                        await window.supabaseClient.updateCarritoEstadoProcesamiento(carritoId, 'error_erp');
                        continue;
                    }
                    await window.supabaseClient.updateCarritoEstadoProcesamiento(carritoId, 'pendiente_erp');
                    if (window.erpRetryQueue) {
                        window.erpRetryQueue.enqueue({
                            carrito_id: carritoId,
                            payload: erpPayload,
                            referencia: referencia,
                            almacen: item.almacen,
                            usuario_id: item.usuario_id
                        });
                    }
                    if (window.purchaseCache && item.usuario_id) window.purchaseCache.invalidateUser(item.usuario_id);
                }
                } catch (err) {
                    console.warn('OfflineOrderQueue processAll item:', item.id, err);
                }
            }
        } finally {
            this._processing = false;
        }
    }
}

window.offlineOrderQueue = new OfflineOrderQueue();
