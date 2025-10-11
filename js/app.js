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

            // Inicializar UI primero (para poder usar showLoading)
            window.ui.initialize();
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

            // Configurar pantallas
            this.setupScreens();

            // Empezar en pantalla principal (carrito)
            this.showScreen('cart');
            this.updateActiveNav('cart');

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
     * Configura las pantallas y navegación
     */
    setupScreens() {
        // Footer Navigation
        const navSearch = document.getElementById('navSearch');
        const navCheckout = document.getElementById('navCheckout');
        const navScan = document.getElementById('navScan');

        if (navSearch) {
            navSearch.addEventListener('click', () => {
                this.showScreen('search');
                this.updateActiveNav('search');
            });
        }

        if (navCheckout) {
            navCheckout.addEventListener('click', () => {
                this.showScreen('checkout');
                this.updateActiveNav('checkout');
            });
        }

        if (navScan) {
            navScan.addEventListener('click', () => {
                this.showScreen('scan');
                this.updateActiveNav('scan');
            });
        }

        // Botones de volver
        const closeScanBtn = document.getElementById('closeScanBtn');
        const closeSearchBtn = document.getElementById('closeSearchBtn');
        const closeCheckoutBtn = document.getElementById('closeCheckoutBtn');

        if (closeScanBtn) {
            closeScanBtn.addEventListener('click', () => {
                this.showScreen('cart');
                this.updateActiveNav('cart');
            });
        }

        if (closeSearchBtn) {
            closeSearchBtn.addEventListener('click', () => {
                this.showScreen('cart');
                this.updateActiveNav('cart');
            });
        }

        if (closeCheckoutBtn) {
            closeCheckoutBtn.addEventListener('click', () => {
                this.showScreen('cart');
                this.updateActiveNav('cart');
            });
        }

        // Búsqueda
        const searchBtn = document.getElementById('searchBtn');
        const codeSearchInput = document.getElementById('codeSearchInput');
        const descriptionSearchInput = document.getElementById('descriptionSearchInput');
        const clearSearchBtn = document.getElementById('clearSearchBtn');

        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                this.performSearch();
            });
        }

        if (codeSearchInput) {
            codeSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
        }

        if (descriptionSearchInput) {
            descriptionSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                this.clearSearch();
            });
        }

        // Checkout
        const scanCheckoutQRBtn = document.getElementById('scanCheckoutQRBtn');
        const submitCheckoutCodeBtn = document.getElementById('submitCheckoutCodeBtn');
        const checkoutCodeInput = document.getElementById('checkoutCodeInput');
        const closeCheckoutCamera = document.getElementById('closeCheckoutCamera');

        if (scanCheckoutQRBtn) {
            scanCheckoutQRBtn.addEventListener('click', () => {
                window.scannerManager.scanCheckoutQR();
            });
        }

        if (checkoutCodeInput) {
            checkoutCodeInput.addEventListener('input', (e) => {
                const value = e.target.value.replace(/\D/g, '').substring(0, 6);
                e.target.value = value;
                if (submitCheckoutCodeBtn) {
                    submitCheckoutCodeBtn.disabled = value.length !== 6;
                }
            });
        }

        if (submitCheckoutCodeBtn) {
            submitCheckoutCodeBtn.addEventListener('click', () => {
                this.submitCheckoutCode();
            });
        }

        if (closeCheckoutCamera) {
            closeCheckoutCamera.addEventListener('click', () => {
                window.scannerManager.stopCamera();
            });
        }

        // Escaneo manual
        const addManualCodeBtn = document.getElementById('addManualCodeBtn');
        const manualCodeInput = document.getElementById('manualCodeInput');

        if (addManualCodeBtn) {
            addManualCodeBtn.addEventListener('click', () => {
                this.addManualCode();
            });
        }

        if (manualCodeInput) {
            manualCodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.addManualCode();
            });
        }
    }

    /**
     * Actualiza la navegación activa
     */
    updateActiveNav(screen) {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => item.classList.remove('active'));

        // No marcar como activo el botón de checkout (siempre destaca)
        if (screen === 'search') {
            document.getElementById('navSearch')?.classList.add('active');
        } else if (screen === 'scan') {
            document.getElementById('navScan')?.classList.add('active');
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
     * Realiza la búsqueda
     */
    async performSearch() {
        const codeInput = document.getElementById('codeSearchInput');
        const descInput = document.getElementById('descriptionSearchInput');
        
        const code = codeInput?.value.trim() || '';
        const description = descInput?.value.trim() || '';

        if (!code && !description) {
            window.ui.showToast('Introduce un código o descripción', 'warning');
            return;
        }

        try {
            const productos = await window.cartManager.searchProductsLocal(code || description);
            this.displaySearchResults(productos);
        } catch (error) {
            console.error('Error en búsqueda:', error);
            window.ui.showToast('Error al buscar productos', 'error');
        }
    }

    /**
     * Muestra resultados de búsqueda
     */
    displaySearchResults(productos) {
        const resultsContainer = document.getElementById('searchResults');
        const emptyState = document.getElementById('searchEmpty');
        const resultsList = document.getElementById('searchResultsList');
        const resultsTitle = document.getElementById('searchResultsTitle');

        if (!resultsList) return;

        if (productos.length === 0) {
            if (resultsContainer) resultsContainer.style.display = 'none';
            if (emptyState) {
                emptyState.style.display = 'flex';
                emptyState.querySelector('.empty-icon').textContent = '😕';
                emptyState.querySelector('p').textContent = 'No se encontraron productos';
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (resultsContainer) resultsContainer.style.display = 'block';
        if (resultsTitle) resultsTitle.textContent = `${productos.length} resultado${productos.length !== 1 ? 's' : ''}`;

        resultsList.innerHTML = productos.map(producto => `
            <div class="result-item" onclick="window.app.addProductToCart('${producto.codigo}', '${producto.descripcion.replace(/'/g, "\\'")}', ${producto.pvp})">
                <div class="result-code">${producto.codigo}</div>
                <div class="result-name">${producto.descripcion}</div>
                <div class="result-price">${producto.pvp.toFixed(2)} €</div>
            </div>
        `).join('');
    }

    /**
     * Añade producto al carrito desde búsqueda
     */
    addProductToCart(codigo, descripcion, pvp) {
        window.cartManager.addProduct({
            codigo,
            descripcion,
            pvp,
            cantidad: 1
        });
        
        window.ui.showToast('Producto añadido al carrito', 'success');
        this.updateCartView();
    }

    /**
     * Limpia búsqueda
     */
    clearSearch() {
        const codeInput = document.getElementById('codeSearchInput');
        const descInput = document.getElementById('descriptionSearchInput');
        const resultsContainer = document.getElementById('searchResults');
        const emptyState = document.getElementById('searchEmpty');

        if (codeInput) codeInput.value = '';
        if (descInput) descInput.value = '';
        if (resultsContainer) resultsContainer.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.querySelector('.empty-icon').textContent = '🔍';
            emptyState.querySelector('p').textContent = 'Busca por código o descripción';
        }
    }

    /**
     * Añade código manual en pantalla de escaneo
     */
    async addManualCode() {
        const input = document.getElementById('manualCodeInput');
        const code = input?.value.trim();

        if (!code) {
            window.ui.showToast('Introduce un código', 'warning');
            return;
        }

        try {
            const producto = await window.supabaseClient.searchProductByCode(code);
            if (producto) {
                this.addProductToCart(producto.codigo, producto.descripcion, producto.pvp);
                if (input) input.value = '';
            } else {
                window.ui.showToast('Producto no encontrado', 'error');
            }
        } catch (error) {
            console.error('Error al buscar producto:', error);
            window.ui.showToast('Error al buscar producto', 'error');
        }
    }

    /**
     * Envía código de caja
     */
    async submitCheckoutCode() {
        const input = document.getElementById('checkoutCodeInput');
        const code = input?.value;

        if (!code || code.length !== 6) {
            window.ui.showToast('Código inválido', 'error');
            return;
        }

        try {
            await window.cartManager.uploadCartToCheckout(code);
            window.ui.showToast('Compra confirmada ✓', 'success');
            
            // Limpiar carrito y volver
            window.cartManager.clearCart();
            this.showScreen('cart');
            this.updateActiveNav('cart');
        } catch (error) {
            console.error('Error al confirmar compra:', error);
            window.ui.showToast('Error al confirmar compra', 'error');
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

