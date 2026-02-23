/**
 * Cola de reintentos para enviar pedidos al ERP cuando falla la conexion.
 * Reintentos progresivos: 10 intentos cada 5 min, luego 10 cada 10 min, luego cada 30 min.
 */

const ERP_QUEUE_DB = 'ScanAsYouShop_ErpQueue';
const ERP_QUEUE_STORE = 'erp_pending';
const INTERVAL_PHASE_0_MS = 5 * 60 * 1000;
const INTERVAL_PHASE_1_MS = 10 * 60 * 1000;
const INTERVAL_PHASE_2_MS = 30 * 60 * 1000;
const MAX_RETRIES_PHASE_0 = 10;
const MAX_RETRIES_PHASE_1 = 20;

class ERPRetryQueue {
    constructor() {
        this.db = null;
        this.timerId = null;
        this._onlineBound = null;
        this._running = false;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(ERP_QUEUE_DB, 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                this.db = req.result;
                this.scheduleNextRun();
                if (typeof window !== 'undefined' && !this._onlineBound) {
                    this._onlineBound = () => this.onConnectionRestored();
                    window.addEventListener('online', this._onlineBound);
                }
                resolve();
            };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(ERP_QUEUE_STORE)) {
                    const store = db.createObjectStore(ERP_QUEUE_STORE, { keyPath: 'carrito_id' });
                    store.createIndex('nextRetryAt', 'nextRetryAt', { unique: false });
                }
            };
        });
    }

    enqueue(item) {
        if (!this.db) return Promise.reject(new Error('ERPRetryQueue no inicializado'));
        const record = Object.assign({}, item, {
            nextRetryAt: Date.now() + INTERVAL_PHASE_0_MS,
            retryCount: 0,
            phase: 0,
            createdAt: Date.now()
        });
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(ERP_QUEUE_STORE, 'readwrite');
            tx.objectStore(ERP_QUEUE_STORE).put(record);
            tx.oncomplete = () => {
                this.scheduleNextRun();
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    getAll() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(ERP_QUEUE_STORE, 'readonly');
            const req = tx.objectStore(ERP_QUEUE_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    remove(carritoId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(ERP_QUEUE_STORE, 'readwrite');
            tx.objectStore(ERP_QUEUE_STORE).delete(carritoId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    onConnectionRestored() {
        if (!this.db) return;
        this.getAll().then((items) => {
            if (items.length > 0) {
                this.runRetries(items);
            }
        }).catch((err) => {
            console.warn('ERPRetryQueue onConnectionRestored:', err);
        });
    }

    scheduleNextRun() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.getAll().then((items) => {
            if (items.length === 0) return;
            const now = Date.now();
            const due = items.filter((i) => i.nextRetryAt <= now);
            const next = items.filter((i) => i.nextRetryAt > now).sort((a, b) => a.nextRetryAt - b.nextRetryAt)[0];
            if (due.length > 0) {
                this.runRetries(due);
                return;
            }
            if (next) {
                const delay = Math.max(1000, next.nextRetryAt - now);
                this.timerId = setTimeout(() => this.runRetries([]), delay);
            }
        }).catch((err) => {
            console.warn('ERPRetryQueue scheduleNextRun:', err);
        });
    }

    async runRetries(dueItems) {
        if (this._running) return;
        this._running = true;
        try {
            if (dueItems.length === 0) {
                dueItems = (await this.getAll()).filter((i) => i.nextRetryAt <= Date.now());
            }
            if (dueItems.length === 0) {
                return;
            }
            for (const item of dueItems) {
                // Eliminar de la cola ANTES de llamar al ERP para evitar envios duplicados
                // si multiples triggers (online, visibilitychange, SW sync) activan runRetries
                // en paralelo. Si falla, se vuelve a encolar con el contador actualizado.
                try {
                    await this.remove(item.carrito_id);
                } catch (removeErr) {
                    console.warn('ERPRetryQueue remove before send:', removeErr);
                    continue;
                }
                try {
                    const response = await window.erpClient.createRemoteOrder(item.payload);
                    if (response && response.success === false) {
                        await window.supabaseClient.updateCarritoEstadoProcesamiento(item.carrito_id, 'error_erp');
                        continue;
                    }
                    const pedidoErp = response && response.data && response.data.pedido != null ? response.data.pedido : null;
                    if (pedidoErp) {
                        await window.supabaseClient.updatePedidoErp(item.carrito_id, pedidoErp);
                    }
                    await window.supabaseClient.marcarPedidoRemotoEnviado(item.carrito_id);
                    try {
                        await window.supabaseClient.registrarHistorialDesdeCarrito(item.carrito_id);
                    } catch (e) {
                        console.warn('registrarHistorialDesdeCarrito en retry:', e);
                    }
                    if (window.purchaseCache && item.usuario_id) {
                        window.purchaseCache.invalidateUser(item.usuario_id);
                    }
                } catch (err) {
                    const isValidation = /400|Bad Request|obligatorio|ERP error 4\d\d/i.test(String(err && err.message));
                    if (isValidation) {
                        await window.supabaseClient.updateCarritoEstadoProcesamiento(item.carrito_id, 'error_erp');
                        continue;
                    }
                    // Error de red/timeout: re-encolar con contador incrementado
                    item.retryCount = (item.retryCount || 0) + 1;
                    item.phase = item.retryCount < MAX_RETRIES_PHASE_0 ? 0 : item.retryCount < MAX_RETRIES_PHASE_1 ? 1 : 2;
                    const interval = item.phase === 0 ? INTERVAL_PHASE_0_MS : item.phase === 1 ? INTERVAL_PHASE_1_MS : INTERVAL_PHASE_2_MS;
                    item.nextRetryAt = Date.now() + interval;
                    await new Promise((res, rej) => {
                        const tx = this.db.transaction(ERP_QUEUE_STORE, 'readwrite');
                        tx.objectStore(ERP_QUEUE_STORE).put(item);
                        tx.oncomplete = res;
                        tx.onerror = () => rej(tx.error);
                    });
                }
            }
        } finally {
            this._running = false;
            this.scheduleNextRun();
        }
    }
}

window.erpRetryQueue = new ERPRetryQueue();
