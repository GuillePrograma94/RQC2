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

    enqueue(item) {
        if (!this.db) return Promise.reject(new Error('OfflineOrderQueue no inicializado'));
        const record = Object.assign({}, item, { id: item.id || generateId(), createdAt: item.createdAt || Date.now() });
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
        const items = await this.getAll();
        if (items.length === 0) return;
        for (const item of items) {
            try {
                const result = await window.supabaseClient.crearPedidoRemoto(item.usuario_id, item.almacen);
                if (!result || !result.success) {
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
                    await this.remove(item.id);
                    if (window.purchaseCache && item.usuario_id) window.purchaseCache.invalidateUser(item.usuario_id);
                    continue;
                }
                try {
                    const response = await window.erpClient.createRemoteOrder(erpPayload);
                    if (response && response.success === false) {
                        await window.supabaseClient.updateCarritoEstadoProcesamiento(carritoId, 'error_erp');
                        await this.remove(item.id);
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
                    await this.remove(item.id);
                    if (window.purchaseCache && item.usuario_id) window.purchaseCache.invalidateUser(item.usuario_id);
                } catch (erpErr) {
                    const isValidation = /400|Bad Request|obligatorio|ERP error 4\d\d/i.test(String(erpErr && erpErr.message));
                    if (isValidation) {
                        await window.supabaseClient.updateCarritoEstadoProcesamiento(carritoId, 'error_erp');
                        await this.remove(item.id);
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
                    await this.remove(item.id);
                    if (window.purchaseCache && item.usuario_id) window.purchaseCache.invalidateUser(item.usuario_id);
                }
            } catch (err) {
                console.warn('OfflineOrderQueue processAll item:', item.id, err);
            }
        }
    }
}

window.offlineOrderQueue = new OfflineOrderQueue();
