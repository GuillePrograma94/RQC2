/**
 * Gestor de escaneo y búsqueda de productos
 */

class ScannerManager {
    constructor() {
        this.searchTimeout = null;
        this.currentQuantity = 1;
        this.html5QrCode = null;
        this.html5QrCodeCheckout = null;
        this.isScanningProducts = false;
        this.isScanningCheckout = false;
        this.isCheckoutMode = false;
    }

    /**
     * Inicializa el gestor de escaneo
     */
    initialize() {
        this.setupSearchListeners();
        this.setupQuantityControls();
        this.initializeCamera();
        console.log('Gestor de escaneo inicializado');
    }
    
    /**
     * Inicializa la cámara para el escáner
     */
    initializeCamera() {
        if (typeof Html5Qrcode !== 'undefined') {
            this.html5QrCode = new Html5Qrcode("reader");
            this.html5QrCodeCheckout = new Html5Qrcode("checkoutReader");
            console.log('✅ Escáner de cámara inicializado');
            console.log('✅ Escáner de checkout inicializado');
        } else {
            console.error('❌ Html5Qrcode no disponible');
        }
    }

    /**
     * Configura los listeners de búsqueda
     */
    setupSearchListeners() {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput) return;

        searchInput.addEventListener('input', (e) => {
            clearTimeout(this.searchTimeout);
            
            const searchTerm = e.target.value.trim();
            
            if (searchTerm.length < window.APP_CONFIG.search.minSearchLength) {
                this.clearSearchResults();
                return;
            }

            // Debounce para búsqueda en tiempo real
            this.searchTimeout = setTimeout(() => {
                this.searchProducts(searchTerm);
            }, window.APP_CONFIG.search.debounceDelay);
        });

        // Enter para búsqueda rápida
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(this.searchTimeout);
                const searchTerm = e.target.value.trim();
                if (searchTerm.length >= window.APP_CONFIG.search.minSearchLength) {
                    this.searchProducts(searchTerm);
                }
            }
        });
    }

    /**
     * Configura los controles de cantidad
     */
    setupQuantityControls() {
        // Los controles se configuran dinámicamente cuando se crean productos
    }

    /**
     * Busca productos (local primero, luego Supabase)
     */
    async searchProducts(searchTerm) {
        try {
            // Buscar primero en almacenamiento local (rápido)
            let productos = await window.cartManager.searchProductsLocal(searchTerm);

            // Mostrar resultados locales inmediatamente
            if (productos.length > 0) {
                this.displaySearchResults(productos);
                return;
            }

            // Si no hay resultados locales, buscar en Supabase en tiempo real
            if (navigator.onLine) {
                window.ui.showLoading('Buscando en servidor...');
                
                const producto = await window.supabaseClient.searchProductByCode(searchTerm);
                if (producto) {
                    productos = [producto];
                }

                window.ui.hideLoading();
            }

            // Mostrar resultados (pueden ser vacíos)
            this.displaySearchResults(productos);

        } catch (error) {
            console.error('Error al buscar productos:', error);
            window.ui.hideLoading();
            window.ui.showToast('Error al buscar productos', 'error');
        }
    }

    /**
     * Muestra los resultados de búsqueda
     */
    displaySearchResults(productos) {
        const container = document.getElementById('searchResults');
        if (!container) return;

        container.innerHTML = '';

        if (productos.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <p>No se encontraron productos</p>
                </div>
            `;
            return;
        }

        productos.forEach(producto => {
            const productCard = this.createProductCard(producto);
            container.appendChild(productCard);
        });
    }

    /**
     * Crea una tarjeta de producto
     */
    createProductCard(producto) {
        const card = document.createElement('div');
        card.className = 'product-card';

        const price = window.app && typeof window.app.getPvpUnitarioConTarifa === 'function'
            ? window.app.getPvpUnitarioConTarifa(producto)
            : parseFloat(producto.pvp || 0);
        const priceWithIVA = price * 1.21;

        card.innerHTML = `
            <div class="product-header">
                <span class="product-code">${producto.codigo}</span>
                <span class="product-price">${priceWithIVA.toFixed(2)}€</span>
            </div>
            <div class="product-description">${producto.descripcion}</div>
            <div class="product-actions">
                <div class="quantity-controls">
                    <button class="quantity-btn" data-action="decrease" data-code="${producto.codigo}">−</button>
                    <span class="quantity-display" id="qty-${producto.codigo}">1</span>
                    <button class="quantity-btn" data-action="increase" data-code="${producto.codigo}">+</button>
                </div>
                <button class="add-to-cart-btn" data-code="${producto.codigo}">
                    ➕ Añadir al carrito
                </button>
            </div>
        `;

        // Añadir event listeners
        this.attachProductCardListeners(card, producto);

        return card;
    }

    /**
     * Añade listeners a una tarjeta de producto
     */
    attachProductCardListeners(card, producto) {
        // Controles de cantidad
        const decreaseBtn = card.querySelector('[data-action="decrease"]');
        const increaseBtn = card.querySelector('[data-action="increase"]');
        const qtyDisplay = card.querySelector(`#qty-${producto.codigo}`);

        let quantity = 1;

        decreaseBtn.addEventListener('click', () => {
            if (quantity > 1) {
                quantity--;
                qtyDisplay.textContent = quantity;
            }
        });

        increaseBtn.addEventListener('click', () => {
            if (quantity < 99) {
                quantity++;
                qtyDisplay.textContent = quantity;
            }
        });

        // Botón añadir al carrito
        const addBtn = card.querySelector('.add-to-cart-btn');
        addBtn.addEventListener('click', async () => {
            await this.addToCart(producto, quantity);
            
            // Reset cantidad después de añadir
            quantity = 1;
            qtyDisplay.textContent = '1';
        });
    }

    /**
     * Añade un producto al carrito (con modal de cantidad)
     */
    async addToCart(producto, cantidad = 1) {
        try {
            const pvpAdj = window.app && typeof window.app.getPvpUnitarioConTarifa === 'function'
                ? window.app.getPvpUnitarioConTarifa(producto)
                : parseFloat(producto.pvp || 0);
            const productoCarrito = Object.assign({}, producto, { pvp: pvpAdj });
            const cantidadSeleccionada = await window.app.showAddToCartModal(productoCarrito);
            
            // Si el usuario canceló, no hacer nada
            if (cantidadSeleccionada === null) {
                return;
            }

            window.ui.showLoading('Añadiendo al carrito...');

            await window.cartManager.addProduct(productoCarrito, cantidadSeleccionada);

            window.ui.hideLoading();
            window.ui.showToast(
                `${producto.descripcion} anadido (x${cantidadSeleccionada})`,
                'success'
            );

            // Actualizar badge del carrito
            window.ui.updateCartBadge();

            // Limpiar búsqueda
            this.clearSearch();

        } catch (error) {
            console.error('Error al añadir al carrito:', error);
            window.ui.hideLoading();
            window.ui.showToast(error.message || 'Error al añadir al carrito', 'error');
        }
    }

    /**
     * Limpia la búsqueda
     */
    clearSearch() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = '';
        }
        this.clearSearchResults();
    }

    /**
     * Limpia los resultados de búsqueda
     */
    clearSearchResults() {
        const container = document.getElementById('searchResults');
        if (container) {
            container.innerHTML = '';
        }
    }

    /**
     * Inicia la cámara de checkout integrada en la pantalla
     */
    async startCheckoutCameraIntegrated() {
        try {
            console.log('🔵 Iniciando escáner de checkout integrado...');
            console.log('🔍 Estado actual - isScanningCheckout:', this.isScanningCheckout);
            
            // Verificar que hay productos en el carrito
            if (!window.cartManager.hasProducts()) {
                console.log('⚠️ Carrito vacío - no se puede iniciar checkout');
                window.ui.showToast('El carrito esta vacio', 'warning');
                return;
            }

            // Activar modo checkout para el escáner
            this.isCheckoutMode = true;
            console.log('✅ Modo checkout activado');
            
            // Iniciar escáner directamente
            console.log('📷 Llamando a startCheckoutCamera()...');
            await this.startCheckoutCamera();
            console.log('✅ startCheckoutCamera() completado');

        } catch (error) {
            console.error('❌ Error al iniciar escáner de checkout:', error);
            window.ui.showToast(error.message || 'Error al iniciar escáner', 'error');
        }
    }

    /**
     * Escanea código QR de caja para finalizar compra (versión antigua - deprecated)
     */
    async scanCheckoutQR() {
        // Redirigir a la nueva implementación integrada
        await this.startCheckoutCameraIntegrated();
    }
    
    /**
     * Inicia el escáner de cámara para checkout
     */
    async startCheckoutCamera() {
        console.log('📸 startCheckoutCamera() - Iniciando...');
        console.log('   html5QrCodeCheckout existe:', !!this.html5QrCodeCheckout);
        console.log('   isScanningCheckout:', this.isScanningCheckout);
        
        if (!this.html5QrCodeCheckout) {
            console.error('❌ html5QrCodeCheckout no está disponible');
            window.ui.showToast('Escáner no disponible', 'error');
            return;
        }
        
        if (this.isScanningCheckout) {
            console.log('⚠️ El escáner de checkout ya está activo');
            return;
        }
        
        try {
            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.QR_CODE
                ]
            };
            
            await this.html5QrCodeCheckout.start(
                { facingMode: "environment" }, // Cámara trasera
                config,
                (decodedText, decodedResult) => {
                    this.onCheckoutScanSuccess(decodedText);
                },
                (errorMessage) => {
                    // No mostramos errores de escaneo fallidos (normal cuando no hay código)
                }
            );
            
            this.isScanningCheckout = true;
            console.log('✅ Escáner de checkout iniciado exitosamente');
            
        } catch (error) {
            console.error('Error al iniciar cámara de checkout:', error);
            window.ui.showToast('Error al iniciar cámara. Verifica los permisos.', 'error');
        }
    }
    
    /**
     * Maneja el éxito del escaneo de checkout
     */
    async onCheckoutScanSuccess(decodedText) {
        console.log('🎯 Código QR de caja escaneado:', decodedText);
        
        // Detener cámara de checkout
        await this.stopCheckoutCamera();
        
        // Vibración de feedback
        if (navigator.vibrate) {
            navigator.vibrate(200);
        }
        
        this.isCheckoutMode = false;
        
        // Validar código (debe ser 6 dígitos)
        if (!/^\d{6}$/.test(decodedText)) {
            window.ui.showToast('Código QR inválido. Debe ser 6 dígitos', 'error');
            return;
        }
        
        try {
            window.ui.showLoading('Subiendo carrito a caja...');

            // Subir el carrito al PC de checkout
            await window.cartManager.uploadCartToCheckout(decodedText);

            window.ui.hideLoading();
            
            // Mostrar confirmación
            const total = window.cartManager.getTotalAmount() * 1.21;
            window.ui.showToast('Carrito enviado a caja', 'success');
            
            alert(
                '¡Compra enviada a caja!\n\n' +
                `Total: ${total.toFixed(2)}€\n\n` +
                'El empleado validara tu compra.'
            );

            // Invalidar cache de historial si hay usuario logueado (Phase 2 - Cache)
            if (window.app && window.app.currentUser && window.purchaseCache) {
                console.log('🔄 Invalidando cache de historial tras compra QR...');
                window.purchaseCache.invalidateUser(window.app.currentUser.user_id);
            }
            
            // Limpiar carrito local
            await window.cartManager.clearCart();
            window.ui.updateCartBadge();
            
            // Volver a pantalla de carrito
            window.app.showScreen('cart');

        } catch (error) {
            console.error('Error al enviar carrito:', error);
            window.ui.hideLoading();
            window.ui.showToast(error.message || 'Error al enviar carrito', 'error');
        }
    }
    
    /**
     * Detiene el escáner de cámara de checkout
     */
    async stopCheckoutCamera() {
        console.log('🛑 stopCheckoutCamera() - Intentando detener...');
        console.log('   html5QrCodeCheckout existe:', !!this.html5QrCodeCheckout);
        console.log('   isScanningCheckout:', this.isScanningCheckout);
        
        if (!this.html5QrCodeCheckout || !this.isScanningCheckout) {
            console.log('⚠️ No se puede detener - escáner no activo o no disponible');
            return;
        }
        
        try {
            await this.html5QrCodeCheckout.stop();
            this.isScanningCheckout = false;
            console.log('✅ Escáner de checkout detenido');
        } catch (error) {
            console.error('❌ Error al detener cámara de checkout:', error);
        }
    }

    /**
     * Inicia el escáner de cámara
     */
    async startCamera() {
        console.log('📸 startCamera() - Iniciando...');
        console.log('   html5QrCode existe:', !!this.html5QrCode);
        console.log('   isScanningProducts:', this.isScanningProducts);
        
        if (!this.html5QrCode) {
            console.error('❌ html5QrCode no está disponible');
            window.ui.showToast('Escáner no disponible', 'error');
            return;
        }
        
        if (this.isScanningProducts) {
            console.log('⚠️ El escáner de productos ya está activo');
            return;
        }
        
        try {
            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.QR_CODE,
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39
                ]
            };
            
            await this.html5QrCode.start(
                { facingMode: "environment" }, // Cámara trasera
                config,
                (decodedText, decodedResult) => {
                    this.onScanSuccess(decodedText);
                },
                (errorMessage) => {
                    // No mostramos errores de escaneo fallidos (normal cuando no hay código)
                }
            );
            
            this.isScanningProducts = true;
            console.log('✅ Escáner de productos iniciado exitosamente');
            
        } catch (error) {
            console.error('Error al iniciar cámara:', error);
            window.ui.showToast('Error al iniciar cámara. Verifica los permisos.', 'error');
        }
    }
    
    /**
     * Detiene el escáner de cámara
     */
    async stopCamera() {
        console.log('🛑 stopCamera() - Intentando detener...');
        console.log('   html5QrCode existe:', !!this.html5QrCode);
        console.log('   isScanningProducts:', this.isScanningProducts);
        
        if (!this.html5QrCode || !this.isScanningProducts) {
            console.log('⚠️ No se puede detener - escáner no activo o no disponible');
            return;
        }
        
        try {
            await this.html5QrCode.stop();
            this.isScanningProducts = false;
            console.log('✅ Escáner de productos detenido');
        } catch (error) {
            console.error('❌ Error al detener cámara:', error);
        }
    }
    
    /**
     * Maneja el éxito del escaneo
     */
    async onScanSuccess(decodedText) {
        console.log('🎯 Código escaneado:', decodedText);
        
        // Detener cámara temporalmente
        await this.stopCamera();
        
        // Vibración de feedback
        if (navigator.vibrate) {
            navigator.vibrate(200);
        }
        
        // Buscar producto con búsqueda EXACTA (ultrarrápida)
        await this.searchProductExact(decodedText);
    }
    
    /**
     * Búsqueda EXACTA ultrarrápida (igual que mobile_reader)
     * Usa índices de IndexedDB para búsqueda instantánea
     */
    async searchProductExact(code) {
        try {
            console.time('⏱️ Búsqueda exacta');
            
            const normalizedCode = code.toUpperCase().trim();
            const hybridMode = !!(
                window.app &&
                typeof window.app.isHybridCatalogReadModeEnabled === 'function' &&
                window.app.isHybridCatalogReadModeEnabled()
            );
            
            // Buscar en IndexedDB con búsqueda directa (INSTANTÁNEA)
            let products = await window.cartManager.searchProductsExact(normalizedCode);
            if (window.app && typeof window.app.debeOcultarProductoBusquedaCatalogo === 'function') {
                products = products.filter((p) => !window.app.debeOcultarProductoBusquedaCatalogo(p));
            }

            if (hybridMode && products.length === 0) {
                const productoRemoto = await window.supabaseClient.searchProductByCode(normalizedCode);
                if (productoRemoto) {
                    products = [productoRemoto];
                }
            }
            
            console.timeEnd('⏱️ Búsqueda exacta');
            
            if (products.length === 1) {
                // Un producto encontrado - mostrar directamente modal de cantidad
                const producto = products[0];
                const pvpCarrito = window.app && typeof window.app.getPvpUnitarioConTarifa === 'function'
                    ? window.app.getPvpUnitarioConTarifa(producto)
                    : producto.pvp;
                console.log('✅ Producto encontrado:', producto);
                
                // Vibración de feedback (si está disponible)
                if (navigator.vibrate) {
                    navigator.vibrate(200);
                }
                
                // Mostrar modal de cantidad directamente
                const cantidad = await window.app.showAddToCartModal({
                    codigo: producto.codigo,
                    descripcion: producto.descripcion,
                    pvp: pvpCarrito
                });
                
                // Si el usuario canceló, reiniciar cámara
                if (cantidad === null) {
                    setTimeout(() => {
                        if (window.app.currentScreen === 'scan') {
                            this.startCamera();
                        }
                    }, 100);
                    return;
                }
                
                // Añadir al carrito con la cantidad seleccionada
                await window.cartManager.addProduct({
                    codigo: producto.codigo,
                    descripcion: producto.descripcion,
                    pvp: pvpCarrito
                }, cantidad);
                window.ui.showToast(`✅ ${producto.descripcion} (x${cantidad})`, 'success');
                window.ui.updateCartBadge();
                
                // Si estamos en la pantalla de carrito, actualizar vista
                if (window.app.currentScreen === 'cart') {
                    window.app.updateCartView();
                }
                
                // Reiniciar cámara para seguir escaneando
                setTimeout(() => {
                    if (window.app.currentScreen === 'scan') {
                        this.startCamera();
                    }
                }, 100);
                
            } else if (products.length > 1) {
                // Múltiples productos - mostrar en resultados de escaneo
                this.displayScanResults(products);
                window.ui.showToast(`🔍 ${products.length} productos encontrados`, 'info');
                
            } else {
                // No encontrado
                window.ui.showToast(`❌ Producto no encontrado: ${code}`, 'warning');
                
                // Reiniciar cámara para escanear de nuevo
                setTimeout(() => {
                    if (window.app.currentScreen === 'scan') {
                        this.startCamera();
                    }
                }, 2000);
            }
            
        } catch (error) {
            console.error('Error en búsqueda exacta:', error);
            window.ui.showToast('Error al buscar producto', 'error');
        }
    }
    
    /**
     * Muestra resultados de escaneo
     */
    displayScanResults(productos) {
        const container = document.getElementById('scanResults');
        if (!container) return;
        
        container.style.display = 'block';
        container.innerHTML = '';
        
        productos.forEach(producto => {
            const card = this.createProductCard(producto);
            container.appendChild(card);
        });
    }

    /**
     * Limpia los resultados de búsqueda
     */
    clearSearchResults() {
        const container = document.getElementById('searchResults');
        if (container) {
            container.innerHTML = '';
        }
        
        const scanContainer = document.getElementById('scanResults');
        if (scanContainer) {
            scanContainer.style.display = 'none';
            scanContainer.innerHTML = '';
        }
    }
    
}

// Crear instancia global
window.scannerManager = new ScannerManager();
console.log('🎯 Scanner Manager creado');

