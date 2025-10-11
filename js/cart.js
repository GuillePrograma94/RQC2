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
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
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
            
            const cartData = {
                id: 'current',
                ...this.cart
            };

            store.put(cartData);

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });

        } catch (error) {
            console.error('Error al guardar carrito:', error);
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
     */
    async saveProductsToStorage(productos) {
        try {
            const transaction = this.db.transaction(['products'], 'readwrite');
            const store = transaction.objectStore('products');

            // Limpiar productos anteriores
            store.clear();

            // Añadir nuevos productos
            productos.forEach(producto => {
                store.add(producto);
            });

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => {
                    console.log(`${productos.length} productos guardados en almacenamiento local`);
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

                    resolve(filtered.slice(0, window.APP_CONFIG.search.maxResults));
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error al buscar productos localmente:', error);
            return [];
        }
    }
}

// Crear instancia global
window.cartManager = new CartManager();

