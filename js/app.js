/**
 * Aplicación principal Scan as You Shop
 */

class ScanAsYouShopApp {
    constructor() {
        this.currentScreen = 'welcome';
        this.isInitialized = false;
        this.currentUser = null;
        this.currentSession = null;
        this.ordersSubscription = null;
        this.notificationsEnabled = false;
    }

    /**
     * Escapa caracteres especiales para uso seguro en atributos HTML onclick
     * Usa entidades HTML para evitar conflictos con delimitadores
     * @param {string} str - Cadena a escapar
     * @returns {string} - Cadena escapada
     */
    escapeForHtmlAttribute(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')   // Ampersands primero
            .replace(/'/g, '&#39;')   // Comillas simples (como entidad HTML)
            .replace(/"/g, '&quot;')  // Comillas dobles (como entidad HTML)
            .replace(/</g, '&lt;')    // Menor que
            .replace(/>/g, '&gt;')    // Mayor que
            .replace(/\n/g, ' ')      // Saltos de línea como espacio
            .replace(/\r/g, '');      // Eliminar retornos de carro
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

            // Inicializar cliente ERP (sin bloqueo)
            if (window.erpClient) {
                window.erpClient.initialize();
            }

            // Verificar si hay sesión guardada
            const savedUser = this.loadUserSession();
            if (savedUser) {
                console.log('Sesion de usuario encontrada:', savedUser.user_name);
                this.currentUser = savedUser;
                this.updateUserUI();
                
                // Precargar historial de compras en segundo plano (Phase 2 - Cache)
                if (window.purchaseCache && savedUser.user_id) {
                    console.log('🚀 Precargando historial para sesión guardada...');
                    window.purchaseCache.preload(savedUser.user_id);
                }

                // Solicitar permisos de notificaciones para sesión guardada
                await this.requestNotificationPermission();

                // Configurar listener de cambios de estado de pedidos
                this.setupOrderStatusListener();
            }

            // Inicializar app (con o sin usuario logueado)
            await this.initializeApp();
            
            // Cargar ofertas en segundo plano si no están en cache
            this.loadOfertasIfNeeded();

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
                    codigo_usuario: loginResult.codigo_usuario,
                    codigo_cliente: loginResult.codigo_cliente,
                    almacen_habitual: loginResult.almacen_habitual
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

                // Precargar historial de compras en segundo plano (Phase 2 - Cache)
                if (window.purchaseCache) {
                    console.log('🚀 Precargando historial de compras...');
                    window.purchaseCache.preload(this.currentUser.user_id);
                }

                // Solicitar permisos de notificaciones
                await this.requestNotificationPermission();

                // Configurar listener de cambios de estado de pedidos
                this.setupOrderStatusListener();

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
     * Solicita permisos para notificaciones
     */
    async requestNotificationPermission() {
        try {
            // Verificar si el navegador soporta notificaciones
            if (!('Notification' in window)) {
                console.log('Este navegador no soporta notificaciones');
                return false;
            }

            // Si ya tenemos permiso, no preguntar de nuevo
            if (Notification.permission === 'granted') {
                console.log('Permisos de notificación ya otorgados');
                this.notificationsEnabled = true;
                return true;
            }

            // Si el permiso fue denegado previamente, no insistir
            if (Notification.permission === 'denied') {
                console.log('Permisos de notificación denegados');
                return false;
            }

            // Solicitar permiso
            const permission = await Notification.requestPermission();
            
            if (permission === 'granted') {
                console.log('Permisos de notificación otorgados');
                this.notificationsEnabled = true;
                
                // Mostrar notificación de bienvenida
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.ready.then(registration => {
                        registration.showNotification('Notificaciones activadas', {
                            body: 'Te avisaremos cuando tu pedido esté listo',
                            icon: '/icon-192.png',
                            badge: '/icon-192.png',
                            tag: 'welcome-notification'
                        });
                    });
                }
                
                return true;
            }

            return false;

        } catch (error) {
            console.error('Error al solicitar permisos de notificación:', error);
            return false;
        }
    }

    /**
     * Configura el listener de Supabase Realtime para detectar cambios en pedidos
     */
    setupOrderStatusListener() {
        try {
            if (!this.currentUser || !this.currentUser.user_id) {
                console.log('No hay usuario logueado, no se configurará listener de pedidos');
                return;
            }

            // Cancelar suscripción anterior si existe
            if (this.ordersSubscription) {
                console.log('Cancelando suscripción anterior de pedidos');
                this.ordersSubscription.unsubscribe();
            }

            console.log(`📡 Configurando listener de pedidos para usuario ${this.currentUser.user_id}`);

            // Crear suscripción a cambios en carritos_clientes
            this.ordersSubscription = window.supabaseClient.client
                .channel('order-status-changes')
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'carritos_clientes',
                        filter: `usuario_id=eq.${this.currentUser.user_id}`
                    },
                    (payload) => {
                        console.log('🔔 Cambio detectado en pedido:', payload);
                        console.log('   - Tipo de evento:', payload.eventType);
                        console.log('   - Datos nuevos:', payload.new);
                        console.log('   - Datos antiguos:', payload.old);
                        this.handleOrderStatusChange(payload);
                    }
                )
                .subscribe((status, err) => {
                    console.log('📡 Estado de suscripción de pedidos:', status);
                    if (err) {
                        console.error('❌ Error en suscripción de pedidos:', err);
                    }
                    if (status === 'SUBSCRIBED') {
                        console.log('✅ Suscripción a cambios de pedidos activa');
                    } else if (status === 'CHANNEL_ERROR') {
                        console.error('❌ Error en canal de pedidos. Verifica que Realtime esté habilitado en Supabase.');
                    }
                });

        } catch (error) {
            console.error('Error al configurar listener de pedidos:', error);
        }
    }

    /**
     * Maneja cambios en el estado de los pedidos
     */
    async handleOrderStatusChange(payload) {
        try {
            const newRecord = payload.new;
            const oldRecord = payload.old;

            console.log('📋 Manejando cambio de estado de pedido:');
            console.log('   - Estado anterior:', oldRecord?.estado_procesamiento);
            console.log('   - Estado nuevo:', newRecord?.estado_procesamiento);
            console.log('   - ID del pedido:', newRecord?.id);
            console.log('   - Código QR:', newRecord?.codigo_qr);

            // Verificar si el estado cambió a 'impreso' (Listo)
            if (
                newRecord?.estado_procesamiento === 'impreso' &&
                oldRecord?.estado_procesamiento !== 'impreso'
            ) {
                console.log('✅ Pedido marcado como LISTO (impreso) - ID:', newRecord.id);
                
                // Verificar permisos de notificación
                if (Notification.permission !== 'granted') {
                    console.warn('⚠️ Permisos de notificación no otorgados');
                    // Intentar solicitar permisos
                    await this.requestNotificationPermission();
                }
                
                // Mostrar notificación
                await this.showOrderReadyNotification(newRecord);

                // Recargar lista de pedidos si estamos en esa pantalla
                if (this.currentScreen === 'myOrders') {
                    console.log('Recargando lista de pedidos...');
                    await this.loadMyOrders();
                }
            } else {
                console.log('ℹ️ Cambio de estado no relevante para notificaciones');
            }

        } catch (error) {
            console.error('❌ Error al manejar cambio de estado de pedido:', error);
            console.error('   - Stack:', error.stack);
        }
    }

    /**
     * Muestra notificación cuando el pedido está listo
     */
    async showOrderReadyNotification(pedido) {
        try {
            console.log('🔔 Intentando mostrar notificación para pedido:', pedido.id);
            
            // Verificar si las notificaciones están habilitadas
            if (!this.notificationsEnabled || Notification.permission !== 'granted') {
                console.warn('⚠️ Notificaciones no habilitadas. Permiso:', Notification.permission);
                // Intentar solicitar permisos si no están denegados
                if (Notification.permission === 'default') {
                    console.log('📱 Solicitando permisos de notificación...');
                    await this.requestNotificationPermission();
                } else {
                    return;
                }
            }

            // Verificar si hay Service Worker disponible
            if (!('serviceWorker' in navigator)) {
                console.error('❌ Service Worker no soportado en este navegador');
                return;
            }

            if (!navigator.serviceWorker.controller) {
                console.warn('⚠️ Service Worker no está activo. Esperando registro...');
                // Esperar a que el Service Worker esté listo
                const registration = await navigator.serviceWorker.ready;
                if (!registration) {
                    console.error('❌ No se pudo obtener el Service Worker');
                    return;
                }
            }

            const registration = await navigator.serviceWorker.ready;
            console.log('✅ Service Worker listo para mostrar notificación');

            // Obtener nombre del almacén
            const almacen = pedido.almacen_destino || 'Almacén';

            // Título original con emoji
            const titulo = '🎉 ¡Tu Pedido está Listo!';
            // Mensaje con almacén al principio
            const mensaje = `ALMACEN ${almacen}: Tu pedido está listo para recoger.`;

            // Crear notificación
            await registration.showNotification(titulo, {
                body: mensaje,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: `order-ready-${pedido.id}`,
                requireInteraction: true,
                vibrate: [200, 100, 200, 100, 200],
                data: {
                    orderId: pedido.id,
                    codigoQR: pedido.codigo_qr,
                    almacen: almacen,
                    url: '/'
                },
                actions: [
                    {
                        action: 'open',
                        title: 'Ver Mis Pedidos'
                    },
                    {
                        action: 'close',
                        title: 'Cerrar'
                    }
                ]
            });

            console.log(`🔔 Notificación mostrada: ${titulo} - ${mensaje}`);

        } catch (error) {
            console.error('Error al mostrar notificación:', error);
        }
    }

    /**
     * Cancela la suscripción de cambios de pedidos
     */
    unsubscribeFromOrderStatus() {
        if (this.ordersSubscription) {
            console.log('Cancelando suscripción de pedidos');
            this.ordersSubscription.unsubscribe();
            this.ordersSubscription = null;
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
        const historyFilterGroup = document.querySelector('.history-filter-group');

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
            // Mostrar filtro de historial en búsqueda
            if (historyFilterGroup) historyFilterGroup.style.display = 'block';
        } else {
            // Usuario NO logueado
            if (menuGuest) menuGuest.style.display = 'block';
            if (menuUser) menuUser.style.display = 'none';
            // Ocultar filtro de historial en búsqueda
            if (historyFilterGroup) historyFilterGroup.style.display = 'none';
        }
    }

    /**
     * Cierra la sesión del usuario
     */
    async logout() {
        try {
            // Cancelar suscripción de cambios de pedidos
            this.unsubscribeFromOrderStatus();

            // Cerrar sesión en Supabase
            if (this.currentSession) {
                await window.supabaseClient.closeUserSession(this.currentSession);
            }

            // Limpiar datos locales
            localStorage.removeItem('current_user');
            localStorage.removeItem('current_session');
            this.currentUser = null;
            this.currentSession = null;

            // Desmarcar checkbox de historial en búsqueda
            const onlyPurchasedCheckbox = document.getElementById('onlyPurchasedCheckbox');
            if (onlyPurchasedCheckbox) {
                onlyPurchasedCheckbox.checked = false;
            }

            // Limpiar cache de historial (Phase 2 - Cache)
            if (window.purchaseCache) {
                window.purchaseCache.clearAll();
                console.log('🗑️ Cache de historial limpiado al cerrar sesión');
            }

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
     * Usa sincronización incremental cuando sea posible para mayor velocidad
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

            // Obtener versión local para sincronización incremental
            const versionLocalHash = localStorage.getItem('version_hash_local');
            let useIncremental = false;
            let changeStats = null;

            // Si hay versión local, intentar sincronización incremental
            if (versionLocalHash) {
                console.log('⚡ Intentando sincronización incremental...');
                window.ui.updateSyncIndicator('Analizando cambios...');
                
                try {
                    changeStats = await window.supabaseClient.getChangeStatistics(versionLocalHash);
                    
                    if (changeStats && changeStats.total_cambios !== null) {
                        const totalCambios = changeStats.total_cambios;
                        const totalProductos = changeStats.productos_modificados + changeStats.productos_nuevos;
                        
                        // Usar incremental si hay menos de 1000 cambios (umbral configurable)
                        // Si hay muchos cambios, es más eficiente hacer sincronización completa
                        if (totalCambios > 0 && totalCambios < 1000) {
                            useIncremental = true;
                            console.log(`⚡ Sincronización incremental: ${totalCambios} cambios detectados`);
                            console.log(`   - Productos: ${changeStats.productos_nuevos} nuevos, ${changeStats.productos_modificados} modificados`);
                            console.log(`   - Códigos: ${changeStats.codigos_nuevos} nuevos, ${changeStats.codigos_modificados} modificados`);
                        } else if (totalCambios >= 1000) {
                            console.log(`📦 Muchos cambios (${totalCambios}), usando sincronización completa para mejor rendimiento`);
                        }
                    }
                } catch (statsError) {
                    console.warn('⚠️ No se pudieron obtener estadísticas, usando sincronización completa:', statsError);
                }
            }

            console.log(useIncremental ? '⚡ Descargando cambios incrementales...' : '📥 Descargando catálogo completo...');
            window.ui.updateSyncIndicator(useIncremental ? 'Descargando cambios...' : 'Descargando...');

            // Callback de progreso
            const onProgress = (progress) => {
                const percent = progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0;
                window.ui.updateSyncIndicator(`${percent}%`);
            };

            let productos, codigosSecundarios, isIncremental;

            if (useIncremental) {
                // Sincronización incremental
                const result = await window.supabaseClient.downloadProductsIncremental(versionLocalHash, onProgress);
                productos = result.productos;
                codigosSecundarios = result.codigosSecundarios;
                isIncremental = result.isIncremental;
            } else {
                // Sincronización completa
                const result = await window.supabaseClient.downloadProducts(onProgress);
                productos = result.productos;
                codigosSecundarios = result.codigosSecundarios;
                isIncremental = false;
            }

            // Guardar en almacenamiento local
            if (isIncremental) {
                // Actualización incremental (más rápida)
                window.ui.updateSyncIndicator('Aplicando cambios...');
                const productosResult = await window.cartManager.updateProductsIncremental(productos);
                window.ui.updateSyncIndicator('Aplicando códigos...');
                const codigosResult = await window.cartManager.updateSecondaryCodesIncremental(codigosSecundarios);
                
                console.log(`✅ Cambios aplicados: ${productosResult.inserted + productosResult.updated} productos, ${codigosResult.inserted + codigosResult.updated} códigos`);
            } else {
                // Reemplazo completo (más lento pero necesario para primera sincronización o muchos cambios)
                window.ui.updateSyncIndicator('Guardando productos...');
                await window.cartManager.saveProductsToStorage(productos);
                
                window.ui.updateSyncIndicator('Guardando códigos secundarios...');
                await window.cartManager.saveSecondaryCodesToStorage(codigosSecundarios);
            }

            // Descargar ofertas en segundo plano (sin bloquear)
            window.ui.updateSyncIndicator('Descargando ofertas...');
            try {
                await window.supabaseClient.downloadOfertas(onProgress);
                console.log('✅ Ofertas descargadas y guardadas en caché');
            } catch (ofertaError) {
                console.error('Error al descargar ofertas (no crítico):', ofertaError);
            }

            // Actualizar hash local
            await window.supabaseClient.actualizarVersionLocal(versionCheck.versionRemota);

            const mensaje = isIncremental 
                ? `Catálogo actualizado - ${productos.length} cambios aplicados`
                : `Catálogo actualizado - ${productos.length} productos`;

            console.log('✅ Productos y códigos secundarios sincronizados correctamente');
            window.ui.showSyncIndicator(false);
            window.ui.showToast(mensaje, 'success');

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

        // My Orders button (menu hamburguesa)
        const myOrdersBtn = document.getElementById('myOrdersBtn');
        if (myOrdersBtn) {
            myOrdersBtn.addEventListener('click', () => {
                this.closeMenu();
                this.showScreen('myOrders');
                this.updateActiveNav('myOrders');
                this.loadMyOrders();
            });
        }

        // Botón para enviar pedido remoto
        const sendRemoteOrderBtn = document.getElementById('sendRemoteOrderBtn');
        if (sendRemoteOrderBtn) {
            sendRemoteOrderBtn.addEventListener('click', () => {
                this.showAlmacenSelectionModal();
            });
        }

        // Cerrar modal de almacén
        const closeAlmacenModal = document.getElementById('closeAlmacenModal');
        if (closeAlmacenModal) {
            closeAlmacenModal.addEventListener('click', () => {
                this.hideAlmacenModal();
            });
        }

        // Cerrar modal de almacén al hacer clic en overlay
        const almacenModal = document.getElementById('almacenModal');
        if (almacenModal) {
            almacenModal.addEventListener('click', (e) => {
                if (e.target.id === 'almacenModal' || e.target.classList.contains('login-modal-overlay')) {
                    this.hideAlmacenModal();
                }
            });
        }

        // Botones de selección de almacén
        const almacenButtons = document.querySelectorAll('.almacen-btn');
        almacenButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const almacen = btn.dataset.almacen;
                this.sendRemoteOrder(almacen);
            });
        });
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
                
                // Mostrar/ocultar sección de pedido remoto según si hay usuario logueado
                const remoteOrderSection = document.getElementById('remoteOrderSection');
                if (remoteOrderSection) {
                    remoteOrderSection.style.display = this.currentUser ? 'block' : 'none';
                }
            }

            // Actualizar vista del carrito cuando se accede a esa pantalla
            if (screenName === 'cart') {
                this.updateCartView();
                console.log('Vista del carrito actualizada');
            }

        }
    }

    /**
     * Realiza la búsqueda
     */
    async performSearch() {
        const codeInput = document.getElementById('codeSearchInput');
        const descInput = document.getElementById('descriptionSearchInput');
        const onlyPurchasedCheckbox = document.getElementById('onlyPurchasedCheckbox');
        
        const code = codeInput?.value.trim() || '';
        const description = descInput?.value.trim() || '';
        const onlyPurchased = onlyPurchasedCheckbox?.checked || false;

        if (!code && !description) {
            window.ui.showToast('Introduce un código o descripción', 'warning');
            return;
        }

        // Si el filtro de "solo comprados" está activo, verificar que el usuario esté logueado
        if (onlyPurchased && !this.currentUser) {
            window.ui.showToast('Debes iniciar sesión para filtrar por historial', 'warning');
            onlyPurchasedCheckbox.checked = false;
            return;
        }

        try {
            let productos = [];
            
            if (onlyPurchased) {
                // Búsqueda en el historial de compras del usuario (CON CACHE)
                console.log('📦 Buscando en historial de compras (con cache)...');
                const historial = await window.purchaseCache.getUserHistory(
                    this.currentUser.user_id,
                    code || null,
                    description || null
                );
                
                // Convertir historial a formato de productos para displaySearchResults
                productos = historial.map(item => ({
                    codigo: item.codigo,
                    descripcion: item.descripcion,
                    pvp: item.pvp,
                    fecha_ultima_compra: item.fecha_ultima_compra
                }));
                
            } else {
                // Búsqueda en el catálogo completo
                if (code && description) {
                    // Búsqueda combinada: primero por descripción, luego filtrar por código
                    console.log('🔍 Búsqueda combinada: descripción + código');
                    const productosPorDescripcion = await window.cartManager.searchByDescriptionAllWords(description);
                    
                    // Filtrar por código dentro de los resultados de descripción
                    const codeUpper = code.toUpperCase().trim();
                    productos = productosPorDescripcion.filter(p => 
                        p.codigo.toUpperCase().includes(codeUpper)
                    );
                    
                    console.log(`📊 Resultados: ${productosPorDescripcion.length} por descripción → ${productos.length} con código`);
                    
                } else if (code) {
                    // Búsqueda por código con prioridad a match exacto
                    productos = await window.cartManager.searchByCodeSmart(code);
                } else if (description) {
                    // Búsqueda por descripción (todas las palabras)
                    productos = await window.cartManager.searchByDescriptionAllWords(description);
                }
            }
            
            await this.displaySearchResults(productos, onlyPurchased);
        } catch (error) {
            console.error('Error en búsqueda:', error);
            window.ui.showToast('Error al buscar productos', 'error');
        }
    }

    /**
     * Muestra resultados de búsqueda con imágenes
     */
    async displaySearchResults(productos, isFromHistory = false) {
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
                emptyState.querySelector('p').textContent = isFromHistory 
                    ? 'No se encontraron productos en tu historial de compras' 
                    : 'No se encontraron productos';
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (resultsContainer) resultsContainer.style.display = 'block';
        
        // Limitar resultados mostrados para mantener velocidad
        const LIMITE_RESULTADOS = 200;
        const productosLimitados = productos.slice(0, LIMITE_RESULTADOS);
        const hayMasResultados = productos.length > LIMITE_RESULTADOS;
        
        // Actualizar título con información de límite si aplicla
        if (resultsTitle) {
            const totalText = `${productos.length} resultado${productos.length !== 1 ? 's' : ''}`;
            const limitText = hayMasResultados ? ` (mostrando ${LIMITE_RESULTADOS})` : '';
            const historyText = isFromHistory ? ' comprado' + (productos.length !== 1 ? 's' : '') + ' anteriormente' : '';
            resultsTitle.textContent = totalText + limitText + historyText;
        }

        // Pre-cargar índice de productos con ofertas desde cache LOCAL (RÁPIDO)
        const productosConOfertas = new Set();
        const codigoCliente = this.currentUser?.codigo_cliente || null;
        
        if (codigoCliente && window.cartManager && window.cartManager.db) {
            console.log('🔍 Cargando índice de ofertas desde cache local...');
            const inicio = performance.now();
            try {
                // Obtener TODOS los productos en ofertas de UNA SOLA VEZ desde IndexedDB
                const ofertasProductosCache = await window.cartManager.getAllOfertasProductosFromCache(codigoCliente);
                for (const op of ofertasProductosCache) {
                    productosConOfertas.add(op.codigo_articulo.toUpperCase());
                }
                const tiempo = (performance.now() - inicio).toFixed(0);
                console.log(`✅ Índice de ofertas cargado en ${tiempo}ms: ${productosConOfertas.size} productos con ofertas`);
            } catch (error) {
                console.error('Error al cargar índice de ofertas:', error);
            }
        } else {
            console.log('🚫 Usuario invitado - no se muestran ofertas en búsqueda');
        }

        resultsList.innerHTML = productosLimitados.map(producto => {
            const priceWithIVA = producto.pvp * 1.21;
            const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo}_1.JPG`;
            const escapedDescripcion = this.escapeForHtmlAttribute(producto.descripcion);
            
            // Añadir indicador de oferta al código si tiene ofertas
            const tieneOferta = productosConOfertas.has(producto.codigo.toUpperCase());
            if (tieneOferta) {
                console.log(`✅ Código ${producto.codigo} encontrado con oferta`);
            }
            const codigoConOferta = tieneOferta 
                ? `${producto.codigo} - <span class="oferta-tag">[OFERTA]</span>` 
                : producto.codigo;
            
            // Si es del historial, mostrar fecha de última compra y botón de eliminar
            if (isFromHistory && producto.fecha_ultima_compra) {
                const fechaUltimaCompra = new Date(producto.fecha_ultima_compra);
                const fechaFormateada = fechaUltimaCompra.toLocaleDateString('es-ES', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric' 
                });
                
                return `
                    <div class="result-item-with-image history-item">
                        <div class="result-image" onclick="window.app.addProductToCart('${producto.codigo}', '${escapedDescripcion}', ${producto.pvp})">
                            <img src="${imageUrl}" alt="${producto.descripcion}" 
                                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                            <div class="result-image-placeholder" style="display: none;">📦</div>
                        </div>
                        <div class="result-info" onclick="window.app.addProductToCart('${producto.codigo}', '${escapedDescripcion}', ${producto.pvp})">
                            <div class="result-code">${codigoConOferta}</div>
                            <div class="result-name">${producto.descripcion}</div>
                            <div class="result-price">${priceWithIVA.toFixed(2)} €</div>
                            <div class="result-meta">
                                <span class="result-last-purchase">Última compra: ${fechaFormateada}</span>
                            </div>
                        </div>
                        <button class="btn-delete-history" onclick="event.stopPropagation(); window.app.deleteProductFromHistory('${producto.codigo}', '${escapedDescripcion}')">
                            🗑️
                        </button>
                    </div>
                `;
            }
            
            // Resultado normal
            return `
                <div class="result-item-with-image" onclick="window.app.addProductToCart('${producto.codigo}', '${escapedDescripcion}', ${producto.pvp})">
                    <div class="result-image">
                        <img src="${imageUrl}" alt="${producto.descripcion}" 
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="result-image-placeholder" style="display: none;">📦</div>
                    </div>
                    <div class="result-info">
                        <div class="result-code">${codigoConOferta}</div>
                        <div class="result-name">${producto.descripcion}</div>
                        <div class="result-price">${priceWithIVA.toFixed(2)} €</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Muestra el modal de añadir al carrito con selección de cantidad
     */
    async showAddToCartModal(producto) {
        return new Promise(async (resolve) => {
            const modal = document.getElementById('addToCartModal');
            const overlay = modal.querySelector('.add-to-cart-overlay');
            const closeBtn = document.getElementById('closeAddToCartModal');
            const img = document.getElementById('addToCartImg');
            const placeholder = modal.querySelector('.add-to-cart-placeholder');
            const codeEl = document.getElementById('addToCartCode');
            const descriptionEl = document.getElementById('addToCartDescription');
            const priceEl = document.getElementById('addToCartPrice');
            const ofertaBadge = document.getElementById('addToCartOfertaBadge');
            const qtyInput = document.getElementById('qtyInputModal');
            const decreaseBtn = document.getElementById('decreaseQtyModal');
            const increaseBtn = document.getElementById('increaseQtyModal');
            const confirmBtn = document.getElementById('confirmAddToCartBtn');

            if (!modal) {
                console.error('Modal de añadir al carrito no encontrado');
                resolve(null);
                return;
            }

            // Configurar información del producto
            const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo}_1.JPG`;
            img.src = imageUrl;
            img.style.display = 'block';
            placeholder.style.display = 'none';

            img.onerror = () => {
                img.style.display = 'none';
                placeholder.style.display = 'flex';
            };

            codeEl.textContent = producto.codigo;
            descriptionEl.textContent = producto.descripcion;
            const priceWithIVA = producto.pvp * 1.21;
            priceEl.textContent = `${priceWithIVA.toFixed(2)} €`;

            // Verificar si el producto tiene ofertas (solo para usuarios con codigo_cliente)
            let ofertaData = null;
            const codigoCliente = this.currentUser?.codigo_cliente || null;
            
            if (!codigoCliente) {
                // Usuario invitado: no mostrar ofertas
                console.log('🚫 Usuario invitado - no se verifican ofertas en modal');
                if (ofertaBadge) {
                    ofertaBadge.style.display = 'none';
                    ofertaBadge.onclick = null;
                }
            } else {
                // Usuario con código de cliente: verificar ofertas
                try {
                    const ofertasProducto = await window.supabaseClient.getOfertasProducto(producto.codigo, codigoCliente, true);
                    
                    if (ofertasProducto && ofertasProducto.length > 0 && ofertaBadge) {
                        // Obtener información completa de la primera oferta
                        const primeraOferta = ofertasProducto[0];
                        ofertaData = await this.getOfertaInfo(primeraOferta.numero_oferta);
                        
                        ofertaBadge.style.display = 'block';
                        
                        // Añadir manejador de clic al badge
                        ofertaBadge.onclick = () => this.showOfertaInfoModal(ofertaData);
                    } else if (ofertaBadge) {
                        ofertaBadge.style.display = 'none';
                        ofertaBadge.onclick = null;
                    }
                } catch (error) {
                    console.error('Error al verificar ofertas en modal:', error);
                    if (ofertaBadge) {
                        ofertaBadge.style.display = 'none';
                        ofertaBadge.onclick = null;
                    }
                }
            }

            // Resetear cantidad a 1
            qtyInput.value = 1;

            // Mostrar modal
            modal.style.display = 'flex';

            // Manejadores de eventos
            const handleClose = () => {
                modal.style.display = 'none';
                cleanup();
                resolve(null);
            };

            const handleConfirm = async () => {
                const cantidad = parseInt(qtyInput.value) || 1;
                modal.style.display = 'none';
                cleanup();
                resolve(cantidad);
            };

            const handleDecrease = () => {
                let value = parseInt(qtyInput.value) || 1;
                if (value > 1) {
                    qtyInput.value = value - 1;
                }
            };

            const handleIncrease = () => {
                let value = parseInt(qtyInput.value) || 1;
                if (value < 999) {
                    qtyInput.value = value + 1;
                }
            };

            const handleInputChange = () => {
                let value = parseInt(qtyInput.value) || 1;
                if (value < 1) value = 1;
                if (value > 999) value = 999;
                qtyInput.value = value;
            };

            const handleFocus = (e) => {
                e.target.select();
            };

            const handleKeyPress = (e) => {
                // Si se presiona Enter, añadir al carrito
                if (e.key === 'Enter' || e.keyCode === 13) {
                    e.preventDefault();
                    handleConfirm();
                }
            };

            const cleanup = () => {
                closeBtn.removeEventListener('click', handleClose);
                overlay.removeEventListener('click', handleClose);
                confirmBtn.removeEventListener('click', handleConfirm);
                decreaseBtn.removeEventListener('click', handleDecrease);
                increaseBtn.removeEventListener('click', handleIncrease);
                qtyInput.removeEventListener('input', handleInputChange);
                qtyInput.removeEventListener('focus', handleFocus);
                qtyInput.removeEventListener('keypress', handleKeyPress);
            };

            // Limpiar listeners previos antes de añadir nuevos (por si el modal se abrió antes sin limpiarse)
            cleanup();

            // Añadir listeners - usar { once: false } explícitamente
            closeBtn.addEventListener('click', handleClose);
            overlay.addEventListener('click', handleClose);
            confirmBtn.addEventListener('click', handleConfirm);
            decreaseBtn.addEventListener('click', handleDecrease);
            increaseBtn.addEventListener('click', handleIncrease);
            qtyInput.addEventListener('input', handleInputChange);
            qtyInput.addEventListener('focus', handleFocus);
            qtyInput.addEventListener('keypress', handleKeyPress);
        });
    }

    /**
     * Añade producto al carrito desde búsqueda (ahora con modal de cantidad)
     */
    async addProductToCart(codigo, descripcion, pvp) {
        try {
            console.log('addProductToCart llamado con:', codigo, descripcion, pvp);
            
            // Mostrar modal de cantidad
            console.log('Mostrando modal de cantidad...');
            const cantidad = await this.showAddToCartModal({
                codigo,
                descripcion,
                pvp
            });

            console.log('Cantidad seleccionada:', cantidad);

            // Si el usuario canceló, no hacer nada
            if (cantidad === null) {
                console.log('Usuario canceló el modal');
                return;
            }

            // Añadir al carrito
            console.log('Añadiendo al carrito:', cantidad, 'unidades');
            await window.cartManager.addProduct({
                codigo,
                descripcion,
                pvp
            }, cantidad);
            
            window.ui.showToast(`Producto añadido (x${cantidad})`, 'success');
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
        const onlyPurchasedCheckbox = document.getElementById('onlyPurchasedCheckbox');
        const resultsContainer = document.getElementById('searchResults');
        const emptyState = document.getElementById('searchEmpty');

        if (codeInput) codeInput.value = '';
        if (descInput) descInput.value = '';
        if (onlyPurchasedCheckbox) onlyPurchasedCheckbox.checked = false;
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
            
            // Invalidar cache de historial si hay usuario logueado (Phase 2 - Cache)
            if (this.currentUser && window.purchaseCache) {
                console.log('🔄 Invalidando cache de historial tras compra...');
                window.purchaseCache.invalidateUser(this.currentUser.user_id);
            }
            
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
    async updateCartView() {
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

        // Verificar si necesitamos regenerar todo o solo actualizar
        const existingCards = container.querySelectorAll('.cart-product-card');
        const needsFullRefresh = existingCards.length !== cart.productos.length;

        if (needsFullRefresh) {
            // Solo regenerar todo si cambió el número de productos
            container.innerHTML = '';
            for (const producto of cart.productos) {
                const card = await this.createCartProductCard(producto);
                container.appendChild(card);
            }
        } else {
            // Actualizar solo los valores sin regenerar el DOM
            for (let i = 0; i < cart.productos.length; i++) {
                const producto = cart.productos[i];
                const card = existingCards[i];
                
                // Actualizar solo los elementos que pueden cambiar
                await this.updateCartProductCard(card, producto);
            }
        }

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
     * Verifica si una oferta se cumple y genera mensaje contextual inteligente
     * @returns {Object} { cumplida: boolean, mensaje: string }
     */
    async verificarOfertaCumplida(oferta, codigoArticulo, cantidad, carrito) {
        try {
            const tipoOferta = oferta.tipo_oferta;
            
            if (tipoOferta === 1) {
                // ESTANDAR: Se cumple si la cantidad del producto >= unidades_minimas
                const unidadesMinimas = oferta.unidades_minimas || 0;
                
                if (unidadesMinimas === 0) {
                    return { cumplida: false, mensaje: oferta.titulo_descripcion || 'Oferta disponible' };
                }
                
                const cumplida = cantidad >= unidadesMinimas;
                const faltantes = unidadesMinimas - cantidad;
                
                if (cumplida) {
                    return { cumplida: true, mensaje: `${oferta.titulo_descripcion || '¡Oferta aplicada!'}` };
                } else {
                    return { 
                        cumplida: false, 
                        mensaje: `Añade ${faltantes} unidad${faltantes !== 1 ? 'es' : ''} más para conseguir la oferta (mín: ${unidadesMinimas})`
                    };
                }
            }
            
            if (tipoOferta === 2) {
                // INTERVALO: Descuentos escalonados según el total de unidades de todos los productos de la oferta
                const intervalos = await window.supabaseClient.getIntervalosOferta(oferta.numero_oferta, true);
                if (!intervalos || intervalos.length === 0) {
                    return { cumplida: false, mensaje: oferta.titulo_descripcion || 'Oferta por intervalo (sin intervalos definidos)' };
                }
                
                // Ordenar intervalos por desde_unidades
                const intervalosOrdenados = intervalos.sort((a, b) => a.desde_unidades - b.desde_unidades);
                
                // Sumar unidades de todos los productos de esta oferta en el carrito
                let totalUnidades = 0;
                for (const prod of carrito.productos) {
                    const ofertasProd = await window.supabaseClient.getOfertasProducto(prod.codigo_producto, this.currentUser?.codigo_cliente || null, true);
                    const tieneEstaOferta = ofertasProd.some(o => o.numero_oferta === oferta.numero_oferta);
                    if (tieneEstaOferta) {
                        totalUnidades += prod.cantidad;
                    }
                }
                
                // Verificar si el total está en algún intervalo
                const intervaloActual = intervalosOrdenados.find(intervalo => 
                    totalUnidades >= intervalo.desde_unidades && totalUnidades <= intervalo.hasta_unidades
                );
                
                if (intervaloActual) {
                    // Buscar si hay un siguiente escalón
                    const siguienteIntervalo = intervalosOrdenados.find(i => i.desde_unidades > intervaloActual.hasta_unidades);
                    
                    if (siguienteIntervalo) {
                        const faltantes = siguienteIntervalo.desde_unidades - totalUnidades;
                        return { 
                            cumplida: true, 
                            mensaje: `¡${intervaloActual.descuento_porcentaje}% de descuento! (${totalUnidades} uds) Añade ${faltantes} más para ${siguienteIntervalo.descuento_porcentaje}%`
                        };
                    } else {
                        // Está en el último escalón
                        return { 
                            cumplida: true, 
                            mensaje: `¡${intervaloActual.descuento_porcentaje}% de descuento máximo! (${totalUnidades} uds)`
                        };
                    }
                } else {
                    // No está en ningún intervalo, buscar el primer intervalo
                    const primerIntervalo = intervalosOrdenados[0];
                    
                    if (totalUnidades < primerIntervalo.desde_unidades) {
                        const faltantes = primerIntervalo.desde_unidades - totalUnidades;
                        return { 
                            cumplida: false, 
                            mensaje: `Añade ${faltantes} unidad${faltantes !== 1 ? 'es' : ''} más para ${primerIntervalo.descuento_porcentaje}% de descuento (${totalUnidades}/${primerIntervalo.desde_unidades} uds)`
                        };
                    } else {
                        // Está por encima del último intervalo (caso raro)
                        const ultimoIntervalo = intervalosOrdenados[intervalosOrdenados.length - 1];
                        return { 
                            cumplida: true, 
                            mensaje: `¡${ultimoIntervalo.descuento_porcentaje}% de descuento! (${totalUnidades} uds)`
                        };
                    }
                }
            }
            
            if (tipoOferta === 3) {
                // LOTE: Se aplica por cada X unidades (pueden ser lotes múltiples)
                const unidadesLote = await window.supabaseClient.getLoteOferta(oferta.numero_oferta, true);
                if (!unidadesLote) {
                    return { cumplida: false, mensaje: oferta.titulo_descripcion || 'Oferta por lote' };
                }
                
                // Sumar unidades de todos los productos de esta oferta en el carrito
                let totalUnidades = 0;
                for (const prod of carrito.productos) {
                    const ofertasProd = await window.supabaseClient.getOfertasProducto(prod.codigo_producto, this.currentUser?.codigo_cliente || null, true);
                    const tieneEstaOferta = ofertasProd.some(o => o.numero_oferta === oferta.numero_oferta);
                    if (tieneEstaOferta) {
                        totalUnidades += prod.cantidad;
                    }
                }
                
                const lotesCompletos = Math.floor(totalUnidades / unidadesLote);
                const unidadesConDescuento = lotesCompletos * unidadesLote;
                const resto = totalUnidades % unidadesLote;
                
                if (lotesCompletos > 0) {
                    if (resto === 0) {
                        return { 
                            cumplida: true, 
                            mensaje: `${oferta.titulo_descripcion || `¡${lotesCompletos} lote${lotesCompletos !== 1 ? 's' : ''} completo${lotesCompletos !== 1 ? 's' : ''}!`}`
                        };
                    } else {
                        return { 
                            cumplida: true, 
                            mensaje: `${lotesCompletos} lote${lotesCompletos !== 1 ? 's' : ''} aplicado${lotesCompletos !== 1 ? 's' : ''} (${resto} ud${resto !== 1 ? 's' : ''} sin oferta)`
                        };
                    }
                } else {
                    const faltantes = unidadesLote - totalUnidades;
                    return { 
                        cumplida: false, 
                        mensaje: `Añade ${faltantes} unidad${faltantes !== 1 ? 'es' : ''} más de esta u otro artículo para el 1er lote (lote: ${unidadesLote})`
                    };
                }
            }
            
            if (tipoOferta === 4) {
                // MULTIPLO: Se cumple si la cantidad es múltiplo exacto de unidades_multiplo
                const unidadesMultiplo = oferta.unidades_multiplo || 0;
                
                if (unidadesMultiplo === 0) {
                    return { cumplida: false, mensaje: oferta.titulo_descripcion || 'Oferta por múltiplo' };
                }
                
                if (cantidad >= unidadesMultiplo) {
                    const numMultiplos = Math.floor(cantidad / unidadesMultiplo);
                    const resto = cantidad % unidadesMultiplo;
                    
                    if (resto === 0) {
                        return { 
                            cumplida: true, 
                            mensaje: oferta.titulo_descripcion || `¡Oferta aplicada! (${numMultiplos} x ${unidadesMultiplo})`
                        };
                    } else {
                        const enOferta = cantidad - resto;
                        return { 
                            cumplida: true, 
                            mensaje: `Oferta aplicada a ${enOferta} uds (múltiplo de ${unidadesMultiplo})`
                        };
                    }
                } else {
                    const faltantes = unidadesMultiplo - cantidad;
                    return { 
                        cumplida: false, 
                        mensaje: `Añade ${faltantes} unidad${faltantes !== 1 ? 'es' : ''} más para conseguir la oferta (múltiplo: ${unidadesMultiplo})`
                    };
                }
            }
            
            return { cumplida: false, mensaje: oferta.titulo_descripcion || 'Oferta disponible' };
        } catch (error) {
            console.error('Error al verificar oferta:', error);
            return { cumplida: false, mensaje: 'Error al verificar oferta' };
        }
    }

    /**
     * Calcula el descuento a aplicar según el tipo y condiciones de la oferta
     * Devuelve el porcentaje de descuento y el factor de aplicación (qué proporción tiene descuento)
     * @param {Object} oferta - Datos de la oferta
     * @param {Object} producto - Producto del carrito
     * @param {Object} carrito - Carrito completo
     * @returns {Promise<{descuento: number, factor: number}>} - Porcentaje y factor de aplicación
     */
    async calcularDescuentoOferta(oferta, producto, carrito) {
        try {
            const tipoOferta = oferta.tipo_oferta;
            
            // ESTANDAR: Aplica a todas las unidades si se cumple el mínimo
            if (tipoOferta === 1) {
                return {
                    descuento: oferta.descuento_oferta || 0,
                    factor: 1.0 // 100% de las unidades
                };
            }
            
            // INTERVALO: buscar el descuento del intervalo correspondiente
            if (tipoOferta === 2) {
                const intervalos = await window.supabaseClient.getIntervalosOferta(oferta.numero_oferta, true);
                if (!intervalos || intervalos.length === 0) {
                    console.log(`⚠️ Oferta ${oferta.numero_oferta} tipo INTERVALO sin intervalos definidos`);
                    return { descuento: 0, factor: 0 };
                }
                
                // Ordenar intervalos
                const intervalosOrdenados = intervalos.sort((a, b) => a.desde_unidades - b.desde_unidades);
                
                // Calcular total de unidades de la oferta en el carrito
                let totalUnidades = 0;
                const codigoCliente = this.currentUser?.codigo_cliente || null;
                
                for (const prod of carrito.productos) {
                    const ofertasProd = await window.supabaseClient.getOfertasProducto(prod.codigo_producto, codigoCliente, true);
                    const tieneEstaOferta = ofertasProd.some(o => o.numero_oferta === oferta.numero_oferta);
                    if (tieneEstaOferta) {
                        totalUnidades += prod.cantidad;
                    }
                }
                
                // Encontrar el intervalo que corresponde al total de unidades
                const intervaloActual = intervalosOrdenados.find(intervalo => 
                    totalUnidades >= intervalo.desde_unidades && totalUnidades <= intervalo.hasta_unidades
                );
                
                if (intervaloActual) {
                    console.log(`✅ Oferta ${oferta.numero_oferta} - ${totalUnidades} uds en intervalo ${intervaloActual.desde_unidades}-${intervaloActual.hasta_unidades}: ${intervaloActual.descuento_porcentaje}%`);
                    return {
                        descuento: intervaloActual.descuento_porcentaje || 0,
                        factor: 1.0 // Aplica a todas las unidades del intervalo
                    };
                } else {
                    // Si está por encima del último intervalo, aplicar el descuento máximo
                    const ultimoIntervalo = intervalosOrdenados[intervalosOrdenados.length - 1];
                    if (totalUnidades > ultimoIntervalo.hasta_unidades) {
                        console.log(`✅ Oferta ${oferta.numero_oferta} - ${totalUnidades} uds (por encima del último intervalo): ${ultimoIntervalo.descuento_porcentaje}%`);
                        return {
                            descuento: ultimoIntervalo.descuento_porcentaje || 0,
                            factor: 1.0
                        };
                    }
                    console.log(`⚠️ Oferta ${oferta.numero_oferta} - ${totalUnidades} uds no alcanza ningún intervalo`);
                }
            }
            
            // LOTE: Aplica solo a lotes completos
            if (tipoOferta === 3) {
                const unidadesLote = await window.supabaseClient.getLoteOferta(oferta.numero_oferta, true);
                if (!unidadesLote) return { descuento: 0, factor: 0 };
                
                // Calcular total de unidades de la oferta en el carrito
                let totalUnidades = 0;
                const codigoCliente = this.currentUser?.codigo_cliente || null;
                
                for (const prod of carrito.productos) {
                    const ofertasProd = await window.supabaseClient.getOfertasProducto(prod.codigo_producto, codigoCliente, true);
                    const tieneEstaOferta = ofertasProd.some(o => o.numero_oferta === oferta.numero_oferta);
                    if (tieneEstaOferta) {
                        totalUnidades += prod.cantidad;
                    }
                }
                
                // Calcular cuántas unidades entran en lotes completos
                const lotesCompletos = Math.floor(totalUnidades / unidadesLote);
                const unidadesConDescuento = lotesCompletos * unidadesLote;
                
                if (lotesCompletos > 0) {
                    // El factor es la proporción de unidades con descuento del PRODUCTO ACTUAL
                    // Calculamos la proporción del producto en el total de la oferta
                    const proporcionProducto = producto.cantidad / totalUnidades;
                    const unidadesProductoConDescuento = Math.floor(unidadesConDescuento * proporcionProducto);
                    const factorProducto = unidadesProductoConDescuento / producto.cantidad;
                    
                    return {
                        descuento: oferta.descuento_oferta || 0,
                        factor: factorProducto
                    };
                }
            }
            
            // MULTIPLO: Aplica solo a múltiplos completos del producto individual
            if (tipoOferta === 4) {
                const unidadesMultiplo = oferta.unidades_multiplo || 0;
                if (unidadesMultiplo === 0) return { descuento: 0, factor: 0 };
                
                const multiplosCompletos = Math.floor(producto.cantidad / unidadesMultiplo);
                const unidadesConDescuento = multiplosCompletos * unidadesMultiplo;
                
                if (multiplosCompletos > 0) {
                    return {
                        descuento: oferta.descuento_oferta || 0,
                        factor: unidadesConDescuento / producto.cantidad
                    };
                }
            }
            
            return { descuento: 0, factor: 0 };
        } catch (error) {
            console.error('Error al calcular descuento de oferta:', error);
            return { descuento: 0, factor: 0 };
        }
    }

    /**
     * Actualiza una tarjeta de producto existente sin regenerar el DOM
     * Evita glitches y mantiene la posición de scroll
     */
    async updateCartProductCard(card, producto) {
        const priceWithIVA = producto.precio_unitario * 1.21;
        const subtotalWithIVA = producto.subtotal * 1.21;
        
        // Actualizar cantidad en el input
        const qtyInput = card.querySelector('.qty-value-input');
        if (qtyInput && qtyInput.value != producto.cantidad) {
            qtyInput.value = producto.cantidad;
        }
        
        // Actualizar badge de cantidad en la imagen
        const qtyBadge = card.querySelector('.cart-product-quantity-badge');
        if (qtyBadge) {
            qtyBadge.textContent = producto.cantidad;
        }
        
        // Recalcular ofertas y precios
        const codigoCliente = this.currentUser?.codigo_cliente || null;
        let precioConDescuento = priceWithIVA;
        let subtotalConDescuento = subtotalWithIVA;
        let descuentoAplicado = 0;
        let ofertaActiva = null;
        let resultadoOferta = null;
        
        if (codigoCliente) {
            const ofertas = await window.supabaseClient.getOfertasProducto(producto.codigo_producto, codigoCliente, true);
            if (ofertas && ofertas.length > 0) {
                ofertaActiva = ofertas[0];
                const carrito = window.cartManager.getCart();
                resultadoOferta = await this.verificarOfertaCumplida(ofertaActiva, producto.codigo_producto, producto.cantidad, carrito);
                
                if (resultadoOferta && resultadoOferta.cumplida) {
                    const { descuento, factor } = await this.calcularDescuentoOferta(ofertaActiva, producto, carrito);
                    if (descuento > 0 && factor > 0) {
                        descuentoAplicado = descuento;
                        
                        if (ofertaActiva.tipo_oferta === 3 || ofertaActiva.tipo_oferta === 4) {
                            const precioSinDescuento = priceWithIVA;
                            const precioConDescuentoTotal = priceWithIVA * (1 - descuento / 100);
                            precioConDescuento = (precioConDescuentoTotal * factor) + (precioSinDescuento * (1 - factor));
                            subtotalConDescuento = precioConDescuento * producto.cantidad;
                        } else {
                            precioConDescuento = priceWithIVA * (1 - descuento / 100);
                            subtotalConDescuento = subtotalWithIVA * (1 - descuento / 100);
                        }
                    }
                }
            }
        }
        
        // Actualizar badge de oferta
        const ofertaBadge = card.querySelector('.oferta-badge');
        if (ofertaActiva && resultadoOferta) {
            if (ofertaBadge) {
                ofertaBadge.textContent = resultadoOferta.mensaje;
                ofertaBadge.className = `oferta-badge ${resultadoOferta.cumplida ? 'oferta-cumplida' : 'oferta-pendiente'}`;
            }
        }
        
        // Actualizar precios
        if (descuentoAplicado > 0) {
            const priceContainer = card.querySelector('.cart-product-price-container, .cart-product-price');
            if (priceContainer) {
                priceContainer.innerHTML = `
                    <div class="cart-product-price-original">${priceWithIVA.toFixed(2)} €</div>
                    <div class="cart-product-price-discount">${precioConDescuento.toFixed(2)} € <span class="discount-badge">-${descuentoAplicado}%</span></div>
                `;
                priceContainer.className = 'cart-product-price-container';
            }
            
            const subtotalContainer = card.querySelector('.cart-product-subtotal-container, .cart-product-subtotal');
            if (subtotalContainer) {
                subtotalContainer.innerHTML = `
                    <div class="cart-product-subtotal-original">${subtotalWithIVA.toFixed(2)} €</div>
                    <div class="cart-product-subtotal-discount">${subtotalConDescuento.toFixed(2)} €</div>
                `;
                subtotalContainer.className = 'cart-product-subtotal-container';
            }
        } else {
            const priceContainer = card.querySelector('.cart-product-price-container, .cart-product-price');
            if (priceContainer) {
                priceContainer.textContent = `${priceWithIVA.toFixed(2)} €`;
                priceContainer.className = 'cart-product-price';
            }
            
            const subtotalContainer = card.querySelector('.cart-product-subtotal-container, .cart-product-subtotal');
            if (subtotalContainer) {
                subtotalContainer.textContent = `${subtotalWithIVA.toFixed(2)} €`;
                subtotalContainer.className = 'cart-product-subtotal';
            }
        }
    }

    /**
     * Crea una tarjeta de producto para el carrito (estilo Tesco)
     */
    async createCartProductCard(producto) {
        const card = document.createElement('div');
        card.className = 'cart-product-card';

        const priceWithIVA = producto.precio_unitario * 1.21;
        const subtotalWithIVA = producto.subtotal * 1.21;

        const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo_producto}_1.JPG`;
        
        // Obtener ofertas del producto desde cache (solo para usuarios con codigo_cliente)
        const codigoCliente = this.currentUser?.codigo_cliente || null;
        let resultadoOferta = null;
        let ofertaActiva = null;
        let precioConDescuento = priceWithIVA;
        let subtotalConDescuento = subtotalWithIVA;
        let descuentoAplicado = 0;
        
        // Solo verificar ofertas si el usuario tiene codigo_cliente
        if (codigoCliente) {
            const ofertas = await window.supabaseClient.getOfertasProducto(producto.codigo_producto, codigoCliente, true);
            
            // Verificar si alguna oferta se cumple y calcular descuentos
            if (ofertas && ofertas.length > 0) {
                // Tomar la primera oferta (puedes ajustar la lógica si hay múltiples)
                ofertaActiva = ofertas[0];
                const carrito = window.cartManager.getCart();
                resultadoOferta = await this.verificarOfertaCumplida(ofertaActiva, producto.codigo_producto, producto.cantidad, carrito);
                
                // Si la oferta está cumplida, calcular el precio con descuento
                if (resultadoOferta && resultadoOferta.cumplida) {
                    const { descuento, factor } = await this.calcularDescuentoOferta(ofertaActiva, producto, carrito);
                    if (descuento > 0 && factor > 0) {
                        descuentoAplicado = descuento;
                        
                        // Para LOTE y MULTIPLO, aplicar descuento solo a la proporción correspondiente
                        if (ofertaActiva.tipo_oferta === 3 || ofertaActiva.tipo_oferta === 4) {
                            // Precio promedio: mezcla de unidades con y sin descuento
                            const precioSinDescuento = priceWithIVA;
                            const precioConDescuentoTotal = priceWithIVA * (1 - descuento / 100);
                            precioConDescuento = (precioConDescuentoTotal * factor) + (precioSinDescuento * (1 - factor));
                            subtotalConDescuento = precioConDescuento * producto.cantidad;
                        } else {
                            // Para ESTANDAR e INTERVALO, aplica a todas las unidades
                            precioConDescuento = priceWithIVA * (1 - descuento / 100);
                            subtotalConDescuento = subtotalWithIVA * (1 - descuento / 100);
                        }
                    }
                }
            }
        }
        
        // Generar HTML del rectángulo de oferta con mensaje inteligente
        let ofertaHTML = '';
        if (ofertaActiva && resultadoOferta) {
            const claseOferta = resultadoOferta.cumplida ? 'oferta-cumplida' : 'oferta-pendiente';
            ofertaHTML = `<div class="oferta-badge ${claseOferta}" onclick="event.stopPropagation(); window.app.verProductosOfertaDesdeCarrito('${ofertaActiva.numero_oferta}')">${this.escapeForHtmlAttribute(resultadoOferta.mensaje)}</div>`;
        }
        
        // Generar HTML del precio (con descuento si aplica)
        let precioHTML = '';
        let subtotalHTML = '';
        
        if (descuentoAplicado > 0) {
            // Mostrar precio original tachado y precio con descuento
            precioHTML = `
                <div class="cart-product-price-container">
                    <div class="cart-product-price-original">${priceWithIVA.toFixed(2)} €</div>
                    <div class="cart-product-price-discount">${precioConDescuento.toFixed(2)} € <span class="discount-badge">-${descuentoAplicado}%</span></div>
                </div>
            `;
            subtotalHTML = `
                <div class="cart-product-subtotal-container">
                    <div class="cart-product-subtotal-original">${subtotalWithIVA.toFixed(2)} €</div>
                    <div class="cart-product-subtotal-discount">${subtotalConDescuento.toFixed(2)} €</div>
                </div>
            `;
        } else {
            // Mostrar precio normal
            precioHTML = `<div class="cart-product-price">${priceWithIVA.toFixed(2)} €</div>`;
            subtotalHTML = `<div class="cart-product-subtotal">${subtotalWithIVA.toFixed(2)} €</div>`;
        }

        // Determinar si hay oferta para ajustar el layout
        const footerClass = ofertaHTML ? 'cart-product-footer has-oferta' : 'cart-product-footer';

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
                        ${precioHTML}
                    </div>
                    ${subtotalHTML}
                </div>
                <div class="${footerClass}">
                    ${ofertaHTML}
                    <div class="quantity-controls-compact">
                        <button class="qty-btn-compact" data-action="decrease" data-code="${producto.codigo_producto}">−</button>
                        <input type="number" class="qty-value-input" value="${producto.cantidad}" min="0" max="999" data-code="${producto.codigo_producto}">
                        <button class="qty-btn-compact" data-action="increase" data-code="${producto.codigo_producto}">+</button>
                    </div>
                </div>
            </div>
        `;

        // Añadir event listeners solo si no se han añadido antes
        if (!card.dataset.listenersAdded) {
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
            
            // Marcar que los listeners ya están añadidos
            card.dataset.listenersAdded = 'true';
        }

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
            const escapedDescripcion = this.escapeForHtmlAttribute(producto.descripcion);
            
            // Formatear fecha de última compra
            const fechaUltimaCompra = new Date(producto.fecha_ultima_compra);
            const fechaFormateada = fechaUltimaCompra.toLocaleDateString('es-ES', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
            
            return `
                <div class="result-item-with-image history-item">
                    <div class="result-image" onclick="window.app.addProductToCartFromHistory('${producto.codigo}', '${escapedDescripcion}', ${producto.pvp})">
                        <img src="${imageUrl}" alt="${producto.descripcion}" 
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="result-image-placeholder" style="display: none;">📦</div>
                    </div>
                    <div class="result-info" onclick="window.app.addProductToCartFromHistory('${producto.codigo}', '${escapedDescripcion}', ${producto.pvp})">
                        <div class="result-code">${producto.codigo}</div>
                        <div class="result-name">${producto.descripcion}</div>
                        <div class="result-price">${priceWithIVA.toFixed(2)} €</div>
                        <div class="result-meta">
                            <span class="result-last-purchase">Última compra: ${fechaFormateada}</span>
                        </div>
                    </div>
                    <button class="btn-delete-history" onclick="event.stopPropagation(); window.app.deleteProductFromHistory('${producto.codigo}', '${escapedDescripcion}')">
                        🗑️
                    </button>
                </div>
            `;
        }).join('');
    }

    /**
     * Añade un producto al carrito desde el historial (ahora con modal de cantidad)
     */
    async addProductToCartFromHistory(codigo, descripcion, pvp) {
        try {
            // Mostrar modal de cantidad
            const cantidad = await this.showAddToCartModal({
                codigo,
                descripcion,
                pvp
            });

            // Si el usuario canceló, no hacer nada
            if (cantidad === null) {
                return;
            }

            // Añadir al carrito
            await window.cartManager.addProduct({
                codigo,
                descripcion,
                pvp
            }, cantidad);
            
            window.ui.showToast(`Producto añadido (x${cantidad})`, 'success');
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
            emptyState.querySelector('.empty-icon').textContent = '📦';
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
     * Elimina un producto del historial
     */
    async deleteProductFromHistory(codigo, descripcion) {
        if (!this.currentUser) {
            window.ui.showToast('Debes iniciar sesión primero', 'warning');
            return;
        }

        try {
            // Pedir confirmación
            const confirmDelete = await window.ui.showConfirm(
                '¿ELIMINAR DEL HISTORIAL?',
                `¿Deseas eliminar "${descripcion}" de tu historial de compras?`,
                'Eliminar',
                'Cancelar'
            );

            if (!confirmDelete) return;

            // Eliminar del servidor
            const success = await window.supabaseClient.deleteProductFromHistory(
                this.currentUser.user_id,
                codigo
            );

            if (success) {
                window.ui.showToast('Producto eliminado del historial', 'success');
                
                // Recargar el historial
                await this.searchPurchaseHistory();
            } else {
                window.ui.showToast('Error al eliminar del historial', 'error');
            }

        } catch (error) {
            console.error('Error al eliminar producto del historial:', error);
            window.ui.showToast('Error al eliminar del historial', 'error');
        }
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

    /**
     * Muestra el modal de selección de almacén
     */
    showAlmacenSelectionModal() {
        // Verificar que el usuario esté logueado
        if (!this.currentUser) {
            window.ui.showToast('Debes iniciar sesion para enviar pedidos', 'warning');
            return;
        }

        // Verificar que haya productos en el carrito
        const cart = window.cartManager.getCart();
        if (!cart || cart.productos.length === 0) {
            window.ui.showToast('El carrito esta vacio', 'warning');
            return;
        }

        // Pre-seleccionar el almacén habitual del usuario si existe
        const almacenButtons = document.querySelectorAll('.almacen-btn');
        almacenButtons.forEach(btn => {
            btn.classList.remove('selected');
            if (this.currentUser.almacen_habitual && btn.dataset.almacen === this.currentUser.almacen_habitual) {
                btn.classList.add('selected');
            }
        });

        // Mostrar modal
        const almacenModal = document.getElementById('almacenModal');
        if (almacenModal) {
            almacenModal.style.display = 'flex';
        }
    }

    /**
     * Oculta el modal de selección de almacén
     */
    hideAlmacenModal() {
        const almacenModal = document.getElementById('almacenModal');
        if (almacenModal) {
            almacenModal.style.display = 'none';
        }
    }

    /**
     * Construye el payload del pedido para el ERP
     */
    buildErpOrderPayload(cart, almacen) {
        const totalWithIVA = cart.total_importe * 1.21;
        return {
            almacen_destino: almacen,
            codigo_usuario: this.currentUser ? this.currentUser.codigo_usuario : null,
            codigo_cliente: this.currentUser ? this.currentUser.codigo_cliente : null,
            total_importe: cart.total_importe,
            total_con_iva: totalWithIVA,
            productos: cart.productos.map((producto) => ({
                codigo: producto.codigo_producto,
                descripcion: producto.descripcion_producto,
                cantidad: producto.cantidad,
                precio_unitario: producto.precio_unitario
            }))
        };
    }

    /**
     * Envía un pedido remoto al almacén seleccionado
     */
    async sendRemoteOrder(almacen) {
        try {
            if (!this.currentUser) {
                window.ui.showToast('Debes iniciar sesion', 'error');
                return;
            }

            const cart = window.cartManager.getCart();
            if (!cart || cart.productos.length === 0) {
                window.ui.showToast('El carrito esta vacio', 'warning');
                return;
            }

            // Ocultar modal
            this.hideAlmacenModal();

            // Mostrar loading
            window.ui.showLoading(`Enviando pedido a ${almacen}...`);

            // Intentar enviar pedido al ERP (si está configurado)
            // NOTA: El endpoint de crear pedido en ERP aún no está disponible
            // Cuando esté listo, se configurará en ERP_CREATE_ORDER_PATH
            if (window.erpClient && window.erpClient.createOrderPath) {
                try {
                    window.ui.showLoading(`Conectando con ERP para ${almacen}...`);
                    const erpPayload = this.buildErpOrderPayload(cart, almacen);
                    await window.erpClient.createRemoteOrder(erpPayload);
                    console.log('Pedido enviado al ERP correctamente');
                } catch (erpError) {
                    console.warn('Error al enviar al ERP (continuando con Supabase):', erpError);
                    // Continuar con el flujo de Supabase aunque falle el ERP
                }
            } else {
                console.log('ERP no configurado o endpoint de pedidos no disponible aún');
            }

            // Continuar con el flujo actual (Supabase)
            window.ui.showLoading(`Enviando pedido a ${almacen}...`);

            // Crear pedido remoto en Supabase
            const result = await window.supabaseClient.crearPedidoRemoto(
                this.currentUser.user_id,
                almacen
            );

            if (!result.success) {
                throw new Error(result.message || 'Error al crear pedido remoto');
            }

            // Añadir productos al pedido remoto
            for (const producto of cart.productos) {
                await window.supabaseClient.addProductToRemoteOrder(
                    result.carrito_id,
                    {
                        codigo: producto.codigo_producto,
                        descripcion: producto.descripcion_producto,
                        pvp: producto.precio_unitario
                    },
                    producto.cantidad
                );
            }

            // ✅ Ya no es necesario actualizar estados manualmente
            // La función SQL crear_pedido_remoto ya crea el pedido con estado 'enviado'

            window.ui.hideLoading();

            // Mostrar mensaje de éxito
            const totalWithIVA = cart.total_importe * 1.21;
            window.ui.showToast(
                `Pedido enviado a ${almacen} - ${totalWithIVA.toFixed(2)}€`,
                'success'
            );

            // Invalidar cache de historial (Phase 2 - Cache)
            // Los pedidos remotos también actualizan el historial cuando se procesan
            if (window.purchaseCache) {
                console.log('🔄 Invalidando cache de historial tras pedido remoto...');
                window.purchaseCache.invalidateUser(this.currentUser.user_id);
            }

            // Limpiar carrito
            await window.cartManager.clearCart();
            window.ui.updateCartBadge();

            // Volver a pantalla de carrito
            this.showScreen('cart');
            this.updateActiveNav('cart');
            this.updateCartView();

            console.log(`Pedido remoto enviado exitosamente a ${almacen}`);

        } catch (error) {
            console.error('Error al enviar pedido remoto:', error);
            window.ui.hideLoading();
            window.ui.showToast('Error al enviar pedido. Intenta de nuevo.', 'error');
        }
    }

    /**
     * Carga los pedidos remotos del usuario (ESTRATEGIA OFFLINE-FIRST)
     * 1. Mostrar caché local inmediatamente (rápido)
     * 2. Actualizar desde Supabase en segundo plano (si hay conexión)
     * 3. Sincronizar cambios sin interrumpir la visualización
     */
    async loadMyOrders() {
        const ordersLoading = document.getElementById('ordersLoading');
        const ordersEmpty = document.getElementById('ordersEmpty');
        const ordersList = document.getElementById('ordersList');

        if (!this.currentUser) {
            ordersEmpty.style.display = 'flex';
            ordersLoading.style.display = 'none';
            ordersList.style.display = 'none';
            return;
        }

        try {
            // PASO 1: Cargar desde caché local (INMEDIATO)
            console.log('🔍 Cargando pedidos para user_id:', this.currentUser.user_id);
            const pedidosCache = await window.cartManager.loadRemoteOrdersFromCache(this.currentUser.user_id);
            
            if (pedidosCache && pedidosCache.length > 0) {
                // Mostrar pedidos del caché inmediatamente
                ordersLoading.style.display = 'none';
                ordersList.style.display = 'block';
                ordersEmpty.style.display = 'none';
                ordersList.innerHTML = '';

                console.log('📱 Mostrando', pedidosCache.length, 'pedidos desde caché');
                for (const pedido of pedidosCache) {
                    const orderCard = await this.createOrderCard(pedido);
                    ordersList.appendChild(orderCard);
                }
            } else {
                // Si no hay caché, mostrar loading
                console.log('⚠️ No hay pedidos en caché');
                ordersLoading.style.display = 'flex';
                ordersEmpty.style.display = 'none';
                ordersList.style.display = 'none';
            }

            // PASO 2: Actualizar desde Supabase EN SEGUNDO PLANO
            try {
                console.log('🌐 Consultando Supabase...');
                const pedidosOnline = await window.supabaseClient.getUserRemoteOrders(this.currentUser.user_id);

                // Guardar en caché para futuras visualizaciones offline
                await window.cartManager.saveRemoteOrdersToCache(pedidosOnline, this.currentUser.user_id);

                // Ocultar loading
                ordersLoading.style.display = 'none';

                if (!pedidosOnline || pedidosOnline.length === 0) {
                    // No hay pedidos ni online
                    ordersEmpty.style.display = 'flex';
                    ordersList.style.display = 'none';
                    return;
                }

                // Actualizar vista con datos frescos de Supabase
                ordersList.style.display = 'block';
                ordersEmpty.style.display = 'none';
                ordersList.innerHTML = '';

                for (const pedido of pedidosOnline) {
                    const orderCard = await this.createOrderCard(pedido);
                    ordersList.appendChild(orderCard);
                }

                console.log('🌐 Pedidos actualizados desde Supabase');

            } catch (onlineError) {
                // Si falla la conexión pero ya mostramos el caché, no hacer nada
                console.log('📱 Modo offline - mostrando datos en caché');
                
                // Si no había caché y falló la conexión
                if (!pedidosCache || pedidosCache.length === 0) {
                    ordersLoading.style.display = 'none';
                    ordersEmpty.style.display = 'flex';
                    window.ui.showToast('Sin conexión. No hay pedidos guardados.', 'warning');
                }
            }

        } catch (error) {
            console.error('Error al cargar pedidos:', error);
            ordersLoading.style.display = 'none';
            ordersEmpty.style.display = 'flex';
            window.ui.showToast('Error al cargar tus pedidos', 'error');
        }
    }

    /**
     * Crea una tarjeta de pedido
     */
    async createOrderCard(pedido) {
        const card = document.createElement('div');
        card.className = 'order-card';
        card.setAttribute('data-order-id', pedido.id);

        // Formatear fecha
        const fecha = new Date(pedido.fecha_creacion);
        const fechaFormateada = fecha.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Determinar estado y badge
        const estadoInfo = this.getEstadoBadge(pedido.estado_procesamiento);

        // Determinar tipo de pedido
        const tipoPedido = pedido.tipo_pedido === 'remoto' ? '📱 Remoto' : '🛒 Presencial';
        const tipoClass = pedido.tipo_pedido === 'remoto' ? 'remote' : 'presencial';

        // Calcular total con IVA
        const totalConIVA = pedido.total_importe * 1.21;

        card.innerHTML = `
            <div class="order-card-header" onclick="window.app.toggleOrderDetails(${pedido.id})">
                <div class="order-card-main">
                    <div class="order-card-title">
                        <span class="order-almacen">🏪 ${pedido.almacen_destino}</span>
                        <span class="order-type order-type-${tipoClass}">${tipoPedido}</span>
                        <span class="order-badge order-badge-${estadoInfo.class}">${estadoInfo.icon} ${estadoInfo.text}</span>
                    </div>
                    <div class="order-card-info">
                        <span class="order-date">📅 ${fechaFormateada}</span>
                        <span class="order-code">Código: ${pedido.codigo_qr}</span>
                    </div>
                    <div class="order-card-totals">
                        <span class="order-items">${pedido.total_productos} producto${pedido.total_productos !== 1 ? 's' : ''}</span>
                        <span class="order-total">${totalConIVA.toFixed(2)} €</span>
                    </div>
                </div>
                <div class="order-card-arrow">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
            </div>
            <div class="order-card-details" id="orderDetails-${pedido.id}" style="display: none;">
                <div class="order-details-loading">
                    <div class="spinner-small"></div>
                    <span>Cargando productos...</span>
                </div>
            </div>
        `;

        return card;
    }

    /**
     * Obtiene información del badge según el estado
     */
    getEstadoBadge(estado) {
        const estados = {
            'pendiente': { class: 'pending', icon: '⏳', text: 'Pendiente' },
            'procesando': { class: 'processing', icon: '🔄', text: 'Preparando' },
            'impreso': { class: 'completed', icon: '✅', text: 'Listo' },
            'completado': { class: 'completed', icon: '✅', text: 'Completado' },
            'cancelado': { class: 'cancelled', icon: '❌', text: 'Cancelado' }
        };

        return estados[estado] || { class: 'pending', icon: '⏳', text: estado };
    }

    /**
     * Alterna la visualización de detalles del pedido
     */
    async toggleOrderDetails(orderId) {
        const detailsDiv = document.getElementById(`orderDetails-${orderId}`);
        const arrow = document.querySelector(`[data-order-id="${orderId}"] .order-card-arrow svg`);

        if (!detailsDiv) return;

        if (detailsDiv.style.display === 'none') {
            // Mostrar detalles
            detailsDiv.style.display = 'block';
            arrow.style.transform = 'rotate(180deg)';

            // Cargar productos si no están cargados
            if (detailsDiv.querySelector('.order-details-loading')) {
                await this.loadOrderProducts(orderId);
            }
        } else {
            // Ocultar detalles
            detailsDiv.style.display = 'none';
            arrow.style.transform = 'rotate(0deg)';
        }
    }

    /**
     * Carga los productos de un pedido (ESTRATEGIA OFFLINE-FIRST)
     */
    async loadOrderProducts(orderId) {
        const detailsDiv = document.getElementById(`orderDetails-${orderId}`);
        if (!detailsDiv) return;

        try {
            // PASO 1: Intentar cargar desde caché local
            let productos = await window.cartManager.loadOrderProductsFromCache(orderId);
            
            if (productos && productos.length > 0) {
                // Mostrar productos del caché inmediatamente
                this.renderOrderProducts(detailsDiv, productos);
                console.log(`📱 Productos del pedido ${orderId} mostrados desde caché`);
            } else {
                // Mantener el loading si no hay caché
                detailsDiv.innerHTML = '<div class="order-details-loading"><div class="spinner-small"></div><span>Cargando productos...</span></div>';
            }

            // PASO 2: Actualizar desde Supabase en segundo plano
            try {
                const productosOnline = await window.supabaseClient.getOrderProducts(orderId);

                if (productosOnline && productosOnline.length > 0) {
                    // Guardar en caché para futuras visualizaciones offline
                    await window.cartManager.saveOrderProductsToCache(orderId, productosOnline);
                    
                    // Actualizar vista con datos frescos
                    this.renderOrderProducts(detailsDiv, productosOnline);
                    console.log(`🌐 Productos del pedido ${orderId} actualizados desde Supabase`);
                } else if (!productos || productos.length === 0) {
                    detailsDiv.innerHTML = '<p class="order-no-products">No se encontraron productos</p>';
                }
            } catch (onlineError) {
                // Si falla la conexión pero ya mostramos el caché, no hacer nada
                console.log(`📱 Modo offline - mostrando productos del pedido ${orderId} desde caché`);
                
                // Si no había caché y falló la conexión
                if (!productos || productos.length === 0) {
                    detailsDiv.innerHTML = '<p class="order-error">Sin conexión. No hay productos guardados.</p>';
                }
            }

        } catch (error) {
            console.error('Error al cargar productos del pedido:', error);
            detailsDiv.innerHTML = '<p class="order-error">Error al cargar productos</p>';
        }
    }

    /**
     * Renderiza la lista de productos de un pedido
     */
    renderOrderProducts(detailsDiv, productos) {
        let productosHTML = '<div class="order-products-list">';
        
        // Botón para reordenar todo el pedido
        productosHTML += `
            <div class="order-reorder-actions">
                <button class="btn-reorder-all" onclick="window.app.reorderAllProducts(${JSON.stringify(productos).replace(/"/g, '&quot;')})">
                    🔄 Volver a Pedir Todo
                </button>
            </div>
        `;
        
        for (const producto of productos) {
            const precioConIVA = producto.precio_unitario * 1.21;
            const subtotalConIVA = producto.subtotal * 1.21;
            const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo_producto}_1.JPG`;

            productosHTML += `
                <div class="order-product-item">
                    <div class="order-product-image">
                        <img src="${imageUrl}" 
                             alt="${producto.descripcion_producto}"
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="order-product-placeholder" style="display: none;">📦</div>
                    </div>
                    <div class="order-product-info">
                        <div class="order-product-name">${producto.descripcion_producto}</div>
                        <div class="order-product-code">Código: ${producto.codigo_producto}</div>
                        <div class="order-product-details">
                            <span class="order-product-qty">x${producto.cantidad}</span>
                            <span class="order-product-price">${precioConIVA.toFixed(2)} €/ud</span>
                            <span class="order-product-subtotal">${subtotalConIVA.toFixed(2)} €</span>
                        </div>
                    </div>
                    <button class="btn-reorder-product" 
                            onclick="window.app.reorderSingleProduct('${producto.codigo_producto}', ${producto.cantidad})"
                            title="Añadir este producto al carrito">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="9" cy="21" r="1"/>
                            <circle cx="20" cy="21" r="1"/>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                        </svg>
                    </button>
                </div>
            `;
        }

        productosHTML += '</div>';
        detailsDiv.innerHTML = productosHTML;
    }

    /**
     * Reordena todos los productos de un pedido anterior
     */
    async reorderAllProducts(productos) {
        try {
            if (!Array.isArray(productos) || productos.length === 0) {
                window.ui.showToast('No hay productos para reordenar', 'error');
                return;
            }

            // Contar productos agregados
            let agregados = 0;
            let errores = 0;

            for (const producto of productos) {
                try {
                    // Buscar el producto completo desde la base de datos
                    const productoCompleto = await window.supabaseClient.searchProductByCode(producto.codigo_producto);
                    
                    if (productoCompleto) {
                        // Asegurar formato correcto para addProduct
                        const productoFormateado = {
                            codigo: productoCompleto.codigo,
                            descripcion: productoCompleto.descripcion,
                            pvp: productoCompleto.pvp || productoCompleto.precio_unitario || 0
                        };
                        
                        await window.cartManager.addProduct(productoFormateado, producto.cantidad);
                        agregados++;
                    } else {
                        console.warn(`Producto no encontrado: ${producto.codigo_producto}`);
                        errores++;
                    }
                } catch (error) {
                    console.error(`Error al agregar producto ${producto.codigo_producto}:`, error);
                    errores++;
                }
            }

            // Actualizar UI del carrito
            window.ui.updateCartBadge();
            this.updateCartView();

            // Mostrar resultado
            if (agregados > 0) {
                window.ui.showToast(
                    `${agregados} producto${agregados !== 1 ? 's' : ''} agregado${agregados !== 1 ? 's' : ''} al carrito`,
                    'success'
                );
                
                // Cambiar a la pantalla del carrito
                this.showScreen('cart');
            }

            if (errores > 0) {
                window.ui.showToast(
                    `${errores} producto${errores !== 1 ? 's' : ''} no ${errores !== 1 ? 'pudieron' : 'pudo'} agregarse`,
                    'warning'
                );
            }

        } catch (error) {
            console.error('Error al reordenar productos:', error);
            window.ui.showToast('Error al reordenar productos', 'error');
        }
    }

    /**
     * Reordena un solo producto de un pedido anterior
     */
    async reorderSingleProduct(codigoProducto, cantidad) {
        try {
            // Buscar el producto completo desde la base de datos
            const productoBD = await window.supabaseClient.searchProductByCode(codigoProducto);
            
            if (!productoBD) {
                window.ui.showToast('Producto no encontrado', 'error');
                return;
            }

            // Asegurar formato correcto para addProduct
            const producto = {
                codigo: productoBD.codigo,
                descripcion: productoBD.descripcion,
                pvp: productoBD.pvp || productoBD.precio_unitario || 0
            };

            // Agregar al carrito
            await window.cartManager.addProduct(producto, cantidad);
            
            // Actualizar UI del carrito
            window.ui.updateCartBadge();
            this.updateCartView();

            // Mostrar confirmación
            window.ui.showToast(`${producto.descripcion} agregado al carrito`, 'success');

        } catch (error) {
            console.error('Error al reordenar producto:', error);
            window.ui.showToast('Error al agregar producto', 'error');
        }
    }

    /**
     * Carga ofertas si no están en cache o si es necesario actualizarlas
     */
    async loadOfertasIfNeeded() {
        try {
            // Verificar si hay ofertas en cache
            if (window.cartManager && window.cartManager.db) {
                const transaction = window.cartManager.db.transaction(['ofertas'], 'readonly');
                const store = transaction.objectStore('ofertas');
                const countRequest = store.count();
                
                countRequest.onsuccess = async () => {
                    const count = countRequest.result;
                    if (count === 0) {
                        // No hay ofertas en cache, descargarlas
                        console.log('📥 Descargando ofertas por primera vez...');
                        try {
                            await window.supabaseClient.downloadOfertas();
                            console.log('✅ Ofertas descargadas y guardadas en caché');
                        } catch (error) {
                            console.error('Error al descargar ofertas (no crítico):', error);
                        }
                    } else {
                        console.log(`✅ Ofertas en cache: ${count} ofertas`);
                    }
                };
                
                countRequest.onerror = () => {
                    console.log('No se pudo verificar cache de ofertas, descargando...');
                    window.supabaseClient.downloadOfertas().catch(err => {
                        console.error('Error al descargar ofertas (no crítico):', err);
                    });
                };
            } else {
                // Si no hay db, intentar descargar directamente
                window.supabaseClient.downloadOfertas().catch(err => {
                    console.error('Error al descargar ofertas (no crítico):', err);
                });
            }
        } catch (error) {
            console.error('Error al verificar ofertas en cache:', error);
        }
    }

    /**
     * Obtiene información completa de una oferta desde cache local
     * La información incluye titulo_descripcion y descripcion_detallada
     */
    async getOfertaInfo(numeroOferta) {
        try {
            if (!window.cartManager || !window.cartManager.db) {
                console.warn('⚠️ CartManager o DB no disponible para obtener info de oferta');
                return null;
            }

            console.log(`🔍 Buscando información de oferta ${numeroOferta} en cache local...`);

            return new Promise((resolve) => {
                const transaction = window.cartManager.db.transaction(['ofertas'], 'readonly');
                const store = transaction.objectStore('ofertas');
                const request = store.get(numeroOferta);

                request.onsuccess = () => {
                    const oferta = request.result;
                    if (oferta) {
                        console.log(`✅ Oferta ${numeroOferta} encontrada en cache:`, {
                            numero: oferta.numero_oferta,
                            titulo: oferta.titulo_descripcion,
                            tiene_descripcion: !!oferta.descripcion_detallada
                        });
                    } else {
                        console.warn(`⚠️ Oferta ${numeroOferta} NO encontrada en cache local`);
                    }
                    resolve(oferta || null);
                };

                request.onerror = () => {
                    console.error('❌ Error al obtener información de oferta desde IndexedDB:', request.error);
                    resolve(null);
                };
            });
        } catch (error) {
            console.error('❌ Error al obtener oferta:', error);
            return null;
        }
    }

    /**
     * Muestra el modal con información detallada de la oferta
     */
    async showOfertaInfoModal(ofertaData) {
        const modal = document.getElementById('ofertaInfoModal');
        const overlay = modal.querySelector('.oferta-info-overlay');
        const closeBtnBottom = document.getElementById('closeOfertaInfoBtn');
        const verOfertaBtn = document.getElementById('verOfertaBtn');
        const titleEl = document.getElementById('ofertaInfoTitle');
        const descriptionEl = document.getElementById('ofertaInfoDescription');
        const imagesContainer = document.getElementById('ofertaInfoImages');

        if (!modal || !ofertaData) {
            console.error('Modal de oferta o datos no encontrados');
            return;
        }

        // Establecer título y descripción desde los datos de la oferta
        titleEl.textContent = ofertaData.titulo_descripcion || 'Oferta disponible';
        descriptionEl.textContent = ofertaData.descripcion_detallada || 'Esta oferta está disponible para este producto.';

        // Cargar miniaturas de productos de la oferta (máximo 5)
        if (imagesContainer) {
            imagesContainer.innerHTML = ''; // Limpiar
            
            try {
                const codigosArticulos = await this.getCodigosArticulosOferta(ofertaData.numero_oferta);
                const codigosLimitados = codigosArticulos.slice(0, 5);
                
                for (const codigo of codigosLimitados) {
                    const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${codigo}_1.JPG`;
                    const imgDiv = document.createElement('div');
                    imgDiv.className = 'oferta-info-thumbnail';
                    imgDiv.innerHTML = `
                        <img src="${imageUrl}" alt="${codigo}" 
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="oferta-info-thumbnail-placeholder" style="display: none;">📦</div>
                    `;
                    imagesContainer.appendChild(imgDiv);
                }
                
                // Si hay más de 5 productos, añadir indicador
                if (codigosArticulos.length > 5) {
                    const moreDiv = document.createElement('div');
                    moreDiv.className = 'oferta-info-thumbnail oferta-info-more';
                    moreDiv.innerHTML = `<div class="oferta-info-more-text">+${codigosArticulos.length - 5}</div>`;
                    imagesContainer.appendChild(moreDiv);
                }
            } catch (error) {
                console.error('Error al cargar imágenes de productos:', error);
                imagesContainer.innerHTML = '<div class="oferta-info-icon">🎉</div>';
            }
        }

        // Mostrar modal
        modal.style.display = 'flex';

        // Guardar referencia al contexto
        const self = this;

        // Manejadores de eventos
        const handleClose = () => {
            modal.style.display = 'none';
            cleanup();
        };

        const handleVerOferta = async () => {
            // Cerrar el modal de información
            modal.style.display = 'none';
            cleanup();

            // Cerrar también el modal de añadir al carrito si está abierto
            const addToCartModal = document.getElementById('addToCartModal');
            if (addToCartModal) {
                addToCartModal.style.display = 'none';
            }

            // Cambiar a la pantalla de búsqueda
            self.showScreen('search');

            // Buscar todos los productos de esta oferta
            await self.searchProductsByOferta(ofertaData.numero_oferta);
        };

        const cleanup = () => {
            closeBtnBottom.removeEventListener('click', handleClose);
            overlay.removeEventListener('click', handleClose);
            verOfertaBtn.removeEventListener('click', handleVerOferta);
        };

        // Añadir listeners
        closeBtnBottom.addEventListener('click', handleClose);
        overlay.addEventListener('click', handleClose);
        verOfertaBtn.addEventListener('click', handleVerOferta);
    }

    /**
     * Navega a la búsqueda de productos de una oferta desde el carrito
     */
    async verProductosOfertaDesdeCarrito(numeroOferta) {
        try {
            console.log(`🔍 Navegando a productos de oferta ${numeroOferta} desde carrito...`);
            
            // Cambiar a la pantalla de búsqueda
            this.showScreen('search');
            
            // Buscar los productos de la oferta
            await this.searchProductsByOferta(numeroOferta);
            
        } catch (error) {
            console.error('Error al navegar a productos de oferta:', error);
            window.ui.showToast('Error al cargar productos de la oferta', 'error');
        }
    }

    /**
     * Busca todos los productos que pertenecen a una oferta
     */
    async searchProductsByOferta(numeroOferta) {
        try {
            console.log(`🔍 Buscando productos de la oferta ${numeroOferta}...`);
            window.ui.showLoading();

            // Obtener todos los códigos de artículos de esta oferta desde el cache local
            const codigosArticulos = await this.getCodigosArticulosOferta(numeroOferta);

            if (!codigosArticulos || codigosArticulos.length === 0) {
                window.ui.hideLoading();
                window.ui.showToast('No se encontraron productos en esta oferta', 'warning');
                await this.displaySearchResults([]);
                return;
            }

            console.log(`📦 ${codigosArticulos.length} productos en la oferta`);

            // Buscar cada producto en el cache local
            const productos = [];
            for (const codigo of codigosArticulos) {
                const producto = await window.cartManager.searchProductsExact(codigo);
                if (producto && producto.length > 0) {
                    productos.push(producto[0]);
                }
            }

            console.log(`✅ ${productos.length} productos encontrados en cache local`);

            // Actualizar el título de resultados
            const resultsTitle = document.getElementById('searchResultsTitle');
            if (resultsTitle) {
                resultsTitle.textContent = `Productos de la oferta (${productos.length})`;
            }

            // Mostrar resultados
            await this.displaySearchResults(productos, false);
            window.ui.showToast(`${productos.length} productos de la oferta`, 'success');

        } catch (error) {
            console.error('Error al buscar productos de oferta:', error);
            window.ui.showToast('Error al cargar productos de la oferta', 'error');
        } finally {
            window.ui.hideLoading();
        }
    }

    /**
     * Obtiene los códigos de artículos de una oferta desde el cache local
     */
    async getCodigosArticulosOferta(numeroOferta) {
        try {
            if (!window.cartManager || !window.cartManager.db) {
                console.warn('⚠️ CartManager o DB no disponible');
                return [];
            }

            return new Promise((resolve) => {
                const transaction = window.cartManager.db.transaction(['ofertas_productos'], 'readonly');
                const store = transaction.objectStore('ofertas_productos');
                const index = store.index('numero_oferta');
                const request = index.getAll(numeroOferta);

                request.onsuccess = () => {
                    const productos = request.result || [];
                    const codigos = productos.map(p => p.codigo_articulo);
                    console.log(`📋 Códigos de artículos en oferta ${numeroOferta}:`, codigos);
                    resolve(codigos);
                };

                request.onerror = () => {
                    console.error('❌ Error al obtener códigos de artículos:', request.error);
                    resolve([]);
                };
            });
        } catch (error) {
            console.error('❌ Error al obtener códigos de artículos:', error);
            return [];
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

