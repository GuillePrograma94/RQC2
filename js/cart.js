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
            const request = indexedDB.open(this.dbName, 6); // v6: Añadir store de stock

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
                
                // Crear object store para ofertas (caché local)
                if (!db.objectStoreNames.contains('ofertas')) {
                    const ofertasStore = db.createObjectStore('ofertas', { keyPath: 'numero_oferta' });
                    ofertasStore.createIndex('tipo_oferta', 'tipo_oferta', { unique: false });
                    ofertasStore.createIndex('activa', 'activa', { unique: false });
                }
                
                // Crear object store para productos en ofertas (caché local)
                if (!db.objectStoreNames.contains('ofertas_productos')) {
                    const ofertasProductosStore = db.createObjectStore('ofertas_productos', { keyPath: 'id', autoIncrement: true });
                    ofertasProductosStore.createIndex('numero_oferta', 'numero_oferta', { unique: false });
                    ofertasProductosStore.createIndex('codigo_articulo', 'codigo_articulo', { unique: false });
                }
                
                // Crear object store para intervalos de ofertas (caché local)
                if (!db.objectStoreNames.contains('ofertas_intervalos')) {
                    const intervalosStore = db.createObjectStore('ofertas_intervalos', { keyPath: 'id', autoIncrement: true });
                    intervalosStore.createIndex('numero_oferta', 'numero_oferta', { unique: false });
                }
                
                // Crear object store para detalles de ofertas (caché local)
                if (!db.objectStoreNames.contains('ofertas_detalles')) {
                    const detallesStore = db.createObjectStore('ofertas_detalles', { keyPath: 'id', autoIncrement: true });
                    detallesStore.createIndex('numero_oferta', 'numero_oferta', { unique: false });
                    detallesStore.createIndex('campo', 'campo', { unique: false });
                }
                
            // Crear object store para grupos de ofertas (caché local)
            if (!db.objectStoreNames.contains('ofertas_grupos_asignaciones')) {
                const gruposStore = db.createObjectStore('ofertas_grupos_asignaciones', { keyPath: 'id', autoIncrement: true });
                gruposStore.createIndex('numero_oferta', 'numero_oferta', { unique: false });
                gruposStore.createIndex('codigo_grupo', 'codigo_grupo', { unique: false });
                console.log('Object store ofertas_grupos_asignaciones creado con indices');
            }

            // v6: stock por articulo (agrupado: stock_global + por_almacen)
            if (!db.objectStoreNames.contains('stock')) {
                db.createObjectStore('stock', { keyPath: 'codigo_articulo' });
                console.log('Object store stock creado');
            }
                
                console.log('Esquema de base de datos creado/actualizado');
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
     * Optimizado: pre-normaliza fuera de la transacción para reducir bloqueo de la UI
     */
    async saveProductsToStorage(productos) {
        try {
            if (!productos || productos.length === 0) {
                console.warn('⚠️ No hay productos para guardar');
                return;
            }

            // Pre-normalizar FUERA de la transacción para no bloquear la UI
            const normalizedList = productos.map(function (p) {
                return Object.assign({}, p, { codigo: (p.codigo || '').toUpperCase() });
            });

            console.log(`📝 Guardando ${normalizedList.length} productos...`);

            const db = this.db;
            await new Promise(function (resolve, reject) {
                const transaction = db.transaction(['products'], 'readwrite');
                const store = transaction.objectStore('products');
                store.clear();
                for (let i = 0; i < normalizedList.length; i++) {
                    store.add(normalizedList[i]);
                }
                transaction.oncomplete = function () {
                    console.log(`✅ ${normalizedList.length} productos guardados (códigos normalizados a MAYÚSCULAS)`);
                    resolve();
                };
                transaction.onerror = function () { reject(transaction.error); };
            });

        } catch (error) {
            console.error('Error al guardar productos:', error);
            throw error;
        }
    }

    /**
     * Actualiza productos de forma incremental (sin limpiar todo)
     * Inserta nuevos productos y actualiza los existentes
     * Mucho más rápido que reemplazar toda la tabla
     */
    async updateProductsIncremental(productos) {
        try {
            if (!productos || productos.length === 0) {
                console.log('⚠️ No hay productos para actualizar');
                return { inserted: 0, updated: 0 };
            }

            const transaction = this.db.transaction(['products'], 'readwrite');
            const store = transaction.objectStore('products');

            let inserted = 0;
            let updated = 0;

            return new Promise((resolve, reject) => {
                const processNext = async (index) => {
                    if (index >= productos.length) {
                        transaction.oncomplete = () => {
                            console.log(`✅ Actualización incremental: ${inserted} insertados, ${updated} actualizados`);
                            resolve({ inserted, updated });
                        };
                        transaction.onerror = () => reject(transaction.error);
                        return;
                    }

                    const producto = productos[index];
                    const normalizedProduct = {
                        ...producto,
                        codigo: producto.codigo.toUpperCase()
                    };

                    // Intentar obtener producto existente
                    const getRequest = store.get(normalizedProduct.codigo);
                    
                    getRequest.onsuccess = () => {
                        if (getRequest.result) {
                            // Producto existe, actualizar
                            store.put(normalizedProduct);
                            updated++;
                        } else {
                            // Producto nuevo, insertar
                            store.add(normalizedProduct);
                            inserted++;
                        }
                        // Procesar siguiente
                        processNext(index + 1);
                    };

                    getRequest.onerror = () => {
                        console.error(`Error al verificar producto ${normalizedProduct.codigo}:`, getRequest.error);
                        // Intentar insertar de todas formas
                        try {
                            store.add(normalizedProduct);
                            inserted++;
                        } catch (err) {
                            // Si falla, probablemente ya existe, intentar actualizar
                            try {
                                store.put(normalizedProduct);
                                updated++;
                            } catch (err2) {
                                console.error(`Error al insertar/actualizar ${normalizedProduct.codigo}:`, err2);
                            }
                        }
                        processNext(index + 1);
                    };
                };

                // Iniciar procesamiento
                processNext(0);
            });

        } catch (error) {
            console.error('Error al actualizar productos incrementalmente:', error);
            throw error;
        }
    }
    
    /**
     * Guarda códigos secundarios en el almacenamiento local
     * NORMALIZA códigos a MAYÚSCULAS para búsqueda exacta ultrarrápida
     * Optimizado: pre-normaliza fuera de transacciones y escribe por chunks para no bloquear la UI
     */
    async saveSecondaryCodesToStorage(codigosSecundarios) {
        try {
            if (!codigosSecundarios || codigosSecundarios.length === 0) {
                console.warn('⚠️ No hay códigos secundarios para guardar');
                return;
            }

            // Pre-normalizar FUERA de transacciones para no bloquear la UI
            const normalizedList = codigosSecundarios.map(function (c) {
                return {
                    codigo_secundario: (c.codigo_secundario || '').toUpperCase(),
                    codigo_principal: (c.codigo_principal || '').toUpperCase(),
                    descripcion: c.descripcion || ''
                };
            });

            console.log(`📝 Guardando ${normalizedList.length} códigos secundarios...`);
            if (normalizedList.length >= 3) {
                console.log(`  📌 Ejemplo 1: ${normalizedList[0].codigo_secundario} → ${normalizedList[0].codigo_principal}`);
            }

            const CHUNK_SIZE = 2500;
            const db = this.db;
            let offset = 0;

            // Primera transacción: clear + primer chunk
            await new Promise(function (resolve, reject) {
                const transaction = db.transaction(['secondary_codes'], 'readwrite');
                const store = transaction.objectStore('secondary_codes');
                store.clear();
                const end = Math.min(CHUNK_SIZE, normalizedList.length);
                for (let i = 0; i < end; i++) {
                    store.add(normalizedList[i]);
                }
                transaction.oncomplete = function () { resolve(); };
                transaction.onerror = function () { reject(transaction.error); };
            });
            offset = Math.min(CHUNK_SIZE, normalizedList.length);

            // Chunks siguientes: permitir que la UI se actualice entre transacciones
            while (offset < normalizedList.length) {
                await new Promise(function (r) { setTimeout(r, 0); });
                await new Promise(function (resolve, reject) {
                    const transaction = db.transaction(['secondary_codes'], 'readwrite');
                    const store = transaction.objectStore('secondary_codes');
                    const end = Math.min(offset + CHUNK_SIZE, normalizedList.length);
                    for (let i = offset; i < end; i++) {
                        store.add(normalizedList[i]);
                    }
                    transaction.oncomplete = function () { resolve(); };
                    transaction.onerror = function () { reject(transaction.error); };
                });
                offset += CHUNK_SIZE;
            }

            console.log(`✅ ${normalizedList.length} códigos secundarios guardados (normalizados a MAYÚSCULAS)`);
        } catch (error) {
            console.error('Error al guardar códigos secundarios:', error);
            throw error;
        }
    }

    /**
     * Actualiza códigos secundarios de forma incremental (sin limpiar todo)
     * Inserta nuevos códigos y actualiza los existentes
     */
    async updateSecondaryCodesIncremental(codigosSecundarios) {
        try {
            if (!codigosSecundarios || codigosSecundarios.length === 0) {
                console.log('⚠️ No hay códigos secundarios para actualizar');
                return { inserted: 0, updated: 0 };
            }

            const transaction = this.db.transaction(['secondary_codes'], 'readwrite');
            const store = transaction.objectStore('secondary_codes');
            const index = store.index('codigo_secundario');

            let inserted = 0;
            let updated = 0;

            return new Promise((resolve, reject) => {
                const processNext = async (indexIdx) => {
                    if (indexIdx >= codigosSecundarios.length) {
                        transaction.oncomplete = () => {
                            console.log(`✅ Actualización incremental códigos: ${inserted} insertados, ${updated} actualizados`);
                            resolve({ inserted, updated });
                        };
                        transaction.onerror = () => reject(transaction.error);
                        return;
                    }

                    const codigo = codigosSecundarios[indexIdx];
                    const normalizedCode = {
                        codigo_secundario: codigo.codigo_secundario.toUpperCase(),
                        codigo_principal: codigo.codigo_principal.toUpperCase(),
                        descripcion: codigo.descripcion || ''
                    };

                    // Buscar código existente por índice
                    const getRequest = index.get(normalizedCode.codigo_secundario);
                    
                    getRequest.onsuccess = () => {
                        if (getRequest.result) {
                            // Código existe, actualizar (usar put con el ID existente)
                            const updatedCode = {
                                ...normalizedCode,
                                id: getRequest.result.id
                            };
                            store.put(updatedCode);
                            updated++;
                        } else {
                            // Código nuevo, insertar
                            store.add(normalizedCode);
                            inserted++;
                        }
                        // Procesar siguiente
                        processNext(indexIdx + 1);
                    };

                    getRequest.onerror = () => {
                        // Si hay error, intentar insertar
                        try {
                            store.add(normalizedCode);
                            inserted++;
                        } catch (err) {
                            console.error(`Error al insertar código ${normalizedCode.codigo_secundario}:`, err);
                        }
                        processNext(indexIdx + 1);
                    };
                };

                // Iniciar procesamiento
                processNext(0);
            });

        } catch (error) {
            console.error('Error al actualizar códigos secundarios incrementalmente:', error);
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
     * Obtiene un producto por codigo (solo almacen local). Sin logs. Para configuradores (WC Completo).
     */
    async getProductByCodigo(codigo) {
        try {
            if (!codigo || !codigo.trim() || !this.db) return null;
            const normalizedCode = (codigo.trim()).toUpperCase();
            return new Promise((resolve) => {
                const tx = this.db.transaction(['products'], 'readonly');
                const store = tx.objectStore('products');
                const req = store.get(normalizedCode);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    }

    /**
     * Resuelve un codigo (principal o secundario/EAN) al codigo principal de producto. Sin logs.
     * Para Panel de Control WC: permite anadir por codigo o por EAN.
     * @returns {Promise<string|null>} codigo principal o null si no se encuentra
     */
    async resolveToPrincipalCode(codigo) {
        try {
            if (!codigo || !codigo.trim() || !this.db) return null;
            const normalizedCode = (codigo.trim()).toUpperCase();
            const enProductos = await new Promise((resolve) => {
                const tx = this.db.transaction(['products'], 'readonly');
                const store = tx.objectStore('products');
                const req = store.get(normalizedCode);
                req.onsuccess = () => resolve(!!req.result);
                req.onerror = () => resolve(false);
            });
            if (enProductos) return normalizedCode;
            const enSecundarios = await new Promise((resolve) => {
                const tx = this.db.transaction(['secondary_codes'], 'readonly');
                const store = tx.objectStore('secondary_codes');
                const index = store.index('codigo_secundario');
                const req = index.get(normalizedCode);
                req.onsuccess = () => resolve(req.result ? req.result.codigo_principal : null);
                req.onerror = () => resolve(null);
            });
            return enSecundarios || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Resuelve codigo (principal o secundario) y devuelve datos para mostrar: codigo principal, descripcion, pvp y si el input era secundario.
     * Para Panel de Control: buscar y mostrar "00R1ONBL9 - Tanque ONA... (A341680000)" antes de anadir.
     * @returns {Promise<{ principalCode: string, descripcion: string, pvp: number, matchedSecondary: string|null }|null>}
     */
    async resolveToPrincipalCodeWithDetails(codigo) {
        try {
            if (!codigo || !codigo.trim() || !this.db) return null;
            const normalizedCode = (codigo.trim()).toUpperCase();
            const product = await this.getProductByCodigo(normalizedCode);
            if (product) {
                return {
                    principalCode: product.codigo,
                    descripcion: product.descripcion || '',
                    pvp: product.pvp != null ? product.pvp : 0,
                    matchedSecondary: null
                };
            }
            const sec = await new Promise((resolve) => {
                const tx = this.db.transaction(['secondary_codes'], 'readonly');
                const store = tx.objectStore('secondary_codes');
                const index = store.index('codigo_secundario');
                const req = index.get(normalizedCode);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
            if (!sec) return null;
            const productPrincipal = await this.getProductByCodigo(sec.codigo_principal);
            if (!productPrincipal) return null;
            return {
                principalCode: sec.codigo_principal,
                descripcion: productPrincipal.descripcion || '',
                pvp: productPrincipal.pvp != null ? productPrincipal.pvp : 0,
                matchedSecondary: normalizedCode
            };
        } catch (e) {
            return null;
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
     * Busca productos por código de fabricante (códigos secundarios que NO son EAN).
     * Un EAN es una cadena puramente numérica de 8, 12, 13 o 14 dígitos.
     * La búsqueda es parcial (contiene el término) e insensible a mayúsculas.
     * Devuelve array de productos (objetos del store 'products').
     */
    async searchByManufacturerCode(query) {
        if (!this.db || !query || !query.trim()) return [];
        const EAN_REGEX = /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/;
        const normalizedQuery = query.trim().toLowerCase();
        try {
            const allSecondary = await new Promise((resolve, reject) => {
                const tx = this.db.transaction(['secondary_codes'], 'readonly');
                const store = tx.objectStore('secondary_codes');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });

            const matchingPrincipales = new Set();
            for (const entry of allSecondary) {
                const code = (entry.codigo_secundario || '').trim();
                if (EAN_REGEX.test(code)) continue;
                if (code.toLowerCase().includes(normalizedQuery)) {
                    matchingPrincipales.add(entry.codigo_principal);
                }
            }

            if (matchingPrincipales.size === 0) return [];

            const results = [];
            const tx = this.db.transaction(['products'], 'readonly');
            const store = tx.objectStore('products');

            for (const codigoPrincipal of matchingPrincipales) {
                const producto = await new Promise((resolve) => {
                    const req = store.get(codigoPrincipal);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                });
                if (producto) results.push(producto);
            }

            return results;
        } catch (error) {
            console.error('Error en searchByManufacturerCode:', error);
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

    /**
     * Guarda ofertas en caché local
     */
    async saveOfertasToCache(ofertas) {
        try {
            if (!this.db || !ofertas || ofertas.length === 0) return;

            const transaction = this.db.transaction(['ofertas'], 'readwrite');
            const store = transaction.objectStore('ofertas');

            for (const oferta of ofertas) {
                await store.put({
                    ...oferta,
                    cached_at: new Date().toISOString()
                });
            }

            console.log(`✅ ${ofertas.length} ofertas guardadas en caché`);
            return true;

        } catch (error) {
            console.error('Error al guardar ofertas en caché:', error);
            return false;
        }
    }

    /**
     * Guarda productos en ofertas en caché local
     */
    async saveOfertasProductosToCache(ofertasProductos) {
        try {
            if (!this.db) {
                console.error('❌ DB no disponible para guardar productos en ofertas');
                return false;
            }
            
            if (!ofertasProductos || ofertasProductos.length === 0) {
                console.log('⚠️ No hay productos en ofertas para guardar');
                return false;
            }

            console.log(`💾 Guardando ${ofertasProductos.length} productos en ofertas...`);
            console.log(`   📋 Muestra de productos a guardar:`, ofertasProductos.slice(0, 5));
            
            // Verificar que codigo_articulo está presente
            const sinCodigo = ofertasProductos.filter(op => !op.codigo_articulo);
            if (sinCodigo.length > 0) {
                console.warn(`   ⚠️ ${sinCodigo.length} productos sin codigo_articulo:`, sinCodigo.slice(0, 3));
            }

            const transaction = this.db.transaction(['ofertas_productos'], 'readwrite');
            const store = transaction.objectStore('ofertas_productos');

            // Limpiar todos los productos de ofertas anteriores
            await store.clear();
            console.log('   🗑️ Productos anteriores eliminados');

            let guardados = 0;
            let errores = 0;
            for (const op of ofertasProductos) {
                try {
                    // Normalizar codigo_articulo a mayúsculas
                    const productoNormalizado = {
                        ...op,
                        codigo_articulo: op.codigo_articulo ? op.codigo_articulo.toUpperCase() : null,
                        cached_at: new Date().toISOString()
                    };
                    await store.add(productoNormalizado);
                    guardados++;
                } catch (addError) {
                    errores++;
                    if (errores <= 3) { // Solo mostrar primeros 3 errores
                        console.error(`   ❌ Error al guardar producto:`, op, addError);
                    }
                }
            }

            console.log(`✅ ${guardados}/${ofertasProductos.length} productos en ofertas guardados en caché`);
            if (errores > 0) {
                console.warn(`   ⚠️ ${errores} errores al guardar productos`);
            }
            
            // Verificar que se guardaron correctamente
            const verificacion = await new Promise((resolve) => {
                const verifyRequest = store.count();
                verifyRequest.onsuccess = () => resolve(verifyRequest.result);
                verifyRequest.onerror = () => resolve(0);
            });
            console.log(`   ✓ Verificación: ${verificacion} productos en IndexedDB`);

            return true;

        } catch (error) {
            console.error('❌ Error al guardar productos en ofertas en caché:', error);
            return false;
        }
    }

    /**
     * Obtiene productos en ofertas desde caché local por código de artículo
     */
    async getOfertasProductosFromCache(codigoArticulo) {
        try {
            if (!this.db) return [];

            return new Promise((resolve) => {
                const transaction = this.db.transaction(['ofertas_productos'], 'readonly');
                const store = transaction.objectStore('ofertas_productos');
                const index = store.index('codigo_articulo');
                const request = index.getAll(codigoArticulo.toUpperCase());

                request.onsuccess = () => {
                    resolve(request.result || []);
                };

                request.onerror = () => {
                    console.error('Error al obtener ofertas de productos desde cache:', request.error);
                    resolve([]);
                };
            });
        } catch (error) {
            console.error('Error al obtener ofertas de productos:', error);
            return [];
        }
    }

    /**
     * Obtiene TODOS los productos en ofertas accesibles para un cliente
     * Usa para crear un índice rápido de productos con ofertas
     * @param {number} codigoCliente - Código del cliente
     * @returns {Promise<Array>} - Lista de productos en ofertas
     */
    async getAllOfertasProductosFromCache(codigoCliente) {
        try {
            if (!this.db) {
                console.log('⚠️ DB no disponible');
                return [];
            }

            console.log(`🔍 Buscando TODAS las ofertas para cliente ${codigoCliente}...`);

            const transaction = this.db.transaction(['ofertas_productos', 'ofertas', 'ofertas_grupos_asignaciones'], 'readonly');
            const productosStore = transaction.objectStore('ofertas_productos');
            const ofertasStore = transaction.objectStore('ofertas');
            const gruposStore = transaction.objectStore('ofertas_grupos_asignaciones');

            // 1. Obtener TODAS las asignaciones de grupo (sin filtrar por índice primero)
            const todasAsignaciones = await new Promise((resolve) => {
                const request = gruposStore.getAll();
                request.onsuccess = () => {
                    const results = request.result || [];
                    console.log(`   📊 Total asignaciones en DB: ${results.length}`);
                    if (results.length > 0) {
                        console.log(`   📋 Muestra de asignaciones:`, results.slice(0, 3));
                    }
                    resolve(results);
                };
                request.onerror = () => {
                    console.error('   ❌ Error al obtener asignaciones:', request.error);
                    resolve([]);
                };
            });

            // 2. Filtrar manualmente las asignaciones para este cliente
            const codigoClienteNum = parseInt(codigoCliente);
            const asignaciones = todasAsignaciones.filter(a => {
                const codigoGrupoNum = parseInt(a.codigo_grupo);
                return codigoGrupoNum === codigoClienteNum;
            });

            console.log(`   🔐 Asignaciones para cliente ${codigoCliente}: ${asignaciones.length}`);
            
            if (asignaciones.length === 0) {
                console.log(`   ⚠️ Cliente ${codigoCliente} no tiene asignaciones de grupo`);
                return [];
            }

            // 3. Crear Set de números de oferta accesibles
            const ofertasAccesibles = new Set(asignaciones.map(a => a.numero_oferta));
            console.log(`   ✅ Cliente ${codigoCliente} tiene acceso a ${ofertasAccesibles.size} ofertas:`, Array.from(ofertasAccesibles).slice(0, 10));

            // 4. Obtener TODOS los productos en ofertas
            const todosProductos = await new Promise((resolve) => {
                const request = productosStore.getAll();
                request.onsuccess = () => {
                    const results = request.result || [];
                    console.log(`   📦 Total productos en ofertas: ${results.length}`);
                    resolve(results);
                };
                request.onerror = () => resolve([]);
            });

            // 5. Filtrar solo los productos de ofertas accesibles y activas
            const resultado = [];
            const ofertasVerificadas = new Set();
            
            for (const producto of todosProductos) {
                if (ofertasAccesibles.has(producto.numero_oferta)) {
                    // Verificar que la oferta esté activa (cachear resultado)
                    if (!ofertasVerificadas.has(producto.numero_oferta)) {
                        const oferta = await new Promise((resolve) => {
                            const request = ofertasStore.get(producto.numero_oferta);
                            request.onsuccess = () => resolve(request.result);
                            request.onerror = () => resolve(null);
                        });

                        if (oferta && oferta.activa) {
                            ofertasVerificadas.add(producto.numero_oferta);
                        }
                    }

                    if (ofertasVerificadas.has(producto.numero_oferta)) {
                        resultado.push({
                            codigo_articulo: producto.codigo_articulo,
                            numero_oferta: producto.numero_oferta,
                            descuento_oferta: producto.descuento_oferta
                        });
                    }
                }
            }

            console.log(`✅ ${resultado.length} productos con ofertas accesibles para cliente ${codigoCliente}`);
            if (resultado.length > 0) {
                console.log(`   📋 Muestra de productos con ofertas:`, resultado.slice(0, 5).map(r => r.codigo_articulo));
            }
            
            return resultado;

        } catch (error) {
            console.error('❌ Error al obtener todos los productos en ofertas:', error);
            return [];
        }
    }

    /**
     * Guarda intervalos de ofertas en caché local
     */
    async saveOfertasIntervalosToCache(intervalos) {
        try {
            if (!this.db) {
                console.error('❌ DB no disponible para guardar intervalos');
                return false;
            }
            
            if (!intervalos || intervalos.length === 0) {
                console.log('⚠️ No hay intervalos de ofertas para guardar');
                return false;
            }

            console.log(`💾 Guardando ${intervalos.length} intervalos de ofertas...`);
            console.log(`   📋 Muestra de intervalos a guardar:`, intervalos.slice(0, 3));
            
            // Verificar que tienen los campos necesarios
            const sinDescuento = intervalos.filter(i => i.descuento_porcentaje === undefined || i.descuento_porcentaje === null);
            if (sinDescuento.length > 0) {
                console.warn(`   ⚠️ ${sinDescuento.length} intervalos sin descuento_porcentaje:`, sinDescuento.slice(0, 3));
            }

            const transaction = this.db.transaction(['ofertas_intervalos'], 'readwrite');
            const store = transaction.objectStore('ofertas_intervalos');

            // Limpiar intervalos anteriores
            await store.clear();
            console.log('   🗑️ Intervalos anteriores eliminados');

            let guardados = 0;
            for (const intervalo of intervalos) {
                try {
                    await store.add({
                        ...intervalo,
                        cached_at: new Date().toISOString()
                    });
                    guardados++;
                } catch (addError) {
                    console.error(`   ❌ Error al guardar intervalo:`, intervalo, addError);
                }
            }

            console.log(`✅ ${guardados}/${intervalos.length} intervalos de ofertas guardados en caché`);
            
            // Verificar que se guardaron correctamente
            const verificacion = await new Promise((resolve) => {
                const verifyRequest = store.count();
                verifyRequest.onsuccess = () => resolve(verifyRequest.result);
                verifyRequest.onerror = () => resolve(0);
            });
            console.log(`   ✓ Verificación: ${verificacion} intervalos en IndexedDB`);

            return true;

        } catch (error) {
            console.error('❌ Error al guardar intervalos en caché:', error);
            return false;
        }
    }

    /**
     * Guarda detalles de ofertas en caché local
     */
    async saveOfertasDetallesToCache(detalles) {
        try {
            if (!this.db || !detalles || detalles.length === 0) return;

            const transaction = this.db.transaction(['ofertas_detalles'], 'readwrite');
            const store = transaction.objectStore('ofertas_detalles');

            // Limpiar detalles anteriores
            await store.clear();

            for (const detalle of detalles) {
                await store.add({
                    ...detalle,
                    cached_at: new Date().toISOString()
                });
            }

            console.log(`✅ ${detalles.length} detalles de ofertas guardados en caché`);
            return true;

        } catch (error) {
            console.error('Error al guardar detalles en caché:', error);
            return false;
        }
    }

    /**
     * Guarda asignaciones de grupos de ofertas en caché local
     */
    async saveOfertasGruposToCache(asignaciones) {
        try {
            if (!this.db) {
                console.error('❌ DB no disponible para guardar asignaciones');
                return false;
            }

            if (!asignaciones || asignaciones.length === 0) {
                console.log('⚠️ No hay asignaciones de grupos para guardar');
                return false;
            }

            console.log(`💾 Guardando ${asignaciones.length} asignaciones de grupos...`);
            console.log(`   📋 Muestra de asignaciones a guardar:`, asignaciones.slice(0, 3));

            const transaction = this.db.transaction(['ofertas_grupos_asignaciones'], 'readwrite');
            const store = transaction.objectStore('ofertas_grupos_asignaciones');

            // Limpiar asignaciones anteriores
            await store.clear();
            console.log('   🗑️ Asignaciones anteriores eliminadas');

            let guardadas = 0;
            for (const asignacion of asignaciones) {
                try {
                    await store.add({
                        ...asignacion,
                        cached_at: new Date().toISOString()
                    });
                    guardadas++;
                } catch (addError) {
                    console.error(`   ❌ Error al guardar asignación:`, asignacion, addError);
                }
            }

            console.log(`✅ ${guardadas}/${asignaciones.length} asignaciones de grupos guardadas en caché`);
            
            // Verificar que se guardaron correctamente
            const verificacion = await new Promise((resolve) => {
                const verifyRequest = store.count();
                verifyRequest.onsuccess = () => resolve(verifyRequest.result);
                verifyRequest.onerror = () => resolve(0);
            });
            console.log(`   ✓ Verificación: ${verificacion} asignaciones en IndexedDB`);

            return true;

        } catch (error) {
            console.error('❌ Error al guardar asignaciones en caché:', error);
            return false;
        }
    }

    /**
     * Obtiene ofertas de un producto desde caché local
     */
    async getOfertasProductoFromCache(codigoArticulo, codigoCliente = null) {
        try {
            if (!this.db) return [];

            const transaction = this.db.transaction(['ofertas_productos', 'ofertas', 'ofertas_grupos_asignaciones'], 'readonly');
            const productosStore = transaction.objectStore('ofertas_productos');
            const ofertasStore = transaction.objectStore('ofertas');
            const gruposStore = transaction.objectStore('ofertas_grupos_asignaciones');

            // Buscar productos en ofertas con este código
            const codigoUpper = codigoArticulo.toUpperCase();
            const index = productosStore.index('codigo_articulo');
            const productosRequest = index.getAll(codigoUpper);

            return new Promise((resolve, reject) => {
                productosRequest.onsuccess = async () => {
                    const productosOferta = productosRequest.result || [];
                    if (productosOferta.length === 0) {
                        resolve([]);
                        return;
                    }

                    const ofertasEncontradas = [];
                    for (const productoOferta of productosOferta) {
                        const ofertaRequest = ofertasStore.get(productoOferta.numero_oferta);
                        
                        await new Promise((resolveOferta) => {
                            ofertaRequest.onsuccess = () => {
                                const oferta = ofertaRequest.result;
                                if (oferta && oferta.activa) {
                                    // Si hay código de cliente, verificar grupo
                                    if (codigoCliente !== null) {
                                        const gruposIndex = gruposStore.index('numero_oferta');
                                        const gruposRequest = gruposIndex.getAll(productoOferta.numero_oferta);
                                        
                                        gruposRequest.onsuccess = () => {
                                            const grupos = gruposRequest.result || [];
                                            // Normalizar ambos valores a número para comparar
                                            const codigoClienteNum = parseInt(codigoCliente);
                                            const tieneGrupo = grupos.some(g => {
                                                const codigoGrupoNum = parseInt(g.codigo_grupo);
                                                return codigoGrupoNum === codigoClienteNum;
                                            });
                                            
                                            if (tieneGrupo) {
                                                ofertasEncontradas.push({
                                                    numero_oferta: productoOferta.numero_oferta,
                                                    codigo_articulo: productoOferta.codigo_articulo,
                                                    precio: productoOferta.precio,
                                                    descuento_oferta: productoOferta.descuento_oferta,
                                                    unidades_minimas: productoOferta.unidades_minimas,
                                                    unidades_multiplo: productoOferta.unidades_multiplo,
                                                    tipo_oferta: oferta.tipo_oferta,
                                                    tipo_oferta_nombre: oferta.tipo_oferta_nombre,
                                                    titulo_descripcion: oferta.titulo_descripcion,
                                                    descripcion_detallada: oferta.descripcion_detallada
                                                });
                                            }
                                            resolveOferta();
                                        };
                                        
                                        gruposRequest.onerror = () => resolveOferta();
                                    } else {
                                        // Sin código de cliente, mostrar todas las ofertas activas
                                        ofertasEncontradas.push({
                                            numero_oferta: productoOferta.numero_oferta,
                                            precio: productoOferta.precio,
                                            descuento_oferta: productoOferta.descuento_oferta,
                                            unidades_minimas: productoOferta.unidades_minimas,
                                            unidades_multiplo: productoOferta.unidades_multiplo,
                                            tipo_oferta: oferta.tipo_oferta,
                                            tipo_oferta_nombre: oferta.tipo_oferta_nombre,
                                            titulo_descripcion: oferta.titulo_descripcion,
                                            descripcion_detallada: oferta.descripcion_detallada
                                        });
                                        resolveOferta();
                                    }
                                } else {
                                    resolveOferta();
                                }
                            };
                            ofertaRequest.onerror = () => resolveOferta();
                        });
                    }

                    resolve(ofertasEncontradas);
                };
                productosRequest.onerror = () => {
                    console.error('Error al buscar productos en ofertas:', productosRequest.error);
                    reject(productosRequest.error);
                };
            });

        } catch (error) {
            console.error('Error al obtener ofertas desde caché:', error);
            return [];
        }
    }

    /**
     * Obtiene intervalos de una oferta desde caché local
     */
    async getIntervalosOfertaFromCache(numeroOferta) {
        try {
            if (!this.db) return [];

            const transaction = this.db.transaction(['ofertas_intervalos'], 'readonly');
            const store = transaction.objectStore('ofertas_intervalos');
            const index = store.index('numero_oferta');
            const request = index.getAll(numeroOferta);

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const intervalos = request.result || [];
                    intervalos.sort((a, b) => a.desde_unidades - b.desde_unidades);
                    resolve(intervalos);
                };
                request.onerror = () => {
                    console.error('Error al buscar intervalos de oferta:', request.error);
                    reject(request.error);
                };
            });

        } catch (error) {
            console.error('Error al obtener intervalos desde cache:', error);
            return [];
        }
    }

    /**
     * Obtiene el lote de una oferta desde caché local
     */
    async getLoteOfertaFromCache(numeroOferta) {
        try {
            if (!this.db) return null;

            const transaction = this.db.transaction(['ofertas_detalles'], 'readonly');
            const store = transaction.objectStore('ofertas_detalles');
            const indexNumero = store.index('numero_oferta');
            const request = indexNumero.openCursor();
            
            return new Promise((resolve, reject) => {
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const detalle = cursor.value;
                        if (detalle.numero_oferta === numeroOferta && detalle.campo === 'unidades_lote') {
                            if (detalle.valor) {
                                resolve(parseInt(detalle.valor));
                            } else {
                                resolve(null);
                            }
                            return;
                        }
                        cursor.continue();
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => resolve(null);
            });

        } catch (error) {
            console.error('Error al obtener lote desde caché:', error);
            return null;
        }
    }
    // -------------------------------------------------------------------------
    // Metodos de stock
    // -------------------------------------------------------------------------

    /**
     * Guarda en IndexedDB el stock agrupado por articulo.
     * stockData: array de { codigo_articulo, stock_global, por_almacen: { ALMX: N, ... } }
     */
    async saveStockToStorage(stockData) {
        if (!this.db || !stockData || stockData.length === 0) return;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['stock'], 'readwrite');
            const store = tx.objectStore('stock');

            for (const registro of stockData) {
                store.put(registro);
            }

            tx.oncomplete = () => {
                console.log(`Stock guardado: ${stockData.length} articulos en IndexedDB`);
                resolve();
            };
            tx.onerror = () => {
                console.error('Error al guardar stock en IndexedDB:', tx.error);
                reject(tx.error);
            };
        });
    }

    /**
     * Devuelve un Map<codigo_articulo_upper, registro> con todo el stock local.
     * Util para construir el indice al renderizar resultados de busqueda.
     */
    async getStockIndex() {
        if (!this.db) return new Map();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['stock'], 'readonly');
            const store = tx.objectStore('stock');
            const request = store.getAll();

            request.onsuccess = () => {
                const mapa = new Map();
                for (const r of (request.result || [])) {
                    mapa.set(r.codigo_articulo.toUpperCase(), r);
                }
                resolve(mapa);
            };
            request.onerror = () => {
                console.error('Error al leer stock index:', request.error);
                resolve(new Map());
            };
        });
    }

    /**
     * Lookup rapido de stock para un articulo concreto.
     * Devuelve el registro o null si no hay dato.
     */
    async getStockForProduct(codigo) {
        if (!this.db || !codigo) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['stock'], 'readonly');
            const store = tx.objectStore('stock');
            const request = store.get(codigo.toUpperCase());

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
        });
    }

    /**
     * Devuelve la lista de almacenes con datos de stock (sin duplicados, ordenados).
     */
    async getAlmacenesConStock() {
        if (!this.db) return [];

        return new Promise((resolve) => {
            const tx = this.db.transaction(['stock'], 'readonly');
            const store = tx.objectStore('stock');
            const request = store.getAll();

            request.onsuccess = () => {
                const almacenesSet = new Set();
                for (const r of (request.result || [])) {
                    if (r.por_almacen) {
                        for (const alm of Object.keys(r.por_almacen)) {
                            almacenesSet.add(alm);
                        }
                    }
                }
                resolve([...almacenesSet].sort());
            };
            request.onerror = () => resolve([]);
        });
    }
}

// Crear instancia global
window.cartManager = new CartManager();

