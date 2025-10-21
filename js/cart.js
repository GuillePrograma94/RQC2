/**
 * Gestor del carrito de compras
 * Maneja el almacenamiento local y sincronización con Supabase
 */

class CartManager {
    constructor() {
        this.cart = {
            id: null,
            codigo_qr: null,
            productos: [],
            total_productos: 0,
            total_importe: 0.0
        };
        this.dbName = 'ScanAsYouShop';
        this.db = null;
    }

    /**
     * Inicializa el gestor del carrito
     */
    async initialize() {
        try {
            // Inicializar IndexedDB
            await this.initIndexedDB();

            // Cargar carrito desde almacenamiento local
            await this.loadCartFromStorage();

            console.log('Gestor de carrito inicializado');
            return true;

        } catch (error) {
            console.error('Error al inicializar carrito:', error);
            return false;
        }
    }

    /**
     * Inicializa IndexedDB
     */
    initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 4); // v4: Añadir stores para pedidos remotos

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ IndexedDB inicializada correctamente');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Crear object store para el carrito
                if (!db.objectStoreNames.contains('cart')) {
                    db.createObjectStore('cart', { keyPath: 'id' });
                }

                // Crear object store para productos
                if (!db.objectStoreNames.contains('products')) {
                    const productsStore = db.createObjectStore('products', { keyPath: 'codigo' });
                    productsStore.createIndex('descripcion', 'descripcion', { unique: false });
                }
                
                // Crear object store para códigos secundarios (EAN)
                if (!db.objectStoreNames.contains('secondary_codes')) {
                    const secondaryStore = db.createObjectStore('secondary_codes', { keyPath: 'id', autoIncrement: true });
                    secondaryStore.createIndex('codigo_secundario', 'codigo_secundario', { unique: false });
                    secondaryStore.createIndex('codigo_principal', 'codigo_principal', { unique: false });
                }
                
                // Crear object store para pedidos remotos (caché offline)
                if (!db.objectStoreNames.contains('remote_orders')) {
                    const ordersStore = db.createObjectStore('remote_orders', { keyPath: 'id' });
                    ordersStore.createIndex('usuario_id', 'usuario_id', { unique: false });
                    ordersStore.createIndex('fecha_creacion', 'fecha_creacion', { unique: false });
                    ordersStore.createIndex('estado_procesamiento', 'estado_procesamiento', { unique: false });
                }
                
                // Crear object store para productos de pedidos remotos
                if (!db.objectStoreNames.contains('remote_order_products')) {
                    const orderProductsStore = db.createObjectStore('remote_order_products', { keyPath: 'id', autoIncrement: true });
                    orderProductsStore.createIndex('carrito_id', 'carrito_id', { unique: false });
                }
                
                console.log('✅ Esquema de base de datos creado/actualizado');
            };
        });
    }

    /**
     * Carga el carrito desde almacenamiento local
     */
    async loadCartFromStorage() {
        try {
            const transaction = this.db.transaction(['cart'], 'readonly');
            const store = transaction.objectStore('cart');
            const request = store.get('current');

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    if (request.result) {
                        this.cart = request.result;
                        console.log('Carrito cargado desde almacenamiento local');
                    }
                    resolve();
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error al cargar carrito:', error);
        }
    }

    /**
     * Guarda el carrito en almacenamiento local
     */
    async saveCartToStorage() {
        try {
            const transaction = this.db.transaction(['cart'], 'readwrite');
            const store = transaction.objectStore('cart');
            
            // Asegurar que el carrito tenga un id válido
            const cartData = {
                id: 'current', // ID fijo para el carrito actual
                codigo_qr: this.cart.codigo_qr || null,
                productos: this.cart.productos || [],
                total_productos: this.cart.total_productos || 0,
                total_importe: this.cart.total_importe || 0.0,
                timestamp: new Date().toISOString()
            };

            store.put(cartData);

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => {
                    console.error('Error en transacción de carrito:', transaction.error);
                    reject(transaction.error);
                };
            });

        } catch (error) {
            console.error('Error al guardar carrito:', error);
            throw error;
        }
    }

    /**
     * Sube el carrito a Supabase vinculándolo a un código QR de caja
     */
    async uploadCartToCheckout(codigoQR) {
        try {
            if (this.cart.productos.length === 0) {
                throw new Error('El carrito esta vacio');
            }

            // Verificar que el código QR existe y está activo en Supabase
            const carrito = await window.supabaseClient.createCart(codigoQR);

            // Subir todos los productos del carrito local a Supabase
            for (const producto of this.cart.productos) {
                await window.supabaseClient.addProductToCart(
                    carrito.id,
                    {
                        codigo: producto.codigo_producto,
                        descripcion: producto.descripcion_producto,
                        pvp: producto.precio_unitario
                    },
                    producto.cantidad
                );
            }

            // Si hay usuario logueado, asociar su sesión al carrito
            if (window.app && window.app.currentUser && window.app.currentSession) {
                console.log(`Asociando sesion ${window.app.currentSession} al carrito ${codigoQR}`);
                const associated = await window.supabaseClient.associateCartToSession(
                    window.app.currentSession,
                    codigoQR
                );
                if (associated) {
                    console.log('Sesion asociada correctamente al carrito');
                } else {
                    console.warn('No se pudo asociar la sesion al carrito');
                }
            } else {
                console.log('No hay usuario logueado - carrito sin sesion asociada');
            }

            // Guardar el código QR en el carrito local
            this.cart.codigo_qr = codigoQR;
            this.cart.id = carrito.id;
            await this.saveCartToStorage();

            console.log('Carrito subido a checkout:', codigoQR);
            return true;

        } catch (error) {
            console.error('Error al subir carrito:', error);
            throw error;
        }
    }

    /**
     * Añade un producto al carrito (solo local, no necesita estar vinculado)
     */
    async addProduct(producto, cantidad = 1) {
        try {
            // Verificar si el producto ya existe
            const existingIndex = this.cart.productos.findIndex(
                p => p.codigo_producto === producto.codigo
            );

            if (existingIndex >= 0) {
                // Actualizar cantidad
                this.cart.productos[existingIndex].cantidad += cantidad;
                this.cart.productos[existingIndex].subtotal = 
                    this.cart.productos[existingIndex].cantidad * producto.pvp;
            } else {
                // Añadir nuevo producto
                this.cart.productos.push({
                    codigo_producto: producto.codigo,
                    descripcion_producto: producto.descripcion,
                    cantidad: cantidad,
                    precio_unitario: producto.pvp,
                    subtotal: producto.pvp * cantidad
                });
            }

            // Actualizar totales
            this.updateTotals();

            // Guardar localmente
            await this.saveCartToStorage();

            console.log('Producto anadido al carrito:', producto.codigo);
            return true;

        } catch (error) {
            console.error('Error al añadir producto:', error);
            throw error;
        }
    }

    /**
     * Actualiza la cantidad de un producto (solo local)
     */
    async updateProductQuantity(codigoProducto, nuevaCantidad) {
        try {
            const productIndex = this.cart.productos.findIndex(
                p => p.codigo_producto === codigoProducto
            );

            if (productIndex < 0) {
                throw new Error('Producto no encontrado en el carrito');
            }

            if (nuevaCantidad <= 0) {
                // Eliminar producto
                return await this.removeProduct(codigoProducto);
            }

            // Actualizar cantidad
            this.cart.productos[productIndex].cantidad = nuevaCantidad;
            this.cart.productos[productIndex].subtotal = 
                nuevaCantidad * this.cart.productos[productIndex].precio_unitario;

            // Actualizar totales
            this.updateTotals();

            // Guardar localmente
            await this.saveCartToStorage();

            return true;

        } catch (error) {
            console.error('Error al actualizar cantidad:', error);
            throw error;
        }
    }

    /**
     * Elimina un producto del carrito (solo local)
     */
    async removeProduct(codigoProducto) {
        try {
            // Eliminar del array local
            this.cart.productos = this.cart.productos.filter(
                p => p.codigo_producto !== codigoProducto
            );

            // Actualizar totales
            this.updateTotals();

            // Guardar localmente
            await this.saveCartToStorage();

            console.log('Producto eliminado del carrito:', codigoProducto);
            return true;

        } catch (error) {
            console.error('Error al eliminar producto:', error);
            throw error;
        }
    }

    /**
     * Actualiza los totales del carrito
     */
    updateTotals() {
        this.cart.total_productos = this.cart.productos.reduce(
            (sum, p) => sum + p.cantidad, 0
        );
        
        this.cart.total_importe = this.cart.productos.reduce(
            (sum, p) => sum + p.subtotal, 0.0
        );
    }

    /**
     * Obtiene el carrito actual
     */
    getCart() {
        return { ...this.cart };
    }

    /**
     * Obtiene la cantidad total de productos
     */
    getTotalProducts() {
        return this.cart.total_productos;
    }

    /**
     * Obtiene el número de líneas únicas en el carrito
     */
    getUniqueProductCount() {
        return this.cart.productos.length;
    }

    /**
     * Obtiene el importe total
     */
    getTotalAmount() {
        return this.cart.total_importe;
    }

    /**
     * Verifica si el carrito tiene productos
     */
    hasProducts() {
        return this.cart.productos.length > 0;
    }
    
    /**
     * Verifica si el carrito ya fue subido a checkout
     */
    isUploaded() {
        return this.cart.id !== null && this.cart.codigo_qr !== null;
    }

    /**
     * Limpia el carrito
     */
    async clearCart() {
        this.cart = {
            id: null,
            codigo_qr: null,
            productos: [],
            total_productos: 0,
            total_importe: 0.0
        };

        await this.saveCartToStorage();
        console.log('Carrito limpiado');
    }

    /**
     * Guarda productos en el almacenamiento local
     * NORMALIZA códigos a MAYÚSCULAS para búsqueda exacta ultrarrápida
     */
    async saveProductsToStorage(productos) {
        try {
            const transaction = this.db.transaction(['products'], 'readwrite');
            const store = transaction.objectStore('products');

            // Limpiar productos anteriores
            await store.clear();

            // Añadir nuevos productos con códigos normalizados
            let saved = 0;
            for (const producto of productos) {
                // Normalizar código a MAYÚSCULAS
                const normalizedProduct = {
                    ...producto,
                    codigo: producto.codigo.toUpperCase()
                };
                await store.add(normalizedProduct);
                saved++;
            }

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => {
                    console.log(`✅ ${saved} productos guardados (códigos normalizados a MAYÚSCULAS)`);
                    resolve();
                };
                transaction.onerror = () => reject(transaction.error);
            });

        } catch (error) {
            console.error('Error al guardar productos:', error);
            throw error;
        }
    }
    
    /**
     * Guarda códigos secundarios en el almacenamiento local
     * NORMALIZA códigos a MAYÚSCULAS para búsqueda exacta ultrarrápida
     */
    async saveSecondaryCodesToStorage(codigosSecundarios) {
        try {
            if (!codigosSecundarios || codigosSecundarios.length === 0) {
                console.warn('⚠️ No hay códigos secundarios para guardar');
                return;
            }
            
            console.log(`📝 Guardando ${codigosSecundarios.length} códigos secundarios...`);
            
            const transaction = this.db.transaction(['secondary_codes'], 'readwrite');
            const store = transaction.objectStore('secondary_codes');

            // Limpiar códigos anteriores
            await store.clear();

            // Añadir nuevos códigos con normalización
            let saved = 0;
            for (const codigo of codigosSecundarios) {
                try {
                    // Normalizar códigos a MAYÚSCULAS (NO incluir 'id', se auto-genera)
                    const normalizedCode = {
                        codigo_secundario: codigo.codigo_secundario.toUpperCase(),
                        codigo_principal: codigo.codigo_principal.toUpperCase(),
                        descripcion: codigo.descripcion || ''
                    };
                    store.add(normalizedCode); // Sin await para mejor performance
                    saved++;
                    
                    // Log de los primeros 3 para debug
                    if (saved <= 3) {
                        console.log(`  📌 Ejemplo ${saved}: ${normalizedCode.codigo_secundario} → ${normalizedCode.codigo_principal}`);
                    }
                } catch (err) {
                    console.error(`❌ Error al guardar código secundario:`, codigo, err);
                }
            }

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => {
                    console.log(`✅ ${saved} códigos secundarios guardados (normalizados a MAYÚSCULAS)`);
                    resolve();
                };
                transaction.onerror = () => {
                    console.error('❌ Error en transacción de códigos secundarios:', transaction.error);
                    reject(transaction.error);
                };
            });

        } catch (error) {
            console.error('Error al guardar códigos secundarios:', error);
            throw error;
        }
    }

    /**
     * Busca productos en el almacenamiento local
     */
    async searchProductsLocal(searchTerm) {
        try {
            const transaction = this.db.transaction(['products'], 'readonly');
            const store = transaction.objectStore('products');
            const request = store.getAll();

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const productos = request.result;
                    const searchLower = searchTerm.toLowerCase();

                    const filtered = productos.filter(p => 
                        p.codigo.toLowerCase().includes(searchLower) ||
                        p.descripcion.toLowerCase().includes(searchLower)
                    );

                    resolve(filtered);
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error al buscar productos localmente:', error);
            return [];
        }
    }

    /**
     * Búsqueda inteligente por código: Prioriza match exacto
     * Si existe match exacto, solo muestra ese. Si no, muestra parciales
     */
    async searchByCodeSmart(code) {
        try {
            const transaction = this.db.transaction(['products'], 'readonly');
            const store = transaction.objectStore('products');
            const request = store.getAll();

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const productos = request.result;
                    const codeUpper = code.toUpperCase().trim();

                    // Buscar match exacto primero
                    const exactMatch = productos.find(p => 
                        p.codigo.toUpperCase() === codeUpper
                    );

                    // Si hay match exacto, devolver solo ese
                    if (exactMatch) {
                        resolve([exactMatch]);
                        return;
                    }

                    // Si no hay match exacto, buscar parciales
                    const partialMatches = productos.filter(p => 
                        p.codigo.toUpperCase().includes(codeUpper)
                    );

                    resolve(partialMatches);
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error en búsqueda por código:', error);
            return [];
        }
    }

    /**
     * Búsqueda por descripción: Debe contener TODAS las palabras (en cualquier orden)
     */
    async searchByDescriptionAllWords(description) {
        try {
            const transaction = this.db.transaction(['products'], 'readonly');
            const store = transaction.objectStore('products');
            const request = store.getAll();

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const productos = request.result;
                    
                    // Separar en palabras y normalizar
                    const words = description
                        .toLowerCase()
                        .trim()
                        .split(/\s+/)
                        .filter(w => w.length > 0);

                    if (words.length === 0) {
                        resolve([]);
                        return;
                    }

                    // Filtrar productos que contengan TODAS las palabras
                    const filtered = productos.filter(p => {
                        const descLower = p.descripcion.toLowerCase();
                        return words.every(word => descLower.includes(word));
                    });

                    resolve(filtered);
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error en búsqueda por descripción:', error);
            return [];
        }
    }
    
    /**
     * Búsqueda EXACTA ultrarrápida por código
     * Usa índices de IndexedDB para búsqueda instantánea (igual que mobile_reader)
     */
    async searchProductsExact(code) {
        try {
            if (!code || !code.trim()) return [];
            const normalizedCode = code.toUpperCase().trim();
            
            console.log('🔍 Búsqueda exacta por código:', normalizedCode);
            
            const results = [];
            const seen = new Set();
            
            // 1. Búsqueda directa en productos (código principal) - INSTANTÁNEA
            const productoPrincipal = await new Promise((resolve) => {
                const tx = this.db.transaction(['products'], 'readonly');
                const store = tx.objectStore('products');
                const req = store.get(normalizedCode);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => {
                    console.error('❌ Error en búsqueda de productos:', req.error);
                    resolve(null);
                };
            });
            
            if (productoPrincipal) {
                console.log('✅ Encontrado en productos:', productoPrincipal.codigo);
                results.push(productoPrincipal);
                seen.add(productoPrincipal.codigo);
            } else {
                console.log('❌ No encontrado en productos (código principal)');
            }
            
            // 2. Búsqueda directa en códigos secundarios (EAN) usando índice - INSTANTÁNEA
            console.log('🔍 Buscando en códigos secundarios...');
            const codigoSecundario = await new Promise((resolve) => {
                const tx = this.db.transaction(['secondary_codes'], 'readonly');
                const store = tx.objectStore('secondary_codes');
                const index = store.index('codigo_secundario');
                const req = index.get(normalizedCode);
                req.onsuccess = () => {
                    const result = req.result;
                    if (result) {
                        console.log('✅ Encontrado en códigos secundarios:', result);
                    } else {
                        console.log('❌ No encontrado en códigos secundarios');
                    }
                    resolve(result || null);
                };
                req.onerror = () => {
                    console.error('❌ Error en búsqueda de códigos secundarios:', req.error);
                    resolve(null);
                };
            });
            
            if (codigoSecundario && !seen.has(codigoSecundario.codigo_principal)) {
                console.log('📦 Obteniendo producto principal:', codigoSecundario.codigo_principal);
                // Obtener el producto principal
                const productoPrincipal = await new Promise((resolve) => {
                    const tx = this.db.transaction(['products'], 'readonly');
                    const store = tx.objectStore('products');
                    const req = store.get(codigoSecundario.codigo_principal);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => {
                        console.error('❌ Error al obtener producto principal:', req.error);
                        resolve(null);
                    };
                });
                
                if (productoPrincipal) {
                    console.log('✅ Producto principal encontrado:', productoPrincipal.codigo);
                    results.push(productoPrincipal);
                    seen.add(productoPrincipal.codigo);
                } else {
                    console.error('❌ Producto principal no encontrado en base de datos');
                }
            }
            
            console.log(`✅ Búsqueda exacta completada: ${results.length} resultado(s)`);
            return results;
            
        } catch (error) {
            console.error('❌ Error en searchProductsExact:', error);
            return [];
        }
    }
    
    /**
     * Normaliza texto para búsqueda (elimina acentos, espacios extra, etc.)
     */
    normalizeText(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
            .replace(/\s+/g, ' ') // Normalizar espacios
            .trim();
    }

    /**
     * ========================================
     * FUNCIONES PARA PEDIDOS REMOTOS (CACHE OFFLINE)
     * ========================================
     */

    /**
     * Guarda los pedidos remotos en IndexedDB
     */
    async saveRemoteOrdersToCache(pedidos, usuarioId) {
        try {
            if (!this.db) return false;

            console.log('💾 Guardando pedidos en caché para usuario:', usuarioId);
            console.log('📥 Pedidos recibidos:', pedidos?.length || 0);

            // PASO 1: Eliminar todos los pedidos antiguos del usuario
            console.log('🗑️ Limpiando pedidos antiguos del caché...');
            
            const transaction1 = this.db.transaction(['remote_orders'], 'readwrite');
            const store1 = transaction1.objectStore('remote_orders');
            const index1 = store1.index('usuario_id');
            
            const oldOrders = await new Promise((resolve, reject) => {
                const request = index1.getAll(usuarioId);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            console.log(`📦 Encontrados ${oldOrders.length} pedidos antiguos para eliminar`);

            // Eliminar uno por uno
            for (const oldOrder of oldOrders) {
                const transaction2 = this.db.transaction(['remote_orders'], 'readwrite');
                const store2 = transaction2.objectStore('remote_orders');
                
                await new Promise((resolve, reject) => {
                    const deleteRequest = store2.delete(oldOrder.id);
                    deleteRequest.onsuccess = () => resolve();
                    deleteRequest.onerror = () => reject(deleteRequest.error);
                });
            }
            console.log(`✅ ${oldOrders.length} pedidos antiguos eliminados del caché`);

            // PASO 2: Guardar los nuevos pedidos
            if (pedidos && pedidos.length > 0) {
                for (const pedido of pedidos) {
                    const transaction3 = this.db.transaction(['remote_orders'], 'readwrite');
                    const store3 = transaction3.objectStore('remote_orders');
                    
                    const pedidoConCache = {
                        ...pedido,
                        usuario_id: usuarioId,
                        cached_at: new Date().toISOString()
                    };
                    
                    await new Promise((resolve, reject) => {
                        const putRequest = store3.put(pedidoConCache);
                        putRequest.onsuccess = () => resolve();
                        putRequest.onerror = () => reject(putRequest.error);
                    });
                }
                console.log(`✅ ${pedidos.length} pedidos nuevos guardados en caché`);
            } else {
                console.log('⚠️ No hay pedidos para guardar en caché');
            }

            return true;

        } catch (error) {
            console.error('❌ Error al guardar pedidos en caché:', error);
            console.error('Stack:', error.stack);
            return false;
        }
    }

    /**
     * Carga los pedidos remotos desde IndexedDB
     */
    async loadRemoteOrdersFromCache(usuarioId) {
        try {
            if (!this.db) return [];

            const transaction = this.db.transaction(['remote_orders'], 'readonly');
            const store = transaction.objectStore('remote_orders');
            const index = store.index('usuario_id');
            const request = index.getAll(usuarioId);

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const pedidos = request.result || [];
                    // Ordenar por fecha más reciente primero
                    pedidos.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));
                    console.log(`📦 ${pedidos.length} pedidos cargados desde caché`);
                    resolve(pedidos);
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error al cargar pedidos desde caché:', error);
            return [];
        }
    }

    /**
     * Guarda los productos de un pedido en IndexedDB
     */
    async saveOrderProductsToCache(carritoId, productos) {
        try {
            if (!this.db || !productos || productos.length === 0) return;

            const transaction = this.db.transaction(['remote_order_products'], 'readwrite');
            const store = transaction.objectStore('remote_order_products');

            // Limpiar productos anteriores de este pedido
            const index = store.index('carrito_id');
            const clearRequest = index.openCursor(IDBKeyRange.only(carritoId));
            
            await new Promise((resolve) => {
                clearRequest.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
            });

            // Guardar nuevos productos
            for (const producto of productos) {
                const productoConCache = {
                    ...producto,
                    carrito_id: carritoId,
                    cached_at: new Date().toISOString()
                };
                await store.add(productoConCache);
            }

            console.log(`✅ ${productos.length} productos del pedido ${carritoId} guardados en caché`);
            return true;

        } catch (error) {
            console.error('Error al guardar productos del pedido en caché:', error);
            return false;
        }
    }

    /**
     * Carga los productos de un pedido desde IndexedDB
     */
    async loadOrderProductsFromCache(carritoId) {
        try {
            if (!this.db) return [];

            const transaction = this.db.transaction(['remote_order_products'], 'readonly');
            const store = transaction.objectStore('remote_order_products');
            const index = store.index('carrito_id');
            const request = index.getAll(carritoId);

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const productos = request.result || [];
                    console.log(`📦 ${productos.length} productos del pedido ${carritoId} cargados desde caché`);
                    resolve(productos);
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error al cargar productos del pedido desde caché:', error);
            return [];
        }
    }

    /**
     * Actualiza el estado de un pedido en caché
     */
    async updateOrderStatusInCache(carritoId, nuevoEstado) {
        try {
            if (!this.db) return false;

            const transaction = this.db.transaction(['remote_orders'], 'readwrite');
            const store = transaction.objectStore('remote_orders');
            const request = store.get(carritoId);

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const pedido = request.result;
                    if (pedido) {
                        pedido.estado_procesamiento = nuevoEstado;
                        pedido.cached_at = new Date().toISOString();
                        store.put(pedido);
                        console.log(`✅ Estado del pedido ${carritoId} actualizado a: ${nuevoEstado}`);
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error al actualizar estado del pedido en caché:', error);
            return false;
        }
    }
}

// Crear instancia global
window.cartManager = new CartManager();
console.log('🛒 Cart Manager creado');

