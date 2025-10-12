/**
 * Aplicación principal Scan as You Shop
 */

class ScanAsYouShopApp {
    constructor() {
        this.currentScreen = 'welcome';
        this.isInitialized = false;
        this.currentUser = null;
        this.currentSession = null;
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

            // Verificar si hay sesión guardada
            const savedUser = this.loadUserSession();
            if (savedUser) {
                console.log('Sesion de usuario encontrada:', savedUser.user_name);
                this.currentUser = savedUser;
                this.updateUserUI();
            }

            // Inicializar app (con o sin usuario logueado)
            await this.initializeApp();

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
     * Muestra el modal de login
     */
    showLoginModal() {
        const loginModal = document.getElementById('loginModal');
        if (loginModal) {
            loginModal.style.display = 'flex';
        }
    }

    /**
     * Oculta el modal de login
     */
    hideLoginModal() {
        const loginModal = document.getElementById('loginModal');
        if (loginModal) {
            loginModal.style.display = 'none';
        }
        
        // Limpiar formulario
        const loginForm = document.getElementById('loginForm');
        if (loginForm) loginForm.reset();
        
        // Ocultar error
        const errorDiv = document.getElementById('loginError');
        if (errorDiv) errorDiv.style.display = 'none';
    }

    /**
     * Maneja el proceso de login
     */
    async handleLogin(e) {
        e.preventDefault();

        const codigoInput = document.getElementById('loginCodigo');
        const passwordInput = document.getElementById('loginPassword');
        const errorDiv = document.getElementById('loginError');
        const loginBtn = e.target.querySelector('button[type="submit"]');

        const codigo = codigoInput.value.trim();
        const password = passwordInput.value;

        if (!codigo || !password) {
            this.showLoginError('Por favor completa todos los campos');
            return;
        }

        // Deshabilitar botón mientras se procesa
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.textContent = 'Iniciando sesión...';
        }

        try {
            // Intentar login
            const loginResult = await window.supabaseClient.loginUser(codigo, password);

            if (loginResult.success) {
                // Guardar información del usuario
                this.currentUser = {
                    user_id: loginResult.user_id,
                    user_name: loginResult.user_name,
                    codigo_usuario: loginResult.codigo_usuario
                };

                // Crear sesión
                const sessionId = await window.supabaseClient.createUserSession(codigo);
                if (sessionId) {
                    this.currentSession = sessionId;
                }

                // Guardar sesión en localStorage
                this.saveUserSession(this.currentUser, sessionId);

                // Actualizar UI con nombre del usuario
                this.updateUserUI();

                // Ocultar modal de login
                this.hideLoginModal();
                
                // Cerrar menú
                this.closeMenu();
                
                // Mostrar mensaje de bienvenida
                window.ui.showToast(`Bienvenido, ${this.currentUser.user_name}`, 'success');

            } else {
                this.showLoginError(loginResult.message || 'Usuario o contraseña incorrectos');
                if (loginBtn) {
                    loginBtn.disabled = false;
                    loginBtn.textContent = 'Iniciar Sesión';
                }
            }

        } catch (error) {
            console.error('Error al iniciar sesión:', error);
            this.showLoginError('Error de conexión. Intenta de nuevo.');
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Iniciar Sesión';
            }
        }
    }

    /**
     * Muestra un error en el formulario de login
     */
    showLoginError(message) {
        const errorDiv = document.getElementById('loginError');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }
    }

    /**
     * Guarda la sesión del usuario en localStorage
     */
    saveUserSession(user, sessionId) {
        try {
            localStorage.setItem('current_user', JSON.stringify(user));
            if (sessionId) {
                localStorage.setItem('current_session', sessionId.toString());
            }
            console.log('Sesion guardada localmente');
        } catch (error) {
            console.error('Error al guardar sesion:', error);
        }
    }

    /**
     * Carga la sesión del usuario desde localStorage
     */
    loadUserSession() {
        try {
            const userStr = localStorage.getItem('current_user');
            const sessionStr = localStorage.getItem('current_session');
            
            if (userStr) {
                const user = JSON.parse(userStr);
                if (sessionStr) {
                    this.currentSession = parseInt(sessionStr);
                }
                return user;
            }
            return null;
        } catch (error) {
            console.error('Error al cargar sesion:', error);
            return null;
        }
    }

    /**
     * Actualiza la UI con la información del usuario
     */
    updateUserUI() {
        const menuGuest = document.getElementById('menuGuest');
        const menuUser = document.getElementById('menuUser');
        const menuUserName = document.getElementById('menuUserName');
        const menuUserCode = document.getElementById('menuUserCode');

        if (this.currentUser) {
            // Usuario logueado
            if (menuGuest) menuGuest.style.display = 'none';
            if (menuUser) menuUser.style.display = 'block';
            if (menuUserName) {
                menuUserName.textContent = this.currentUser.user_name;
            }
            if (menuUserCode) {
                menuUserCode.textContent = `Código: ${this.currentUser.codigo_usuario}`;
            }
        } else {
            // Usuario NO logueado
            if (menuGuest) menuGuest.style.display = 'block';
            if (menuUser) menuUser.style.display = 'none';
        }
    }

    /**
     * Cierra la sesión del usuario
     */
    async logout() {
        try {
            // Cerrar sesión en Supabase
            if (this.currentSession) {
                await window.supabaseClient.closeUserSession(this.currentSession);
            }

            // Limpiar datos locales
            localStorage.removeItem('current_user');
            localStorage.removeItem('current_session');
            this.currentUser = null;
            this.currentSession = null;

            // Actualizar UI
            this.updateUserUI();

            // Mostrar mensaje
            window.ui.showToast('Sesión cerrada', 'success');

            console.log('Sesion cerrada correctamente');

        } catch (error) {
            console.error('Error al cerrar sesion:', error);
        }
    }

    /**
     * Inicializa la aplicación después del login
     */
    async initializeApp() {
        try {
            window.ui.showLoading('Cargando aplicacion...');

            // Inicializar carrito
            const cartOK = await window.cartManager.initialize();
            if (!cartOK) {
                throw new Error('No se pudo inicializar el carrito');
            }

            // Inicializar scanner
            window.scannerManager.initialize();

            // Configurar pantallas
            this.setupScreens();

            // Actualizar vista del carrito
            this.updateCartView();

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
            window.ui.updateSyncIndicator('Guardando productos...');
            await window.cartManager.saveProductsToStorage(productos);
            
            window.ui.updateSyncIndicator('Guardando códigos secundarios...');
            await window.cartManager.saveSecondaryCodesToStorage(codigosSecundarios);

            // Actualizar hash local
            await window.supabaseClient.actualizarVersionLocal(versionCheck.versionRemota);

            console.log('✅ Productos y códigos secundarios sincronizados correctamente');
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
        const navCart = document.getElementById('navCart');
        const navSearch = document.getElementById('navSearch');
        const navCheckout = document.getElementById('navCheckout');
        const navScan = document.getElementById('navScan');

        if (navCart) {
            navCart.addEventListener('click', () => {
                this.showScreen('cart');
                this.updateActiveNav('cart');
            });
        }

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

        // Menu Sidebar
        const menuBtn = document.getElementById('menuBtn');
        const closeMenuBtn = document.getElementById('closeMenuBtn');
        const menuSidebar = document.getElementById('menuSidebar');
        const menuOverlay = document.getElementById('menuOverlay');

        if (menuBtn) {
            menuBtn.addEventListener('click', () => {
                this.openMenu();
            });
        }

        if (closeMenuBtn) {
            closeMenuBtn.addEventListener('click', () => {
                this.closeMenu();
            });
        }

        if (menuOverlay) {
            menuOverlay.addEventListener('click', () => {
                this.closeMenu();
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

        // Checkout (código manual)
        const submitCheckoutCodeBtn = document.getElementById('submitCheckoutCodeBtn');
        const checkoutCodeInput = document.getElementById('checkoutCodeInput');

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

        // Login button (menu hamburguesa)
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                this.closeMenu();
                this.showLoginModal();
            });
        }

        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
                this.closeMenu();
            });
        }

        // Close login modal
        const closeLoginModal = document.getElementById('closeLoginModal');
        if (closeLoginModal) {
            closeLoginModal.addEventListener('click', () => {
                this.hideLoginModal();
            });
        }

        // Close login modal on overlay click
        const loginModal = document.getElementById('loginModal');
        if (loginModal) {
            loginModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('login-modal-overlay') || e.target.id === 'loginModal') {
                    this.hideLoginModal();
                }
            });
        }

        // Login form submit
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.onsubmit = (e) => this.handleLogin(e);
        }

        // Purchase History button (menu hamburguesa)
        const purchaseHistoryBtn = document.getElementById('purchaseHistoryBtn');
        if (purchaseHistoryBtn) {
            purchaseHistoryBtn.addEventListener('click', () => {
                this.closeMenu();
                this.showScreen('purchaseHistory');
                this.updateActiveNav('purchaseHistory');
            });
        }

        // Load history button (empty state)
        const loadHistoryBtn = document.getElementById('loadHistoryBtn');
        if (loadHistoryBtn) {
            loadHistoryBtn.addEventListener('click', () => {
                this.loadPurchaseHistory();
            });
        }

        // Load all history button
        const loadAllHistoryBtn = document.getElementById('loadAllHistoryBtn');
        if (loadAllHistoryBtn) {
            loadAllHistoryBtn.addEventListener('click', () => {
                this.loadPurchaseHistory();
            });
        }

        // Search history button
        const searchHistoryBtn = document.getElementById('searchHistoryBtn');
        if (searchHistoryBtn) {
            searchHistoryBtn.addEventListener('click', () => {
                this.searchPurchaseHistory();
            });
        }

        // Clear history search button
        const clearHistorySearchBtn = document.getElementById('clearHistorySearchBtn');
        if (clearHistorySearchBtn) {
            clearHistorySearchBtn.addEventListener('click', () => {
                this.clearHistorySearch();
            });
        }

        // Enter key en inputs de historial
        const historyCodeInput = document.getElementById('historyCodeInput');
        const historyDescriptionInput = document.getElementById('historyDescriptionInput');
        
        if (historyCodeInput) {
            historyCodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.searchPurchaseHistory();
            });
        }

        if (historyDescriptionInput) {
            historyDescriptionInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.searchPurchaseHistory();
            });
        }
    }

    /**
     * Actualiza la navegación activa
     */
    updateActiveNav(screen) {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => item.classList.remove('active'));

        // Marcar como activo el botón correspondiente
        if (screen === 'cart') {
            document.getElementById('navCart')?.classList.add('active');
        } else if (screen === 'search') {
            document.getElementById('navSearch')?.classList.add('active');
        } else if (screen === 'scan') {
            document.getElementById('navScan')?.classList.add('active');
        } else if (screen === 'checkout') {
            document.getElementById('navCheckout')?.classList.add('active');
        }
    }

    /**
     * Abre el menú lateral
     */
    openMenu() {
        const menuSidebar = document.getElementById('menuSidebar');
        const menuOverlay = document.getElementById('menuOverlay');
        
        if (menuSidebar) {
            menuSidebar.classList.add('open');
        }
        if (menuOverlay) {
            menuOverlay.classList.add('active');
        }
    }

    /**
     * Cierra el menú lateral
     */
    closeMenu() {
        const menuSidebar = document.getElementById('menuSidebar');
        const menuOverlay = document.getElementById('menuOverlay');
        
        if (menuSidebar) {
            menuSidebar.classList.remove('open');
        }
        if (menuOverlay) {
            menuOverlay.classList.remove('active');
        }
    }

    /**
     * Muestra una pantalla específica
     */
    async showScreen(screenName) {
        console.log(`\n🔄 CAMBIO DE PANTALLA: ${this.currentScreen || 'inicio'} → ${screenName}`);
        const previousScreen = this.currentScreen;
        
        // Detener cámara si estábamos en una pantalla con cámara
        if (previousScreen === 'scan') {
            console.log('🔍 Verificando si hay que cerrar cámara de productos...');
            console.log('   isScanningProducts:', window.scannerManager.isScanningProducts);
            if (window.scannerManager.isScanningProducts) {
                console.log('🔴 Cerrando cámara de escaneo...');
                await window.scannerManager.stopCamera();
            }
        }
        
        // Detener cámara de checkout si estábamos en checkout
        if (previousScreen === 'checkout') {
            console.log('🔍 Verificando si hay que cerrar cámara de checkout...');
            console.log('   isScanningCheckout:', window.scannerManager.isScanningCheckout);
            if (window.scannerManager.isScanningCheckout) {
                console.log('🔴 Cerrando cámara de checkout...');
                await window.scannerManager.stopCheckoutCamera();
            }
        }
        
        // Ocultar todas las pantallas
        const screens = document.querySelectorAll('.screen');
        screens.forEach(screen => screen.classList.remove('active'));

        // Mostrar pantalla seleccionada
        const targetScreen = document.getElementById(`${screenName}Screen`);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenName;
            
            // Iniciar cámara si entramos en pantalla de escaneo
            if (screenName === 'scan') {
                console.log('🟢 Entrando a pantalla SCAN - Iniciando cámara de escaneo...');
                // Pequeño delay para que el DOM se actualice
                setTimeout(() => {
                    console.log('⏰ Timeout completado - llamando a startCamera()');
                    window.scannerManager.startCamera();
                }, 100);
            }

            // Iniciar cámara de checkout si entramos en pantalla de checkout
            if (screenName === 'checkout') {
                console.log('🟢 Entrando a pantalla CHECKOUT - Iniciando cámara de checkout...');
                // Pequeño delay para que el DOM se actualice
                setTimeout(() => {
                    console.log('⏰ Timeout completado - llamando a startCheckoutCameraIntegrated()');
                    window.scannerManager.startCheckoutCameraIntegrated();
                }, 100);
            }

            // Actualizar vista del carrito cuando se accede a esa pantalla
            if (screenName === 'cart') {
                this.updateCartView();
                console.log('Vista del carrito actualizada');
            }

            // Verificar que el usuario está logueado al entrar en historial
            if (screenName === 'purchaseHistory') {
                if (!this.currentUser) {
                    window.ui.showToast('Debes iniciar sesión para ver tu historial', 'warning');
                    this.showScreen('cart');
                    this.updateActiveNav('cart');
                    return;
                }
                // Mostrar empty state al entrar
                this.showHistoryEmptyState();
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
            let productos = [];
            
            if (code) {
                // Búsqueda por código con prioridad a match exacto
                productos = await window.cartManager.searchByCodeSmart(code);
            } else if (description) {
                // Búsqueda por descripción (todas las palabras)
                productos = await window.cartManager.searchByDescriptionAllWords(description);
            }
            
            this.displaySearchResults(productos);
        } catch (error) {
            console.error('Error en búsqueda:', error);
            window.ui.showToast('Error al buscar productos', 'error');
        }
    }

    /**
     * Muestra resultados de búsqueda con imágenes
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

        resultsList.innerHTML = productos.map(producto => {
            const priceWithIVA = producto.pvp * 1.21;
            const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo}_1.JPG`;
            
            return `
                <div class="result-item-with-image" onclick="window.app.addProductToCart('${producto.codigo}', '${producto.descripcion.replace(/'/g, "\\'")}', ${producto.pvp})">
                    <div class="result-image">
                        <img src="${imageUrl}" alt="${producto.descripcion}" 
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="result-image-placeholder" style="display: none;">📦</div>
                    </div>
                    <div class="result-info">
                        <div class="result-code">${producto.codigo}</div>
                        <div class="result-name">${producto.descripcion}</div>
                        <div class="result-price">${priceWithIVA.toFixed(2)} €</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Añade producto al carrito desde búsqueda
     */
    async addProductToCart(codigo, descripcion, pvp) {
        try {
            await window.cartManager.addProduct({
                codigo,
                descripcion,
                pvp
            }, 1);
            
            window.ui.showToast('Producto añadido al carrito', 'success');
            window.ui.updateCartBadge();
            
            // Si estamos en la pantalla de carrito, actualizar vista
            if (this.currentScreen === 'cart') {
                this.updateCartView();
            }
        } catch (error) {
            console.error('Error al añadir producto:', error);
            window.ui.showToast('Error al añadir producto', 'error');
        }
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
        const container = document.getElementById('cartItems');
        const emptyState = document.getElementById('emptyCart');
        
        if (!container || !emptyState) {
            console.error('Elementos del carrito no encontrados en el DOM');
            return;
        }

        if (cart.productos.length === 0) {
            // Mostrar estado vacío
            emptyState.style.display = 'flex';
            container.style.display = 'none';
            container.innerHTML = '';
            
            // Actualizar header
            this.updateCartHeader(0, 0);
            
            return;
        }

        // Ocultar estado vacío y mostrar productos
        emptyState.style.display = 'none';
        container.style.display = 'block';
        container.innerHTML = '';

        // Añadir productos
        cart.productos.forEach(producto => {
            const card = this.createCartProductCard(producto);
            container.appendChild(card);
        });

        // Actualizar header con totales
        const totalWithIVA = cart.total_importe * 1.21;
        this.updateCartHeader(cart.total_productos, totalWithIVA);
    }
    
    /**
     * Actualiza el header del carrito con contadores
     */
    updateCartHeader(itemsCount, totalPrice) {
        const itemsElement = document.getElementById('itemsCount');
        const priceElement = document.getElementById('totalPrice');
        
        if (itemsElement) {
            itemsElement.textContent = `${itemsCount} producto${itemsCount !== 1 ? 's' : ''}`;
        }
        
        if (priceElement) {
            priceElement.textContent = `${totalPrice.toFixed(2)} €`;
        }
    }

    /**
     * Crea una tarjeta de producto para el carrito (estilo Tesco)
     */
    createCartProductCard(producto) {
        const card = document.createElement('div');
        card.className = 'cart-product-card';

        const priceWithIVA = producto.precio_unitario * 1.21;
        const subtotalWithIVA = producto.subtotal * 1.21;

        const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo_producto}_1.JPG`;
        
        card.innerHTML = `
            <div class="cart-product-image">
                <div class="cart-product-quantity-badge">${producto.cantidad}</div>
                <img class="product-img" src="${imageUrl}" alt="${producto.descripcion_producto}" 
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="product-placeholder" style="display: none;">📦</div>
            </div>
            <div class="cart-product-info">
                <div class="cart-product-main">
                    <div class="cart-product-details">
                        <div class="cart-product-name">${producto.descripcion_producto}</div>
                        <div class="cart-product-code">${producto.codigo_producto}</div>
                        <div class="cart-product-price">${priceWithIVA.toFixed(2)} €</div>
                    </div>
                    <div class="cart-product-subtotal">${subtotalWithIVA.toFixed(2)} €</div>
                </div>
                <div class="cart-product-footer">
                    <div class="quantity-controls-compact">
                        <button class="qty-btn-compact" data-action="decrease" data-code="${producto.codigo_producto}">−</button>
                        <input type="number" class="qty-value-input" value="${producto.cantidad}" min="0" max="999" data-code="${producto.codigo_producto}">
                        <button class="qty-btn-compact" data-action="increase" data-code="${producto.codigo_producto}">+</button>
                    </div>
                </div>
            </div>
        `;

        // Añadir event listeners
        const decreaseBtn = card.querySelector('[data-action="decrease"]');
        const increaseBtn = card.querySelector('[data-action="increase"]');
        const qtyInput = card.querySelector('.qty-value-input');

        decreaseBtn.addEventListener('click', async () => {
            const newQty = producto.cantidad - 1;
            
            // Si la cantidad es 1, preguntar antes de eliminar
            if (producto.cantidad === 1) {
                const confirmDelete = await window.ui.showConfirm(
                    '¿ELIMINAR ARTÍCULO?',
                    `¿Deseas eliminar "${producto.descripcion_producto}" del carrito?`,
                    'Eliminar',
                    'Cancelar'
                );
                if (!confirmDelete) return;
            }
            
            await this.updateProductQuantity(producto.codigo_producto, newQty);
        });

        increaseBtn.addEventListener('click', async () => {
            const newQty = producto.cantidad + 1;
            await this.updateProductQuantity(producto.codigo_producto, newQty);
        });

        // Input manual de cantidad
        qtyInput.addEventListener('blur', async (e) => {
            let newQty = parseInt(e.target.value) || 0;
            
            // Limitar entre 0 y 999
            if (newQty < 0) newQty = 0;
            if (newQty > 999) newQty = 999;
            
            // Si ponen 0, preguntar antes de eliminar
            if (newQty === 0) {
                const confirmDelete = await window.ui.showConfirm(
                    '¿ELIMINAR ARTÍCULO?',
                    `¿Deseas eliminar "${producto.descripcion_producto}" del carrito?`,
                    'Eliminar',
                    'Cancelar'
                );
                if (!confirmDelete) {
                    e.target.value = producto.cantidad;
                    return;
                }
            }
            
            // Si la cantidad no cambió, no hacer nada
            if (newQty === producto.cantidad) return;
            
            await this.updateProductQuantity(producto.codigo_producto, newQty);
        });

        // Permitir Enter para confirmar
        qtyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
            }
        });

        // Seleccionar todo al hacer foco
        qtyInput.addEventListener('focus', (e) => {
            e.target.select();
        });

        return card;
    }


    /**
     * Actualiza la cantidad de un producto (sin loading para mejor UX)
     */
    async updateProductQuantity(codigoProducto, newQuantity) {
        try {
            await window.cartManager.updateProductQuantity(codigoProducto, newQuantity);
            window.ui.updateCartBadge();
            this.updateCartView();

        } catch (error) {
            console.error('Error al actualizar cantidad:', error);
            window.ui.showToast('Error al actualizar cantidad', 'error');
        }
    }

    /**
     * Elimina un producto del carrito
     */
    async removeProduct(codigoProducto) {
        try {
            const confirm = await window.ui.showConfirm(
                '¿ELIMINAR ARTÍCULO?',
                '¿Deseas eliminar este producto del carrito?',
                'Eliminar',
                'Cancelar'
            );
            if (!confirm) return;

            await window.cartManager.removeProduct(codigoProducto);

            window.ui.showToast('Producto eliminado', 'success');
            window.ui.updateCartBadge();
            this.updateCartView();

        } catch (error) {
            console.error('Error al eliminar producto:', error);
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

    /**
     * Resetea el estado de permisos de cámara para volver a solicitarlos
     */
    resetCameraPermission() {
        localStorage.removeItem('cameraPermissionRequested');
        console.log('Estado de permisos de cámara reseteado');
        window.ui.showToast('Puedes volver a dar permisos de camara', 'info');
    }

    /**
     * Carga el historial de compras del usuario
     */
    async loadPurchaseHistory() {
        if (!this.currentUser) {
            window.ui.showToast('Debes iniciar sesión primero', 'warning');
            return;
        }

        try {
            // Ocultar empty state, mostrar loading
            const emptyState = document.getElementById('historyEmpty');
            const loadingState = document.getElementById('historyLoading');
            const resultsContainer = document.getElementById('historyResults');

            if (emptyState) emptyState.style.display = 'none';
            if (loadingState) loadingState.style.display = 'flex';
            if (resultsContainer) resultsContainer.style.display = 'none';

            // Obtener historial del usuario
            const historial = await window.supabaseClient.getUserPurchaseHistory(this.currentUser.user_id);

            // Ocultar loading
            if (loadingState) loadingState.style.display = 'none';

            // Mostrar resultados
            this.displayPurchaseHistory(historial);

        } catch (error) {
            console.error('Error al cargar historial:', error);
            window.ui.showToast('Error al cargar el historial', 'error');
            
            const loadingState = document.getElementById('historyLoading');
            if (loadingState) loadingState.style.display = 'none';
            this.showHistoryEmptyState();
        }
    }

    /**
     * Busca en el historial con filtros
     */
    async searchPurchaseHistory() {
        if (!this.currentUser) {
            window.ui.showToast('Debes iniciar sesión primero', 'warning');
            return;
        }

        const codeInput = document.getElementById('historyCodeInput');
        const descInput = document.getElementById('historyDescriptionInput');
        
        const codigo = codeInput?.value.trim() || null;
        const descripcion = descInput?.value.trim() || null;

        try {
            // Mostrar loading
            const loadingState = document.getElementById('historyLoading');
            const emptyState = document.getElementById('historyEmpty');
            const resultsContainer = document.getElementById('historyResults');

            if (emptyState) emptyState.style.display = 'none';
            if (loadingState) loadingState.style.display = 'flex';
            if (resultsContainer) resultsContainer.style.display = 'none';

            // Buscar con filtros
            const historial = await window.supabaseClient.getUserPurchaseHistory(
                this.currentUser.user_id,
                codigo,
                descripcion
            );

            // Ocultar loading
            if (loadingState) loadingState.style.display = 'none';

            // Mostrar resultados
            this.displayPurchaseHistory(historial);

        } catch (error) {
            console.error('Error al buscar en historial:', error);
            window.ui.showToast('Error al buscar en el historial', 'error');
            
            const loadingState = document.getElementById('historyLoading');
            if (loadingState) loadingState.style.display = 'none';
        }
    }

    /**
     * Muestra el historial de compras
     */
    displayPurchaseHistory(historial) {
        const resultsContainer = document.getElementById('historyResults');
        const emptyState = document.getElementById('historyEmpty');
        const resultsList = document.getElementById('historyResultsList');
        const resultsTitle = document.getElementById('historyResultsTitle');

        if (!resultsList) return;

        if (!historial || historial.length === 0) {
            if (resultsContainer) resultsContainer.style.display = 'none';
            if (emptyState) {
                emptyState.style.display = 'flex';
                emptyState.querySelector('.empty-icon').textContent = '😕';
                emptyState.querySelector('h2').textContent = 'No se encontraron productos';
                emptyState.querySelector('p').textContent = 'Aún no has comprado ningún producto o no hay resultados con ese filtro';
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (resultsContainer) resultsContainer.style.display = 'block';
        if (resultsTitle) {
            resultsTitle.textContent = `${historial.length} producto${historial.length !== 1 ? 's' : ''} comprado${historial.length !== 1 ? 's' : ''} anteriormente`;
        }

        resultsList.innerHTML = historial.map(producto => {
            const priceWithIVA = producto.pvp * 1.21;
            const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo}_1.JPG`;
            
            // Formatear fecha de última compra
            const fechaUltimaCompra = new Date(producto.fecha_ultima_compra);
            const fechaFormateada = fechaUltimaCompra.toLocaleDateString('es-ES', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
            
            return `
                <div class="result-item-with-image" onclick="window.app.addProductToCartFromHistory('${producto.codigo}', '${producto.descripcion.replace(/'/g, "\\'")}', ${producto.pvp})">
                    <div class="result-image">
                        <img src="${imageUrl}" alt="${producto.descripcion}" 
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="result-image-placeholder" style="display: none;">📦</div>
                    </div>
                    <div class="result-info">
                        <div class="result-code">${producto.codigo}</div>
                        <div class="result-name">${producto.descripcion}</div>
                        <div class="result-price">${priceWithIVA.toFixed(2)} €</div>
                        <div class="result-meta">
                            <span class="result-purchase-count">Comprado ${producto.veces_comprado} ${producto.veces_comprado === 1 ? 'vez' : 'veces'}</span>
                            <span class="result-last-purchase">Última: ${fechaFormateada}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Añade un producto al carrito desde el historial
     */
    async addProductToCartFromHistory(codigo, descripcion, pvp) {
        try {
            await window.cartManager.addProduct({
                codigo,
                descripcion,
                pvp
            }, 1);
            
            window.ui.showToast('Producto añadido al carrito', 'success');
            window.ui.updateCartBadge();
            
        } catch (error) {
            console.error('Error al añadir producto:', error);
            window.ui.showToast('Error al añadir producto', 'error');
        }
    }

    /**
     * Muestra el estado vacío del historial
     */
    showHistoryEmptyState() {
        const emptyState = document.getElementById('historyEmpty');
        const resultsContainer = document.getElementById('historyResults');
        const loadingState = document.getElementById('historyLoading');

        if (loadingState) loadingState.style.display = 'none';
        if (resultsContainer) resultsContainer.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.querySelector('.empty-icon').textContent = '🛍️';
            emptyState.querySelector('h2').textContent = 'Tus últimas compras';
            emptyState.querySelector('p').textContent = 'Aquí encontrarás los productos que has comprado anteriormente';
        }
    }

    /**
     * Limpia la búsqueda del historial
     */
    clearHistorySearch() {
        const codeInput = document.getElementById('historyCodeInput');
        const descInput = document.getElementById('historyDescriptionInput');

        if (codeInput) codeInput.value = '';
        if (descInput) descInput.value = '';

        this.showHistoryEmptyState();
    }

    /**
     * Solicita permisos de cámara de manera proactiva
     */
    async requestCameraPermissionProactively() {
        try {
            // Verificar si ya se solicitó anteriormente
            const permissionRequested = localStorage.getItem('cameraPermissionRequested');
            
            if (permissionRequested === 'true') {
                console.log('Permisos de cámara ya solicitados anteriormente');
                return;
            }

            // Verificar si la API de cámara está disponible
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.log('API de cámara no disponible');
                return;
            }

            // Esperar un momento para que el usuario vea la interfaz primero
            await new Promise(resolve => setTimeout(resolve, 1500));

            console.log('Solicitando permisos de cámara de manera proactiva...');

            // Intentar acceder a la cámara
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: "environment" } 
                });
                
                // Permiso concedido - detener el stream inmediatamente
                stream.getTracks().forEach(track => track.stop());
                
                console.log('Permisos de cámara concedidos');
                localStorage.setItem('cameraPermissionRequested', 'true');
                
                // Mostrar mensaje de éxito
                window.ui.showToast('Camara lista para escanear', 'success');
                
            } catch (permissionError) {
                console.log('Permiso de cámara denegado o no disponible:', permissionError);
                
                // Marcar como solicitado para no molestar de nuevo
                localStorage.setItem('cameraPermissionRequested', 'true');
                
                // Mostrar mensaje informativo si el usuario denegó el permiso
                if (permissionError.name === 'NotAllowedError') {
                    setTimeout(() => {
                        window.ui.showToast(
                            'Necesitas activar la camara para escanear productos',
                            'warning'
                        );
                    }, 500);
                }
            }

        } catch (error) {
            console.error('Error al solicitar permisos de cámara:', error);
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

