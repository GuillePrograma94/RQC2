/**
 * Aplicación principal Scan as You Shop
 */

class ScanAsYouShopApp {
    constructor() {
        this.currentScreen = 'welcome';
        this.isInitialized = false;
    }

    /**
     * Inicializa la aplicación
     */
    async initialize() {
        try {
            console.log('Iniciando Scan as You Shop...');

            window.ui.showLoading('Iniciando aplicacion...');

            // Inicializar Supabase
            const supabaseOK = await window.supabaseClient.initialize();
            if (!supabaseOK) {
                throw new Error('No se pudo conectar con el servidor');
            }

            // Inicializar carrito
            const cartOK = await window.cartManager.initialize();
            if (!cartOK) {
                throw new Error('No se pudo inicializar el carrito');
            }

            // Inicializar scanner
            window.scannerManager.initialize();

            // Inicializar UI
            window.ui.initialize();

            // Configurar pantallas
            this.setupScreens();

            // Empezar directamente en pantalla de escaneo
            this.showScreen('scan');

            this.isInitialized = true;

            window.ui.hideLoading();
            console.log('Aplicacion inicializada correctamente');
            
            // Sincronizar productos EN SEGUNDO PLANO (no bloquea la UI)
            this.syncProductsInBackground();

        } catch (error) {
            console.error('Error al inicializar aplicacion:', error);
            window.ui.hideLoading();
            window.ui.showToast(
                'Error al iniciar la aplicacion. Verifica tu conexion.',
                'error'
            );
        }
    }

    /**
     * Sincroniza productos EN SEGUNDO PLANO (solo si hay cambios)
     */
    async syncProductsInBackground() {
        try {
            // Mostrar indicador discreto
            window.ui.showSyncIndicator(true);
            window.ui.updateSyncIndicator('Verificando...');
            console.log('🔄 Verificando si hay actualizaciones...');

            // Verificar si necesita actualización comparando hashes
            const versionCheck = await window.supabaseClient.verificarActualizacionNecesaria();

            if (!versionCheck.necesitaActualizacion) {
                console.log('✅ Catálogo local actualizado - no se necesita descargar');
                window.ui.showSyncIndicator(false);
                window.ui.showToast('Catálogo actualizado', 'success');
                return;
            }

            console.log('📥 Nueva versión disponible - descargando productos...');
            window.ui.updateSyncIndicator('Descargando...');

            // Callback de progreso
            const onProgress = (progress) => {
                const percent = progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0;
                window.ui.updateSyncIndicator(`${percent}%`);
            };

            const { productos, codigosSecundarios } = await window.supabaseClient.downloadProducts(onProgress);

            // Guardar en almacenamiento local
            window.ui.updateSyncIndicator('Guardando...');
            await window.cartManager.saveProductsToStorage(productos);

            // Actualizar hash local
            await window.supabaseClient.actualizarVersionLocal(versionCheck.versionRemota);

            console.log('✅ Productos sincronizados correctamente');
            window.ui.showSyncIndicator(false);
            window.ui.showToast(`Catálogo actualizado - ${productos.length} productos`, 'success');

        } catch (error) {
            console.error('❌ Error al sincronizar productos:', error);
            window.ui.showSyncIndicator(false);
            // No es crítico, el usuario puede seguir usando la app con datos locales
            // y búsquedas en tiempo real en Supabase
        }
    }

    /**
     * Configura las pantallas
     */
    setupScreens() {
        // Botón escanear producto
        const scanProductBtn = document.getElementById('scanProductBtn');
        if (scanProductBtn) {
            scanProductBtn.addEventListener('click', () => {
                window.scannerManager.scanProduct();
            });
        }

        // Botón ver carrito (header)
        const cartBtn = document.getElementById('cartBtn');
        if (cartBtn) {
            cartBtn.addEventListener('click', () => {
                this.showScreen('cart');
            });
        }

        // Botón volver desde carrito
        const backToScanBtn = document.getElementById('backToScan');
        if (backToScanBtn) {
            backToScanBtn.addEventListener('click', () => {
                this.showScreen('scan');
            });
        }

        // Botón ir a caja (finalizar y escanear QR)
        const finalizePurchaseBtn = document.getElementById('finalizePurchase');
        if (finalizePurchaseBtn) {
            finalizePurchaseBtn.addEventListener('click', () => {
                this.goToCheckout();
            });
        }

        // FAB carrito
        const fabCart = document.getElementById('fabCart');
        if (fabCart) {
            fabCart.addEventListener('click', () => {
                this.showScreen('cart');
            });
        }
    }

    /**
     * Muestra una pantalla específica
     */
    showScreen(screenName) {
        // Ocultar todas las pantallas
        const screens = document.querySelectorAll('.screen');
        screens.forEach(screen => screen.classList.remove('active'));

        // Mostrar pantalla seleccionada
        const targetScreen = document.getElementById(`${screenName}Screen`);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenName;

            // Actualizar contenido según pantalla
            if (screenName === 'cart') {
                this.updateCartView();
            }
        }
    }

    /**
     * Actualiza la vista del carrito
     */
    updateCartView() {
        const cart = window.cartManager.getCart();
        const container = document.getElementById('cartProductsList');
        
        if (!container) return;

        container.innerHTML = '';

        if (cart.productos.length === 0) {
            container.innerHTML = `
                <div class="cart-empty">
                    <div class="cart-empty-icon">🛒</div>
                    <p class="cart-empty-text">Tu carrito esta vacio</p>
                </div>
            `;
            
            // Deshabilitar botón de finalizar
            const finishBtn = document.getElementById('finalizePurchase');
            if (finishBtn) {
                finishBtn.disabled = true;
            }
            
            return;
        }

        // Habilitar botón de finalizar
        const finishBtn = document.getElementById('finalizePurchase');
        if (finishBtn) {
            finishBtn.disabled = false;
        }

        // Añadir productos
        cart.productos.forEach(producto => {
            const card = this.createCartProductCard(producto);
            container.appendChild(card);
        });

        // Actualizar resumen
        this.updateCartSummary(cart);
    }

    /**
     * Crea una tarjeta de producto para el carrito
     */
    createCartProductCard(producto) {
        const card = document.createElement('div');
        card.className = 'product-card';

        const priceWithIVA = producto.precio_unitario * 1.21;
        const subtotalWithIVA = producto.subtotal * 1.21;

        card.innerHTML = `
            <div class="product-header">
                <span class="product-code">${producto.codigo_producto}</span>
                <span class="product-price">${priceWithIVA.toFixed(2)}€</span>
            </div>
            <div class="product-description">${producto.descripcion_producto}</div>
            <div class="product-actions">
                <div class="quantity-controls">
                    <button class="quantity-btn" data-action="decrease" data-code="${producto.codigo_producto}">−</button>
                    <span class="quantity-display">${producto.cantidad}</span>
                    <button class="quantity-btn" data-action="increase" data-code="${producto.codigo_producto}">+</button>
                </div>
                <div class="product-price font-bold">${subtotalWithIVA.toFixed(2)}€</div>
                <button class="remove-btn" data-code="${producto.codigo_producto}">🗑️</button>
            </div>
        `;

        // Añadir event listeners
        const decreaseBtn = card.querySelector('[data-action="decrease"]');
        const increaseBtn = card.querySelector('[data-action="increase"]');
        const removeBtn = card.querySelector('.remove-btn');

        decreaseBtn.addEventListener('click', async () => {
            const newQty = producto.cantidad - 1;
            await this.updateProductQuantity(producto.codigo_producto, newQty);
        });

        increaseBtn.addEventListener('click', async () => {
            const newQty = producto.cantidad + 1;
            await this.updateProductQuantity(producto.codigo_producto, newQty);
        });

        removeBtn.addEventListener('click', async () => {
            await this.removeProduct(producto.codigo_producto);
        });

        return card;
    }

    /**
     * Actualiza el resumen del carrito
     */
    updateCartSummary(cart) {
        const totalItems = document.getElementById('cartTotalItems');
        const subtotal = document.getElementById('cartSubtotal');
        const iva = document.getElementById('cartIVA');
        const total = document.getElementById('cartTotal');

        if (totalItems) {
            totalItems.textContent = cart.total_productos;
        }

        const subtotalAmount = cart.total_importe;
        const ivaAmount = subtotalAmount * 0.21;
        const totalAmount = subtotalAmount + ivaAmount;

        if (subtotal) {
            subtotal.textContent = `${subtotalAmount.toFixed(2)}€`;
        }

        if (iva) {
            iva.textContent = `${ivaAmount.toFixed(2)}€`;
        }

        if (total) {
            total.textContent = `${totalAmount.toFixed(2)}€`;
        }
    }

    /**
     * Actualiza la cantidad de un producto
     */
    async updateProductQuantity(codigoProducto, newQuantity) {
        try {
            window.ui.showLoading('Actualizando...');

            await window.cartManager.updateProductQuantity(codigoProducto, newQuantity);

            window.ui.hideLoading();
            window.ui.updateCartBadge();
            this.updateCartView();

        } catch (error) {
            console.error('Error al actualizar cantidad:', error);
            window.ui.hideLoading();
            window.ui.showToast('Error al actualizar cantidad', 'error');
        }
    }

    /**
     * Elimina un producto del carrito
     */
    async removeProduct(codigoProducto) {
        try {
            const confirm = window.confirm('¿Eliminar este producto del carrito?');
            if (!confirm) return;

            window.ui.showLoading('Eliminando...');

            await window.cartManager.removeProduct(codigoProducto);

            window.ui.hideLoading();
            window.ui.showToast('Producto eliminado', 'success');
            window.ui.updateCartBadge();
            this.updateCartView();

        } catch (error) {
            console.error('Error al eliminar producto:', error);
            window.ui.hideLoading();
            window.ui.showToast('Error al eliminar producto', 'error');
        }
    }

    /**
     * Ir a caja - escanear QR de caja para enviar carrito
     */
    async goToCheckout() {
        try {
            const cart = window.cartManager.getCart();
            
            if (cart.productos.length === 0) {
                window.ui.showToast('El carrito esta vacio', 'warning');
                return;
            }

            const totalWithIVA = cart.total_importe * 1.21;
            
            const confirm = window.confirm(
                `¿Dirigirse a caja?\n\n` +
                `Total: ${totalWithIVA.toFixed(2)}€\n` +
                `Productos: ${cart.total_productos}\n\n` +
                `Escanea el codigo QR de la caja para enviar tu carrito.`
            );

            if (!confirm) return;

            // Llamar a escanear QR de checkout
            await window.scannerManager.scanCheckoutQR();

        } catch (error) {
            console.error('Error al ir a caja:', error);
            window.ui.showToast(error.message || 'Error al procesar', 'error');
        }
    }
}

// Crear instancia global
window.app = new ScanAsYouShopApp();

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.app.initialize();
    });
} else {
    window.app.initialize();
}

