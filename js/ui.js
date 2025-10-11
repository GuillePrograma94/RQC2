/**
 * Gestor de interfaz de usuario
 */

class UIManager {
    constructor() {
        this.loadingScreen = null;
        this.currentToast = null;
        this.syncIndicator = null;
    }

    /**
     * Inicializa el gestor de UI
     */
    initialize() {
        this.loadingScreen = document.getElementById('loadingScreen');
        this.createSyncIndicator();
        this.updateCartBadge();
        console.log('Gestor de UI inicializado');
    }

    /**
     * Crea el indicador de sincronización
     */
    createSyncIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'syncIndicator';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: linear-gradient(135deg, #7851A9, #9370DB);
            color: white;
            padding: 8px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            display: none;
            align-items: center;
            gap: 8px;
            z-index: 9998;
            box-shadow: 0 4px 15px 0 rgba(120, 81, 169, 0.3);
        `;
        indicator.innerHTML = `
            <span class="sync-spinner" style="
                width: 16px;
                height: 16px;
                border: 2px solid rgba(255,255,255,0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></span>
            <span class="sync-text">Sincronizando...</span>
        `;
        document.body.appendChild(indicator);
        this.syncIndicator = indicator;

        // Añadir animación de spin si no existe
        if (!document.getElementById('syncSpinAnimation')) {
            const style = document.createElement('style');
            style.id = 'syncSpinAnimation';
            style.textContent = `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Muestra/oculta el indicador de sincronización
     */
    showSyncIndicator(show) {
        if (this.syncIndicator) {
            this.syncIndicator.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Actualiza el texto del indicador de sincronización
     */
    updateSyncIndicator(text) {
        if (this.syncIndicator) {
            const textSpan = this.syncIndicator.querySelector('.sync-text');
            if (textSpan) {
                textSpan.textContent = text;
            }
        }
    }

    /**
     * Muestra pantalla de carga
     */
    showLoading(message = 'Cargando...') {
        if (this.loadingScreen) {
            const loadingText = this.loadingScreen.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = message;
            }
            this.loadingScreen.classList.remove('hidden');
        }
    }

    /**
     * Oculta pantalla de carga
     */
    hideLoading() {
        if (this.loadingScreen) {
            this.loadingScreen.classList.add('hidden');
        }
    }

    /**
     * Muestra un toast notification
     */
    showToast(message, type = 'info') {
        // Eliminar toast anterior si existe
        if (this.currentToast) {
            this.currentToast.remove();
        }

        // Crear nuevo toast
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        document.body.appendChild(toast);
        this.currentToast = toast;

        // Remover automáticamente después de 3 segundos
        setTimeout(() => {
            if (this.currentToast === toast) {
                toast.remove();
                this.currentToast = null;
            }
        }, window.APP_CONFIG.ui.toastDuration);
    }

    /**
     * Actualiza el badge del carrito (número de líneas únicas)
     */
    updateCartBadge() {
        const cartBadge = document.getElementById('cartBadge');
        
        const uniqueProducts = window.cartManager ? window.cartManager.getUniqueProductCount() : 0;

        if (cartBadge) {
            cartBadge.textContent = uniqueProducts;
            cartBadge.style.display = uniqueProducts > 0 ? 'flex' : 'none';
        }
    }

    /**
     * Muestra un diálogo de confirmación personalizado
     */
    showConfirm(title, message, okText = 'Aceptar', cancelText = 'Cancelar') {
        return new Promise((resolve) => {
            const dialog = document.getElementById('confirmDialog');
            const titleEl = document.getElementById('confirmTitle');
            const messageEl = document.getElementById('confirmMessage');
            const okBtn = document.getElementById('confirmOkBtn');
            const cancelBtn = document.getElementById('confirmCancelBtn');
            
            if (!dialog) {
                console.error('Confirm dialog not found');
                resolve(false);
                return;
            }
            
            // Configurar textos
            if (titleEl) titleEl.textContent = title;
            if (messageEl) messageEl.textContent = message;
            if (okBtn) okBtn.textContent = okText;
            if (cancelBtn) cancelBtn.textContent = cancelText;
            
            // Mostrar dialog
            dialog.style.display = 'flex';
            
            // Manejadores de eventos
            const handleOk = () => {
                dialog.style.display = 'none';
                cleanup();
                resolve(true);
            };
            
            const handleCancel = () => {
                dialog.style.display = 'none';
                cleanup();
                resolve(false);
            };
            
            const cleanup = () => {
                if (okBtn) okBtn.removeEventListener('click', handleOk);
                if (cancelBtn) cancelBtn.removeEventListener('click', handleCancel);
            };
            
            // Añadir listeners
            if (okBtn) okBtn.addEventListener('click', handleOk);
            if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
        });
    }

    /**
     * Muestra un diálogo de confirmación (legacy - usa window.confirm)
     */
    confirm(message) {
        return window.confirm(message);
    }

    /**
     * Muestra un prompt
     */
    prompt(message, defaultValue = '') {
        return window.prompt(message, defaultValue);
    }

    /**
     * Muestra un alert
     */
    alert(message) {
        window.alert(message);
    }
}

// Crear instancia global
window.ui = new UIManager();

