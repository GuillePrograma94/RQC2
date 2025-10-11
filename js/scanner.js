/**
 * Gestor de escaneo y búsqueda de productos
 */

class ScannerManager {
    constructor() {
        this.searchTimeout = null;
        this.currentQuantity = 1;
    }

    /**
     * Inicializa el gestor de escaneo
     */
    initialize() {
        this.setupSearchListeners();
        this.setupQuantityControls();
        console.log('Gestor de escaneo inicializado');
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
     * Escanea producto (simulado con búsqueda)
     */
    scanProduct() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.focus();
        }
    }
}

// Crear instancia global
window.scannerManager = new ScannerManager();

