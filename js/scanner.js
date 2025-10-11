/**
 * Gestor de escaneo y búsqueda de productos
 */

class ScannerManager {
    constructor() {
        this.searchTimeout = null;
        this.currentQuantity = 1;
        this.html5QrCode = null;
        this.isScanning = false;
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
            console.log('✅ Escáner de cámara inicializado');
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

        const price = parseFloat(producto.pvp || 0);
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
     * Añade un producto al carrito
     */
    async addToCart(producto, cantidad = 1) {
        try {
            window.ui.showLoading('Añadiendo al carrito...');

            await window.cartManager.addProduct(producto, cantidad);

            window.ui.hideLoading();
            window.ui.showToast(
                `${producto.descripcion} anadido (${cantidad})`,
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
     * Escanea código QR de caja para finalizar compra
     */
    async scanCheckoutQR() {
        try {
            // Verificar que hay productos en el carrito
            if (!window.cartManager.hasProducts()) {
                window.ui.showToast('El carrito esta vacio', 'warning');
                return;
            }

            // Pedir código manualmente (simplificado)
            // En producción, podrías usar una librería de escaneo de QR
            const codigo = prompt('Escanea el codigo QR de la caja (6 digitos):');
            
            if (!codigo) return;

            if (!/^\d{6}$/.test(codigo)) {
                window.ui.showToast('Codigo invalido. Debe ser 6 digitos', 'error');
                return;
            }

            window.ui.showLoading('Subiendo carrito a caja...');

            // Subir el carrito al PC de checkout
            await window.cartManager.uploadCartToCheckout(codigo);

            window.ui.hideLoading();
            
            // Mostrar confirmación
            const total = window.cartManager.getTotalAmount() * 1.21;
            window.ui.showToast('Carrito enviado a caja', 'success');
            
            alert(
                '¡Compra enviada a caja!\n\n' +
                `Total: ${total.toFixed(2)}€\n\n` +
                'El empleado validara tu compra.'
            );

            // Limpiar carrito local
            await window.cartManager.clearCart();
            window.ui.updateCartBadge();
            
            // Volver a pantalla de escaneo
            window.app.showScreen('scan');

        } catch (error) {
            console.error('Error al escanear QR de checkout:', error);
            window.ui.hideLoading();
            window.ui.showToast(error.message || 'Error al enviar carrito', 'error');
        }
    }

    /**
     * Inicia el escáner de cámara
     */
    async startCamera() {
        if (!this.html5QrCode) {
            window.ui.showToast('Escáner no disponible', 'error');
            return;
        }
        
        if (this.isScanning) {
            console.log('⚠️ El escáner ya está activo');
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
            
            this.isScanning = true;
            console.log('📷 Escáner de cámara iniciado');
            
        } catch (error) {
            console.error('Error al iniciar cámara:', error);
            window.ui.showToast('Error al iniciar cámara. Verifica los permisos.', 'error');
        }
    }
    
    /**
     * Detiene el escáner de cámara
     */
    async stopCamera() {
        if (!this.html5QrCode || !this.isScanning) {
            return;
        }
        
        try {
            await this.html5QrCode.stop();
            this.isScanning = false;
            console.log('📷 Escáner de cámara detenido');
        } catch (error) {
            console.error('Error al detener cámara:', error);
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
            
            // Buscar en IndexedDB con búsqueda directa (INSTANTÁNEA)
            const products = await window.cartManager.searchProductsExact(normalizedCode);
            
            console.timeEnd('⏱️ Búsqueda exacta');
            
            if (products.length === 1) {
                // Un producto encontrado - añadir automáticamente
                const producto = products[0];
                console.log('✅ Producto encontrado:', producto);
                await window.cartManager.addProduct(producto, 1);
                window.ui.showToast(`✅ ${producto.descripcion}`, 'success');
                window.ui.updateCartBadge();
                
                // Volver a pantalla de carrito
                window.app.showScreen('cart');
                
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

