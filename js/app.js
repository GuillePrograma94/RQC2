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
        this.editingWcConjuntoId = null;
        this.wcConjuntoPreviewData = { taza: null, tanque: null, asiento: null };
        this.recambiosProductoCodigo = null;
        this.recambiosPreviewRecambio = null;
        this.recambiosPreviewPadre = null;
        // Stock
        this.stockAlmacenFiltro = null; // null = global; string = almacen especifico
        this.stockIndex = new Map();    // Map<codigo_articulo_upper, {stock_global, por_almacen}>
        // Estado de chips de filtro de búsqueda
        this.filterChips = {
            misCompras: false,
            oferta: false,
            fabricante: '',      // '' = inactivo
            precioDesde: null,
            precioHasta: null,
            activeConfig: null,  // null | 'fabricante' | 'precio' | 'almacen' (panel abierto)
        };
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
     * Escapa para contenido HTML preservando saltos de línea (para observaciones en tarjetas de pedido).
     * Normaliza múltiples saltos y espacios alrededor a un solo \n.
     */
    escapeForHtmlContentPreservingNewlines(str) {
        if (!str) return '';
        const trimmed = String(str).trim();
        const normalized = trimmed
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\s*\n\s*/g, '\n');
        return normalized
            .replace(/&/g, '&amp;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
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

            // Configurar pantalla de acceso (gate) y modal de login (debe estar antes del gate para que el submit no recargue la pagina)
            this.setupGateScreen();

            // Inicializar Supabase
            const supabaseOK = await window.supabaseClient.initialize();
            if (!supabaseOK) {
                throw new Error('No se pudo conectar con el servidor');
            }

            // Inicializar cliente ERP (sin bloqueo)
            if (window.erpClient) {
                window.erpClient.initialize();
            }

            // Verificar si hay sesion guardada: sin usuario solo se muestra la landing
            const savedUser = this.loadUserSession();
            if (!savedUser) {
                this.showLanding();
                window.ui.hideLoading();
                return;
            }

            // Verificar que la sesion de Supabase Auth sigue activa.
            // Si el JWT expiro y el refresh token ya no es valido, forzar re-login
            // para garantizar que las operaciones de escritura con RLS funcionen.
            const { data: authSessionData } = await window.supabaseClient.client.auth.getSession();
            if (!authSessionData?.session) {
                console.log('Sesion de Supabase Auth expirada. Requiere nuevo login.');
                localStorage.removeItem('current_user');
                localStorage.removeItem('current_session');
                await window.supabaseClient.client.auth.signOut().catch(() => {});
                this.showLanding();
                window.ui.hideLoading();
                return;
            }

            console.log('Sesion de usuario encontrada:', savedUser.user_name);
            this.currentUser = savedUser;
            this.updateUserUI();

            // Precargar historial de compras en segundo plano (solo clientes, no comerciales)
            if (window.purchaseCache && savedUser.user_id && !savedUser.is_comercial) {
                console.log('Precargando historial para sesion guardada...');
                window.purchaseCache.preload(savedUser.user_id);
            }

            // Configurar listener de cambios de estado de pedidos (solo clientes)
            if (!savedUser.is_comercial) {
                this.setupOrderStatusListener();
            }

            // Inicializar app primero para ocultar loading; no bloquear en permisos de notificaciones
            await this.initializeApp();

            if (window.erpRetryQueue && typeof window.erpRetryQueue.init === 'function') {
                window.erpRetryQueue.init().catch(function (err) {
                    console.warn('Cola de reintentos ERP no inicializada:', err);
                });
            }
            if (window.offlineOrderQueue && typeof window.offlineOrderQueue.init === 'function') {
                window.offlineOrderQueue.init().then(function () {
                    return window.offlineOrderQueue.processAll();
                }).catch(function (err) {
                    console.warn('Cola de pedidos offline no inicializada:', err);
                });
            }

            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.addEventListener('message', function (event) {
                    if (event.data && event.data.type === 'PROCESS_OFFLINE_ORDERS') {
                        if (window.offlineOrderQueue && typeof window.offlineOrderQueue.processAll === 'function') {
                            window.offlineOrderQueue.processAll();
                        }
                        if (window.erpRetryQueue && typeof window.erpRetryQueue.runRetries === 'function') {
                            window.erpRetryQueue.runRetries([]);
                        }
                    }
                });
            }

            // Solicitar permisos de notificaciones en segundo plano (no bloquear la entrada a la app)
            this.requestNotificationPermission().catch(() => {});

            // Cargar ofertas en segundo plano si no estan en cache
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
     * Configura la página de login (gate): formulario en la propia página
     */
    setupGateScreen() {
        const gateLoginForm = document.getElementById('gateLoginForm');
        if (gateLoginForm) {
            gateLoginForm.onsubmit = (e) => this.handleLogin(e);
        }
    }

    /**
     * Muestra la pantalla de acceso (solo visitantes sin sesion)
     */
    showLanding() {
        document.body.classList.add('gate-visible');
        const gateScreen = document.getElementById('gateScreen');
        if (gateScreen) gateScreen.setAttribute('aria-hidden', 'false');
    }

    /**
     * Oculta la pantalla de acceso y muestra la app
     * Quita el foco del gate antes de aria-hidden para evitar el aviso de accesibilidad
     */
    hideLanding() {
        const gateScreen = document.getElementById('gateScreen');
        if (gateScreen && gateScreen.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        document.body.classList.remove('gate-visible');
        if (gateScreen) gateScreen.setAttribute('aria-hidden', 'true');
    }

    /**
     * Muestra la página de login (gate). Usado desde el menú si se necesita.
     */
    showLoginModal() {
        this.showLanding();
        this.closeMenu();
    }

    /**
     * Limpia el formulario de login de la página (gate)
     */
    hideLoginModal() {
        const gateLoginForm = document.getElementById('gateLoginForm');
        if (gateLoginForm) gateLoginForm.reset();
        const errorDiv = document.getElementById('gateLoginError');
        if (errorDiv) errorDiv.style.display = 'none';
    }

    /**
     * Maneja el proceso de login (formulario en la página de login / gate)
     */
    async handleLogin(e) {
        e.preventDefault();

        const codigoInput = document.getElementById('gateCodigo');
        const passwordInput = document.getElementById('gatePassword');
        const errorDiv = document.getElementById('gateLoginError');
        const submitBtn = document.getElementById('gateSubmitBtn');

        if (!codigoInput || !passwordInput) return;

        const codigo = codigoInput.value.trim();
        const password = passwordInput.value;

        if (!codigo || !password) {
            this.showLoginError('Por favor completa todos los campos');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Entrando...';
        }

        try {
            // Intentar login
            const loginResult = await window.supabaseClient.loginUser(codigo, password);

            if (loginResult.success) {
                const tipo = (loginResult.tipo && String(loginResult.tipo).toUpperCase()) || 'CLIENTE';
                const isComercial = tipo === 'COMERCIAL' || !!loginResult.es_comercial;

                this.currentUser = {
                    user_id: loginResult.user_id ?? null,
                    user_name: loginResult.user_name,
                    codigo_usuario: loginResult.codigo_usuario,
                    grupo_cliente: loginResult.grupo_cliente || null,
                    codigo_usuario_titular: loginResult.codigo_usuario_titular || null,
                    almacen_habitual: loginResult.almacen_habitual || null,
                    is_operario: !!loginResult.es_operario,
                    nombre_operario: loginResult.nombre_operario || null,
                    nombre_titular: loginResult.nombre_titular || null,
                    tipo: tipo,
                    is_comercial: isComercial,
                    is_administrador: !!loginResult.es_administrador,
                    comercial_id: loginResult.comercial_id ?? null,
                    comercial_numero: loginResult.comercial_numero ?? null
                };

                // Crear sesion en sesiones_usuario solo para clientes (titular/operario); comerciales no usan sesiones_usuario
                let sessionId = null;
                if (!isComercial) {
                    sessionId = await window.supabaseClient.createUserSession(codigo);
                    if (sessionId) this.currentSession = sessionId;
                }

                // Guardar sesión en localStorage
                this.saveUserSession(this.currentUser, sessionId);

                // Actualizar UI con nombre del usuario
                this.updateUserUI();

                // Ocultar página de login y mostrar la app
                this.hideLanding();
                this.hideLoginModal();

                // Cerrar menú
                this.closeMenu();

                // Inicializar app si aun no se ha hecho (primer login desde la landing)
                if (!this.isInitialized) {
                    await this.initializeApp();
                }

                // Mostrar mensaje de bienvenida
                window.ui.showToast(`Bienvenido, ${this.currentUser.user_name}`, 'success');

                // Precargar historial y listener de pedidos solo para clientes (no comerciales)
                if (!this.currentUser.is_comercial && window.purchaseCache && this.currentUser.user_id) {
                    console.log('Precargando historial de compras...');
                    window.purchaseCache.preload(this.currentUser.user_id);
                }
                if (!this.currentUser.is_comercial) {
                    this.setupOrderStatusListener();
                }

                // Solicitar permisos de notificaciones en segundo plano (no bloquear)
                this.requestNotificationPermission().catch(() => {});

            } else {
                this.showLoginError(loginResult.message || 'Usuario o contraseña incorrectos');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Entrar';
                }
            }

        } catch (error) {
            console.error('Error al iniciar sesión:', error);
            this.showLoginError('Error de conexión. Intenta de nuevo.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Entrar';
            }
        }
    }

    /**
     * Muestra un error en el formulario de login (página gate)
     */
    showLoginError(message) {
        const errorDiv = document.getElementById('gateLoginError');
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

            console.log('Manejando cambio de estado de pedido:');
            console.log('   - Estado anterior:', oldRecord?.estado, oldRecord?.estado_procesamiento);
            console.log('   - Estado nuevo:', newRecord?.estado, newRecord?.estado_procesamiento);
            console.log('   - ID del pedido:', newRecord?.id);
            console.log('   - Codigo QR:', newRecord?.codigo_qr);

            const isEnPreparacion = newRecord?.estado === 'en_preparacion' && newRecord?.estado_procesamiento === 'procesando';
            const wasEnPreparacion = oldRecord?.estado === 'en_preparacion' && oldRecord?.estado_procesamiento === 'procesando';
            const isCompletado = newRecord?.estado === 'completado' && newRecord?.estado_procesamiento === 'completado';
            const wasCompletado = oldRecord?.estado === 'completado' && oldRecord?.estado_procesamiento === 'completado';

            // En preparacion (impreso en caja): solo actualizar lista si estamos en Mis Pedidos; NO notificar "listo para recoger"
            // La notificacion al cliente debe aparecer cuando se marca como ENTREGADO (completado), no al imprimir el ticket
            if (isEnPreparacion && !wasEnPreparacion) {
                console.log('Pedido en preparacion (impreso en caja) - ID:', newRecord.id, '- sin notificacion');
                if (this.currentScreen === 'myOrders') {
                    await this.loadMyOrders();
                }
            }
            // Completado (marcar entregado en caja): notificacion "pedido completado"
            else if (isCompletado && !wasCompletado) {
                console.log('Pedido completado - ID:', newRecord.id);
                if (Notification.permission !== 'granted') {
                    await this.requestNotificationPermission();
                }
                await this.showOrderCompletedNotification(newRecord);
                if (this.currentScreen === 'myOrders') {
                    await this.loadMyOrders();
                }
            } else {
                console.log('Cambio de estado no relevante para notificaciones');
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
     * Muestra notificación cuando el pedido está completado (estado=completado, estado_procesamiento=completado).
     */
    async showOrderCompletedNotification(pedido) {
        try {
            if (!this.notificationsEnabled || Notification.permission !== 'granted') {
                if (Notification.permission === 'default') {
                    await this.requestNotificationPermission();
                } else {
                    return;
                }
            }
            if (!('serviceWorker' in navigator)) return;
            const registration = await navigator.serviceWorker.ready;
            const almacen = pedido.almacen_destino || 'Almacén';
            const titulo = 'Pedido completado';
            const mensaje = `ALMACEN ${almacen}: Tu pedido ha sido completado.`;
            await registration.showNotification(titulo, {
                body: mensaje,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: `order-completed-${pedido.id}`,
                requireInteraction: true,
                vibrate: [200, 100, 200],
                data: {
                    orderId: pedido.id,
                    codigoQR: pedido.codigo_qr,
                    almacen: almacen,
                    url: '/'
                },
                actions: [
                    { action: 'open', title: 'Ver Mis Pedidos' },
                    { action: 'close', title: 'Cerrar' }
                ]
            });
        } catch (error) {
            console.error('Error al mostrar notificación de pedido completado:', error);
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
        const menuUserSubtitle = document.getElementById('menuUserSubtitle');
        const menuUserInfo = document.getElementById('menuUserInfo');
        const menuUserArrow = menuUserInfo ? menuUserInfo.querySelector('.user-info-arrow') : null;
        const chipMisCompras = document.getElementById('chipMisCompras');
        const chipOferta     = document.getElementById('chipOferta');

        if (this.currentUser) {
            // Usuario logueado
            if (menuGuest) menuGuest.style.display = 'none';
            if (menuUser) menuUser.style.display = 'block';
            if (this.currentUser.is_comercial) {
                if (menuUserName) {
                    menuUserName.textContent = this.currentUser.user_name || 'Comercial';
                }
                if (menuUserCode) {
                    menuUserCode.textContent = 'Nº ' + (this.currentUser.comercial_numero || this.currentUser.codigo_usuario || '');
                    menuUserCode.style.display = 'block';
                }
                if (menuUserSubtitle) {
                    menuUserSubtitle.style.display = 'block';
                    menuUserSubtitle.textContent = this.currentUser.cliente_representado_nombre
                        ? ('Representando a: ' + this.currentUser.cliente_representado_nombre)
                        : 'Toca para seleccionar cliente';
                }
                if (menuUserInfo) {
                    menuUserInfo.classList.remove('user-info-view-only');
                    menuUserInfo.setAttribute('aria-label', 'Seleccionar cliente a representar');
                }
                if (menuUserArrow) menuUserArrow.style.display = '';
                // Chip Mis compras: solo si hay cliente representado
                if (chipMisCompras) {
                    chipMisCompras.style.display = this.currentUser.cliente_representado_id ? '' : 'none';
                }
                // Chip Oferta: solo si hay cliente representado
                if (chipOferta) {
                    chipOferta.style.display = this.currentUser.cliente_representado_id ? '' : 'none';
                }
                var menuCommercialCard = document.getElementById('menuCommercialCard');
                if (menuCommercialCard) menuCommercialCard.style.display = 'none';
                var myOrdersBtn = document.getElementById('myOrdersBtn');
                if (myOrdersBtn) myOrdersBtn.style.display = '';
            } else if (this.currentUser.is_operario) {
                // Operario: nombre empresa (grande) + nombre operario (pequeño); bloque solo informativo, no botón
                if (menuUserName) {
                    menuUserName.textContent = this.currentUser.nombre_titular || this.currentUser.user_name || '--';
                }
                if (menuUserCode) {
                    menuUserCode.textContent = '';
                    menuUserCode.style.display = 'none';
                }
                if (menuUserSubtitle) {
                    menuUserSubtitle.textContent = this.currentUser.nombre_operario || '--';
                    menuUserSubtitle.style.display = 'block';
                }
                if (menuUserInfo) {
                    menuUserInfo.classList.add('user-info-view-only');
                    menuUserInfo.setAttribute('aria-label', 'Sesion de operario');
                }
                if (menuUserArrow) menuUserArrow.style.display = 'none';
                if (chipMisCompras) chipMisCompras.style.display = '';
                if (chipOferta)     chipOferta.style.display = '';
                if (!this.currentUser.comercial) {
                    this.loadComercialAsignado();
                } else {
                    this.updateComercialCard();
                }
            } else {
                // Titular: nombre y código; bloque clicable para ir a Mi perfil
                if (menuUserName) {
                    menuUserName.textContent = this.currentUser.user_name;
                }
                if (menuUserCode) {
                    menuUserCode.textContent = 'Código: ' + this.currentUser.codigo_usuario;
                    menuUserCode.style.display = 'block';
                }
                if (menuUserSubtitle) {
                    menuUserSubtitle.style.display = 'none';
                }
                if (menuUserInfo) {
                    menuUserInfo.classList.remove('user-info-view-only');
                    menuUserInfo.setAttribute('aria-label', 'Ver mi perfil');
                }
                if (menuUserArrow) menuUserArrow.style.display = '';
                if (chipMisCompras) chipMisCompras.style.display = '';
                if (chipOferta)     chipOferta.style.display = '';
                var myOrdersBtn = document.getElementById('myOrdersBtn');
                if (myOrdersBtn) myOrdersBtn.style.display = '';
                if (!this.currentUser.comercial) {
                    this.loadComercialAsignado();
                } else {
                    this.updateComercialCard();
                }
            }
            var herramientasBtn = document.getElementById('herramientasBtn');
            if (herramientasBtn) herramientasBtn.style.display = '';
            var panelControlBtn = document.getElementById('panelControlBtn');
            if (panelControlBtn) panelControlBtn.style.display = this.currentUser.is_administrador ? '' : 'none';
        } else {
            // Usuario NO logueado
            if (menuGuest) menuGuest.style.display = 'block';
            if (menuUser) menuUser.style.display = 'none';
            // Ocultar chips de usuario en búsqueda
            if (chipMisCompras) { chipMisCompras.style.display = 'none'; chipMisCompras.classList.remove('active'); }
            if (chipOferta)     { chipOferta.style.display = 'none';     chipOferta.classList.remove('active'); }
            this.filterChips.misCompras = false;
            this.filterChips.oferta = false;
            const menuCommercialCard = document.getElementById('menuCommercialCard');
            if (menuCommercialCard) menuCommercialCard.style.display = 'none';
            const herramientasBtnGuest = document.getElementById('herramientasBtn');
            if (herramientasBtnGuest) herramientasBtnGuest.style.display = 'none';
            const panelControlBtnGuest = document.getElementById('panelControlBtn');
            if (panelControlBtnGuest) panelControlBtnGuest.style.display = 'none';
        }
    }

    /**
     * Carga los datos del comercial asignado y actualiza la tarjeta del menú
     */
    async loadComercialAsignado() {
        if (!this.currentUser || !this.currentUser.user_id) return;
        try {
            const comercial = await window.supabaseClient.getComercialAsignado(this.currentUser.user_id);
            this.currentUser.comercial = comercial || null;
            this.updateComercialCard();
        } catch (e) {
            console.error('Error cargando comercial:', e);
            this.currentUser.comercial = null;
            this.updateComercialCard();
        }
    }

    /**
     * Actualiza la tarjeta del comercial en el menú lateral
     */
    updateComercialCard() {
        const card = document.getElementById('menuCommercialCard');
        const nameEl = document.getElementById('menuCommercialName');
        if (!card || !nameEl) return;
        if (this.currentUser && this.currentUser.comercial) {
            card.style.display = 'flex';
            nameEl.textContent = this.currentUser.comercial.nombre;
        } else {
            card.style.display = 'none';
        }
    }

    /**
     * Rellena y muestra la pantalla de detalle del comercial (Llamar, WhatsApp, Email)
     */
    renderCommercialScreen() {
        const detail = document.getElementById('commercialDetail');
        const empty = document.getElementById('commercialEmpty');
        const nameEl = document.getElementById('commercialDetailName');
        const phoneEl = document.getElementById('commercialDetailPhone');
        const emailEl = document.getElementById('commercialDetailEmail');
        const btnCall = document.getElementById('commercialBtnCall');
        const btnWhatsApp = document.getElementById('commercialBtnWhatsApp');
        const btnEmail = document.getElementById('commercialBtnEmail');
        if (!detail || !empty) return;

        if (!this.currentUser || !this.currentUser.comercial) {
            detail.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        const c = this.currentUser.comercial;
        detail.style.display = 'block';
        empty.style.display = 'none';
        if (nameEl) nameEl.textContent = c.nombre || '--';

        const hasPhone = !!(c.telefono && c.telefono.trim());
        const hasEmail = !!(c.email && c.email.trim());

        if (phoneEl) {
            phoneEl.style.display = hasPhone ? 'block' : 'none';
            phoneEl.textContent = hasPhone ? c.telefono : '';
        }
        if (emailEl) {
            emailEl.style.display = hasEmail ? 'block' : 'none';
            emailEl.textContent = hasEmail ? c.email : '';
        }

        if (btnCall) {
            btnCall.style.display = hasPhone ? 'flex' : 'none';
            btnCall.dataset.telefono = (c.telefono || '').trim();
        }
        if (btnWhatsApp) {
            btnWhatsApp.style.display = hasPhone ? 'flex' : 'none';
            btnWhatsApp.dataset.telefono = (c.telefono || '').trim();
        }
        if (btnEmail) {
            btnEmail.style.display = hasEmail ? 'flex' : 'none';
            btnEmail.dataset.email = (c.email || '').trim();
        }
    }

    /**
     * Pantalla comercial: listar clientes asignados y permitir elegir a quien representar.
     * Guarda la lista en _clientesAsignadosComercial y aplica filtro por numero/nombre.
     */
    async renderSelectorClienteScreen() {
        const listEl = document.getElementById('selectorClienteList');
        const emptyEl = document.getElementById('selectorClienteEmpty');
        const noMatchEl = document.getElementById('selectorClienteNoMatch');
        const filterNum = document.getElementById('selectorClienteFilterNumero');
        const filterNombre = document.getElementById('selectorClienteFilterNombre');
        if (!listEl || !emptyEl) return;
        if (!this.currentUser || !this.currentUser.is_comercial) return;

        if (filterNum) filterNum.value = '';
        if (filterNombre) filterNombre.value = '';
        const filterPoblacion = document.getElementById('selectorClienteFilterPoblacion');
        if (filterPoblacion) filterPoblacion.value = '';

        const numero = this.currentUser.comercial_numero != null ? this.currentUser.comercial_numero : parseInt(this.currentUser.codigo_usuario, 10);
        const clientes = await window.supabaseClient.getClientesAsignadosComercial(numero);
        this._clientesAsignadosComercial = Array.isArray(clientes) ? clientes : [];

        if (!this._clientesAsignadosComercial.length) {
            if (emptyEl) emptyEl.style.display = 'block';
            if (noMatchEl) noMatchEl.style.display = 'none';
            listEl.innerHTML = '';
            return;
        }
        this._updateSelectorClienteRepresentandoBlock();
        this._renderSelectorClienteList(this._clientesAsignadosComercial);
    }

    /**
     * Actualiza el bloque superior "Estas representando a X. [Añadir alias]"
     * cuando el comercial tiene un cliente seleccionado.
     */
    _updateSelectorClienteRepresentandoBlock() {
        const block = document.getElementById('selectorClienteRepresentando');
        const nameEl = document.getElementById('selectorClienteRepresentandoNombre');
        const aliasBtn = document.getElementById('selectorClienteAñadirAliasBtn');
        if (!block || !nameEl || !aliasBtn) return;
        const id = this.currentUser && this.currentUser.cliente_representado_id;
        if (!id) {
            block.style.display = 'none';
            return;
        }
        const cliente = this._clientesAsignadosComercial && this._clientesAsignadosComercial.find(function (c) { return c.id === id; });
        if (!cliente) {
            block.style.display = 'none';
            return;
        }
        nameEl.textContent = cliente.nombre || this.currentUser.cliente_representado_nombre || '';
        aliasBtn.textContent = cliente.alias ? 'Editar alias' : 'Añadir alias';
        aliasBtn.onclick = () => this.openEditAliasModal(cliente);
        block.style.display = 'block';
    }

    /**
     * Filtra la lista de clientes asignados por numero y/o nombre y vuelve a renderizar.
     */
    _applySelectorClienteFilter() {
        if (!this._clientesAsignadosComercial || !this._clientesAsignadosComercial.length) return;
        const filterNum = document.getElementById('selectorClienteFilterNumero');
        const filterNombre = document.getElementById('selectorClienteFilterNombre');
        const filterPoblacion = document.getElementById('selectorClienteFilterPoblacion');
        const num = (filterNum && filterNum.value) ? filterNum.value.trim().toLowerCase() : '';
        const nom = (filterNombre && filterNombre.value) ? filterNombre.value.trim().toLowerCase() : '';
        const pob = (filterPoblacion && filterPoblacion.value) ? filterPoblacion.value.trim().toLowerCase() : '';
        let filtered = this._clientesAsignadosComercial;
        if (num) {
            filtered = filtered.filter(function (c) {
                const codigo = (c.codigo_usuario || '').toString().toLowerCase();
                return codigo.indexOf(num) !== -1;
            });
        }
        if (nom) {
            filtered = filtered.filter(function (c) {
                const nombre = (c.nombre || '').toString().toLowerCase();
                const alias = (c.alias || '').toString().toLowerCase();
                return nombre.indexOf(nom) !== -1 || alias.indexOf(nom) !== -1;
            });
        }
        if (pob) {
            filtered = filtered.filter(function (c) {
                const poblacion = (c.poblacion || '').toString().toLowerCase();
                return poblacion.indexOf(pob) !== -1;
            });
        }
        this._renderSelectorClienteList(filtered, !!num || !!nom || !!pob);
    }

    /**
     * Renderiza la lista de clientes en el selector (array ya filtrado).
     * @param {Array} clientesToShow - Lista de clientes a mostrar
     * @param {boolean} [showNoMatchWhenEmpty] - Si true y clientesToShow vacio, mostrar "Ningun cliente coincide con el filtro"
     */
    _renderSelectorClienteList(clientesToShow, showNoMatchWhenEmpty) {
        const listEl = document.getElementById('selectorClienteList');
        const emptyEl = document.getElementById('selectorClienteEmpty');
        const noMatchEl = document.getElementById('selectorClienteNoMatch');
        if (!listEl || !emptyEl) return;

        listEl.innerHTML = '';
        if (!clientesToShow || clientesToShow.length === 0) {
            if (showNoMatchWhenEmpty && noMatchEl) {
                noMatchEl.style.display = 'block';
                emptyEl.style.display = 'none';
            } else {
                if (noMatchEl) noMatchEl.style.display = 'none';
                emptyEl.style.display = 'block';
            }
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';
        if (noMatchEl) noMatchEl.style.display = 'none';

        const self = this;
        clientesToShow.forEach(function (c) {
            const item = document.createElement('div');
            item.className = 'profile-operario-item selector-cliente-item';
            item.dataset.clienteId = c.id;
            item.dataset.clienteNombre = (c.nombre || '').trim();
            const info = document.createElement('div');
            info.className = 'profile-operario-info';
            const nameDiv = document.createElement('div');
            nameDiv.className = 'profile-operario-name';
            nameDiv.textContent = c.nombre || '--';
            const codeDiv = document.createElement('div');
            codeDiv.className = 'profile-operario-codigo';
            codeDiv.textContent = 'Codigo: ' + (c.codigo_usuario || '');
            info.appendChild(nameDiv);
            if (c.alias) {
                const aliasDiv = document.createElement('div');
                aliasDiv.className = 'profile-operario-codigo';
                aliasDiv.textContent = 'Alias: ' + c.alias;
                info.appendChild(aliasDiv);
            }
            if (c.poblacion) {
                const pobDiv = document.createElement('div');
                pobDiv.className = 'profile-operario-codigo';
                pobDiv.textContent = 'Poblacion: ' + c.poblacion;
                info.appendChild(pobDiv);
            }
            info.appendChild(codeDiv);
            item.appendChild(info);

            item.addEventListener('click', function () {
                self.currentUser.cliente_representado_id = c.id;
                self.currentUser.cliente_representado_nombre = (c.nombre || '').trim();
                self.currentUser.cliente_representado_almacen_habitual = c.almacen_habitual != null ? c.almacen_habitual : null;
                self.currentUser.cliente_representado_grupo_cliente = c.grupo_cliente != null ? c.grupo_cliente : null;
                self.saveUserSession(self.currentUser, self.currentSession);
                self.updateUserUI();
                if (window.purchaseCache && c.id) {
                    window.purchaseCache.preload(c.id);
                }
                self.showScreen('cart');
                window.ui.showToast('Representando a ' + self.currentUser.cliente_representado_nombre, 'success');
            });
            listEl.appendChild(item);
        });
    }

    /**
     * Devuelve el user_id a usar para pedidos/historial: el del cliente o el cliente representado (comercial)
     */
    getEffectiveUserId() {
        if (!this.currentUser) return null;
        if (this.currentUser.is_comercial && this.currentUser.cliente_representado_id) {
            return this.currentUser.cliente_representado_id;
        }
        return this.currentUser.user_id || null;
    }

    /**
     * Devuelve el almacén habitual a usar: el del cliente representado (comercial) o el del usuario.
     */
    getEffectiveAlmacenHabitual() {
        if (!this.currentUser) return null;
        if (this.currentUser.is_comercial && this.currentUser.cliente_representado_id && this.currentUser.cliente_representado_almacen_habitual != null) {
            return this.currentUser.cliente_representado_almacen_habitual;
        }
        return this.currentUser.almacen_habitual != null ? this.currentUser.almacen_habitual : null;
    }

    /**
     * Devuelve el grupo_cliente a usar: el del cliente representado (comercial) o el del usuario (ofertas, precios).
     */
    getEffectiveGrupoCliente() {
        if (!this.currentUser) return null;
        if (this.currentUser.is_comercial && this.currentUser.cliente_representado_id && this.currentUser.cliente_representado_grupo_cliente != null) {
            return this.currentUser.cliente_representado_grupo_cliente;
        }
        return this.currentUser.grupo_cliente != null ? this.currentUser.grupo_cliente : null;
    }

    /**
     * Rellena y muestra la pantalla Mi perfil (datos personales, cambiar contraseña, operarios)
     */
    async renderProfileScreen() {
        if (!this.currentUser) return;
        if (this.currentUser.is_comercial) {
            const nameEl = document.getElementById('profileUserName');
            const codeEl = document.getElementById('profileUserCode');
            if (nameEl) nameEl.textContent = this.currentUser.user_name || 'Comercial';
            if (codeEl) codeEl.textContent = 'Nº ' + (this.currentUser.comercial_numero || this.currentUser.codigo_usuario || '--');
            const passwordSection = document.getElementById('profilePasswordSection');
            const operariosSection = document.getElementById('profileOperariosSection');
            if (passwordSection) passwordSection.style.display = 'none';
            if (operariosSection) operariosSection.style.display = 'none';
            return;
        }
        const nameEl = document.getElementById('profileUserName');
        const codeEl = document.getElementById('profileUserCode');
        if (nameEl) nameEl.textContent = this.currentUser.user_name || '--';
        if (codeEl) codeEl.textContent = this.currentUser.codigo_usuario || '--';

        const passwordSection = document.getElementById('profilePasswordSection');
        if (passwordSection) {
            passwordSection.style.display = this.currentUser.is_operario ? 'none' : 'block';
        }
        const operariosSection = document.getElementById('profileOperariosSection');
        if (operariosSection) {
            operariosSection.style.display = this.currentUser.is_operario ? 'none' : 'block';
        }
        const codigoEjemplo = document.getElementById('profileOperarioCodigoEjemplo');
        if (codigoEjemplo && !this.currentUser.is_operario) {
            const codigoTitular = this.currentUser.codigo_usuario_titular || this.currentUser.codigo_usuario || '[tu codigo]';
            codigoEjemplo.textContent = codigoTitular + '-01';
        }

        const msgEl = document.getElementById('profilePasswordMessage');
        if (msgEl) {
            msgEl.style.display = 'none';
            msgEl.textContent = '';
            msgEl.className = 'profile-message';
        }
        const form = document.getElementById('profilePasswordForm');
        if (form) form.reset();

        const listEl = document.getElementById('profileOperariosList');
        const emptyEl = document.getElementById('profileOperariosEmpty');
        if (!listEl || !emptyEl) return;

        let operarios = await window.supabaseClient.getOperarios(this.currentUser.user_id);
        listEl.innerHTML = '';
        if (operarios && operarios.length > 0) {
            var seen = {};
            operarios = operarios.filter(function(op) {
                var key = (op.codigo_operario || '').trim();
                if (seen[key]) return false;
                seen[key] = true;
                return true;
            });
            emptyEl.style.display = 'none';
            listEl.style.display = 'flex';
            operarios.forEach(function(op) {
                const item = document.createElement('div');
                item.className = 'profile-operario-item';
                item.dataset.operarioId = op.id;
                const info = document.createElement('div');
                info.className = 'profile-operario-info';
                const nameDiv = document.createElement('div');
                nameDiv.className = 'profile-operario-name';
                nameDiv.textContent = op.nombre_operario || '--';
                const codeDiv = document.createElement('div');
                codeDiv.className = 'profile-operario-codigo';
                codeDiv.textContent = 'Codigo: ' + (op.codigo_operario || '');
                info.appendChild(nameDiv);
                info.appendChild(codeDiv);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'profile-operario-remove';
                btn.dataset.operarioId = op.id;
                btn.setAttribute('aria-label', 'Eliminar operario');
                btn.textContent = 'Eliminar';
                item.appendChild(info);
                item.appendChild(btn);
                listEl.appendChild(item);
            });
        } else {
            listEl.style.display = 'none';
            emptyEl.style.display = 'block';
        }
    }

    /**
     * Abre el modal de añadir operario
     */
    openProfileOperarioModal() {
        const modal = document.getElementById('profileOperarioModal');
        const msgEl = document.getElementById('profileOperarioMessage');
        const form = document.getElementById('profileOperarioForm');
        const codigoTitularEl = document.getElementById('profileOperarioCodigoTitular');
        const codigoSufijoEl = document.getElementById('profileOperarioCodigoSufijo');
        if (modal) modal.style.display = 'flex';
        if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; msgEl.className = 'profile-message'; }
        if (form) form.reset();
        if (codigoTitularEl && this.currentUser) {
            const codigoTitular = this.currentUser.codigo_usuario_titular || this.currentUser.codigo_usuario || '';
            codigoTitularEl.textContent = codigoTitular || '[tu codigo]';
        }
        if (codigoSufijoEl) codigoSufijoEl.textContent = '[codigo abajo]';
    }

    /**
     * Cierra el modal de añadir operario
     */
    closeProfileOperarioModal() {
        const modal = document.getElementById('profileOperarioModal');
        if (modal) modal.style.display = 'none';
    }

    /**
     * Abre el modal de editar alias de un cliente (solo comerciales).
     * @param {Object} cliente - Objeto cliente con id, nombre, alias
     */
    openEditAliasModal(cliente) {
        const modal = document.getElementById('editAliasClienteModal');
        const hintEl = document.getElementById('editAliasClienteNombreHint');
        const inputEl = document.getElementById('editAliasClienteInput');
        const msgEl = document.getElementById('editAliasClienteMessage');
        const form = document.getElementById('editAliasClienteForm');
        if (!modal) return;
        this._editAliasClienteActual = cliente;
        if (hintEl) hintEl.textContent = 'Cliente: ' + (cliente.nombre || '') + ' (Cod: ' + (cliente.codigo_usuario || '') + ')';
        if (inputEl) inputEl.value = cliente.alias || '';
        if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; msgEl.className = 'profile-message'; }
        if (form) {
            form.onsubmit = (e) => {
                e.preventDefault();
                this.guardarAliasCliente();
            };
        }
        modal.style.display = 'flex';
        if (inputEl) inputEl.focus();
    }

    /**
     * Cierra el modal de editar alias
     */
    closeEditAliasModal() {
        const modal = document.getElementById('editAliasClienteModal');
        if (modal) modal.style.display = 'none';
        this._editAliasClienteActual = null;
    }

    /**
     * Guarda el alias del cliente editado y refresca la lista local
     */
    async guardarAliasCliente() {
        const cliente = this._editAliasClienteActual;
        const inputEl = document.getElementById('editAliasClienteInput');
        const msgEl = document.getElementById('editAliasClienteMessage');
        const submitBtn = document.getElementById('editAliasClienteSubmit');
        if (!cliente || !inputEl) return;

        const nuevoAlias = inputEl.value.trim() || null;
        if (submitBtn) submitBtn.disabled = true;

        const resultado = await window.supabaseClient.actualizarAliasCliente(cliente.id, nuevoAlias);

        if (submitBtn) submitBtn.disabled = false;

        if (!resultado.success) {
            if (msgEl) {
                msgEl.textContent = resultado.message || 'Error al guardar el alias';
                msgEl.className = 'profile-message profile-message-error';
                msgEl.style.display = 'block';
            }
            return;
        }

        // Actualizar el objeto en la lista local para que el filtro y la vista reflejen el cambio
        if (this._clientesAsignadosComercial) {
            const idx = this._clientesAsignadosComercial.findIndex(function (c) { return c.id === cliente.id; });
            if (idx !== -1) {
                this._clientesAsignadosComercial[idx].alias = nuevoAlias;
            }
        }

        this.closeEditAliasModal();
        this._updateSelectorClienteRepresentandoBlock();
        this._applySelectorClienteFilter();
        window.ui.showToast(nuevoAlias ? ('Alias guardado: ' + nuevoAlias) : 'Alias eliminado', 'success');
    }

    /**
     * Elimina un operario y actualiza la lista en pantalla perfil
     */
    async doRemoveOperario(operarioId) {
        if (!this.currentUser || !this.currentUser.user_id) return;
        const result = await window.supabaseClient.removeOperario(this.currentUser.user_id, operarioId);
        if (result.success) {
            window.ui.showToast('Operario eliminado', 'success');
            this.renderProfileScreen();
        } else {
            window.ui.showToast(result.message || 'Error al eliminar', 'error');
        }
    }

    /**
     * Lista de conjuntos WC (Panel de Control, admin). Si refresh=true recarga desde Supabase; si false usa cache y solo reaplica filtro.
     */
    async renderWcConjuntosList(refresh = true) {
        const listEl = document.getElementById('wcConjuntosList');
        if (!listEl) return;
        try {
            if (refresh) {
                const conjuntos = await window.supabaseClient.getWcConjuntos();
                this.wcConjuntosAllForPanel = conjuntos || [];
            }
            const conjuntos = this.wcConjuntosAllForPanel || [];
            const filterInput = document.getElementById('wcConjuntosFilterNombre');
            const filterVal = (filterInput && filterInput.value || '').trim().toLowerCase();
            const filtered = filterVal
                ? conjuntos.filter(c => {
                    const nombre = (c.nombre || '').toLowerCase();
                    const codigo = (c.codigo || '').toLowerCase();
                    return nombre.includes(filterVal) || codigo.includes(filterVal);
                })
                : conjuntos;
            if (filtered.length === 0) {
                listEl.innerHTML = conjuntos.length === 0
                    ? '<p class="wc-conjuntos-empty">No hay conjuntos. Pulsa "Nuevo conjunto" para crear uno.</p>'
                    : '<p class="wc-conjuntos-empty">Ningun conjunto coincide con el filtro.</p>';
                return;
            }
            listEl.innerHTML = filtered.map(c => {
                const nombre = this.escapeForHtmlAttribute(c.nombre || '');
                const codigo = this.escapeForHtmlAttribute(c.codigo || '');
                const activo = c.activo !== false ? 'Activo' : 'Inactivo';
                const id = this.escapeForHtmlAttribute(c.id);
                return '<div class="wc-conjunto-card" data-conjunto-id="' + id + '">' +
                    '<div class="wc-conjunto-card-info">' +
                    '<strong>' + nombre + '</strong>' +
                    (codigo ? ' <span class="wc-conjunto-codigo">' + codigo + '</span>' : '') +
                    ' <span class="wc-conjunto-activo">' + activo + '</span>' +
                    '</div>' +
                    '<div class="wc-conjunto-card-actions">' +
                    '<button type="button" class="btn btn-small btn-primary wc-conjunto-edit-btn" data-conjunto-id="' + id + '">Editar</button>' +
                    '<button type="button" class="btn btn-small btn-danger wc-conjunto-delete-btn" data-conjunto-id="' + id + '">Eliminar</button>' +
                    '</div></div>';
            }).join('');
            listEl.querySelectorAll('.wc-conjunto-edit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-conjunto-id');
                    if (id) this.openWcConjuntoDetail(id);
                });
            });
            listEl.querySelectorAll('.wc-conjunto-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-conjunto-id');
                    if (id) this.handleWcConjuntoDelete(id);
                });
            });
        } catch (e) {
            console.error('Error renderWcConjuntosList:', e);
            listEl.innerHTML = '<p class="wc-conjuntos-empty wc-conjuntos-error">Error al cargar conjuntos.</p>';
        }
    }

    /**
     * Abre pantalla detalle de conjunto WC (crear si id es null, editar si id es UUID)
     */
    async openWcConjuntoDetail(id) {
        this.editingWcConjuntoId = id || null;
        this.wcConjuntoPreviewData = { taza: null, tanque: null, asiento: null };
        const titleEl = document.getElementById('wcConjuntoDetailTitle');
        const form = document.getElementById('wcConjuntoDetailForm');
        const piezasEl = document.getElementById('wcConjuntoDetailPiezas');
        if (titleEl) titleEl.textContent = id ? 'Editar conjunto' : 'Nuevo conjunto';
        if (form) form.reset();
        document.getElementById('wcConjuntoOrden').value = '0';
        document.getElementById('wcConjuntoActivo').checked = true;
        document.getElementById('wcConjuntoTipoInstalacion').value = '';
        document.getElementById('wcConjuntoAdosadoPared').checked = false;
        if (piezasEl) piezasEl.style.display = id ? 'block' : 'none';
        ['wcConjuntoPreviewTaza', 'wcConjuntoPreviewTanque', 'wcConjuntoPreviewAsiento'].forEach(pid => {
            const el = document.getElementById(pid);
            if (el) el.style.display = 'none';
        });
        if (id) {
            const conjuntos = await window.supabaseClient.getWcConjuntos();
            const c = conjuntos.find(x => x.id === id);
            if (c) {
                document.getElementById('wcConjuntoNombre').value = c.nombre || '';
                document.getElementById('wcConjuntoCodigo').value = c.codigo || '';
                document.getElementById('wcConjuntoDescripcion').value = c.descripcion || '';
                document.getElementById('wcConjuntoOrden').value = (c.orden != null ? c.orden : 0);
                document.getElementById('wcConjuntoActivo').checked = c.activo !== false;
                document.getElementById('wcConjuntoTipoInstalacion').value = c.tipo_instalacion || '';
                document.getElementById('wcConjuntoAdosadoPared').checked = c.adosado_pared === true;
            }
            await this.renderWcConjuntoDetailPiezas();
        }
        this.showScreen('wcConjuntoDetail');
    }

    /**
     * Rellena las listas de tazas, tanques y asientos del conjunto en edicion (con codigo y descripcion)
     */
    async renderWcConjuntoDetailPiezas() {
        const id = this.editingWcConjuntoId;
        if (!id) return;
        const listTazas = document.getElementById('wcConjuntoTazasList');
        const listTanques = document.getElementById('wcConjuntoTanquesList');
        const listAsientos = document.getElementById('wcConjuntoAsientosList');
        try {
            const [tazas, tanques, asientos] = await Promise.all([
                window.supabaseClient.getWcConjuntoTazas(id),
                window.supabaseClient.getWcConjuntoTanques(id),
                window.supabaseClient.getWcConjuntoAsientos(id)
            ]);
            const renderList = async (listEl, items, tipo) => {
                if (!listEl) return;
                if (!items || items.length === 0) {
                    listEl.innerHTML = '';
                    return;
                }
                const lines = [];
                for (const item of items) {
                    const cod = item.producto_codigo || '';
                    const product = await window.cartManager.getProductByCodigo(cod);
                    const desc = (product && product.descripcion) ? product.descripcion : cod;
                    const codigoEsc = this.escapeForHtmlAttribute(cod);
                    const descEsc = this.escapeForHtmlAttribute(desc);
                    const itemId = this.escapeForHtmlAttribute(item.id);
                    lines.push('<li class="wc-piezas-item">' +
                        '<span class="wc-piezas-item-text"><strong>' + codigoEsc + '</strong> – ' + descEsc + '</span>' +
                        '<button type="button" class="btn btn-small btn-danger" data-wc-remove-pieza="' + tipo + '" data-wc-pieza-id="' + itemId + '">Quitar</button>' +
                        '</li>');
                }
                listEl.innerHTML = lines.join('');
            };
            await renderList(listTazas, tazas, 'taza');
            await renderList(listTanques, tanques, 'tanque');
            await renderList(listAsientos, asientos, 'asiento');
        } catch (e) {
            console.error('Error renderWcConjuntoDetailPiezas:', e);
        }
    }

    /**
     * Guarda el conjunto WC (crear o actualizar) y muestra seccion piezas si es nuevo
     */
    async handleWcConjuntoDetailSave() {
        const nombre = (document.getElementById('wcConjuntoNombre') && document.getElementById('wcConjuntoNombre').value || '').trim();
        if (!nombre) {
            window.ui.showToast('El nombre es obligatorio', 'error');
            return;
        }
        const codigo = (document.getElementById('wcConjuntoCodigo') && document.getElementById('wcConjuntoCodigo').value || '').trim() || null;
        const descripcion = (document.getElementById('wcConjuntoDescripcion') && document.getElementById('wcConjuntoDescripcion').value || '').trim() || null;
        const ordenInput = document.getElementById('wcConjuntoOrden');
        const orden = ordenInput ? parseInt(ordenInput.value, 10) : 0;
        const activo = document.getElementById('wcConjuntoActivo') ? document.getElementById('wcConjuntoActivo').checked : true;
        const tipoInstalacionEl = document.getElementById('wcConjuntoTipoInstalacion');
        const tipoInstalacion = (tipoInstalacionEl && tipoInstalacionEl.value) ? tipoInstalacionEl.value.trim() : null;
        const adosadoPared = document.getElementById('wcConjuntoAdosadoPared') ? document.getElementById('wcConjuntoAdosadoPared').checked : false;
        try {
            if (this.editingWcConjuntoId) {
                await window.supabaseClient.updateWcConjunto(this.editingWcConjuntoId, { nombre, codigo, descripcion, orden, activo, tipo_instalacion: tipoInstalacion, adosado_pared: adosadoPared });
                window.ui.showToast('Conjunto actualizado', 'success');
            } else {
                const created = await window.supabaseClient.createWcConjunto({ nombre, codigo, descripcion, orden, activo, tipo_instalacion: tipoInstalacion, adosado_pared: adosadoPared });
                window.ui.showToast('Conjunto creado', 'success');
                this.editingWcConjuntoId = created.id;
                const piezasEl = document.getElementById('wcConjuntoDetailPiezas');
                if (piezasEl) piezasEl.style.display = 'block';
                await this.renderWcConjuntoDetailPiezas();
            }
        } catch (e) {
            console.error('Error handleWcConjuntoDetailSave:', e);
            window.ui.showToast('Error: ' + (e.message || 'no se pudo guardar'), 'error');
        }
    }

    /**
     * Comprueba si la imagen del conjunto esta subida (ruta assets/wc-conjuntos/{codigo}.jpg)
     */
    handleWcConjuntoComprobarImagen() {
        const codigoInput = document.getElementById('wcConjuntoCodigo');
        const resultEl = document.getElementById('wcConjuntoImagenCheckResult');
        const codigo = (codigoInput && codigoInput.value || '').trim();
        if (!resultEl) return;
        if (!codigo) {
            resultEl.innerHTML = '<span class="wc-conjunto-imagen-check-msg wc-conjunto-imagen-check-error">Indica el codigo del conjunto (ej. wc_carmen_roca) para comprobar la imagen.</span>';
            return;
        }
        const base = this._wcConjuntoImageBase();
        const imageUrl = base + codigo + '.jpg';
        resultEl.innerHTML = '<span class="wc-conjunto-imagen-check-msg wc-conjunto-imagen-check-loading">Comprobando...</span>';
        const img = new Image();
        img.onload = () => {
            resultEl.innerHTML =
                '<span class="wc-conjunto-imagen-check-msg wc-conjunto-imagen-check-ok">Imagen encontrada.</span>' +
                '<img src="' + this.escapeForHtmlAttribute(imageUrl) + '" alt="" class="wc-conjunto-imagen-check-preview">';
        };
        img.onerror = () => {
            resultEl.innerHTML = '<span class="wc-conjunto-imagen-check-msg wc-conjunto-imagen-check-error">Imagen no encontrada. Ruta: ' + this.escapeForHtmlAttribute(imageUrl) + '</span>';
        };
        img.src = imageUrl;
    }

    /**
     * Busca por codigo o codigo secundario y muestra vista previa (codigo + descripcion) antes de anadir
     */
    async handleWcConjuntoBuscarPieza(tipo) {
        const inputId = tipo === 'taza' ? 'wcConjuntoAddTaza' : (tipo === 'tanque' ? 'wcConjuntoAddTanque' : 'wcConjuntoAddAsiento');
        const previewId = tipo === 'taza' ? 'wcConjuntoPreviewTaza' : (tipo === 'tanque' ? 'wcConjuntoPreviewTanque' : 'wcConjuntoPreviewAsiento');
        const previewTextId = previewId + 'Text';
        const input = document.getElementById(inputId);
        const previewEl = document.getElementById(previewId);
        const previewTextEl = document.getElementById(previewTextId);
        const codigoInput = (input && input.value || '').trim();
        if (!codigoInput) {
            window.ui.showToast('Escribe codigo de producto o codigo secundario', 'error');
            return;
        }
        const details = await window.cartManager.resolveToPrincipalCodeWithDetails(codigoInput);
        if (!details) {
            window.ui.showToast('Codigo no encontrado. Usa codigo principal o codigo secundario del catalogo.', 'error');
            if (previewEl) previewEl.style.display = 'none';
            this.wcConjuntoPreviewData[tipo] = null;
            return;
        }
        this.wcConjuntoPreviewData[tipo] = details;
        const texto = details.principalCode + ' – ' + details.descripcion + (details.matchedSecondary ? ' (' + details.matchedSecondary + ')' : '');
        if (previewTextEl) previewTextEl.textContent = texto;
        if (previewEl) previewEl.style.display = 'block';
    }

    /**
     * Anade la pieza mostrada en la vista previa al conjunto (tras haber buscado)
     */
    async handleWcConjuntoConfirmAddPieza(tipo) {
        const id = this.editingWcConjuntoId;
        if (!id) {
            window.ui.showToast('Guarda primero el conjunto', 'error');
            return;
        }
        const details = this.wcConjuntoPreviewData && this.wcConjuntoPreviewData[tipo];
        if (!details || !details.principalCode) {
            window.ui.showToast('Busca antes un producto para anadir', 'error');
            return;
        }
        const inputId = tipo === 'taza' ? 'wcConjuntoAddTaza' : (tipo === 'tanque' ? 'wcConjuntoAddTanque' : 'wcConjuntoAddAsiento');
        const previewId = tipo === 'taza' ? 'wcConjuntoPreviewTaza' : (tipo === 'tanque' ? 'wcConjuntoPreviewTanque' : 'wcConjuntoPreviewAsiento');
        try {
            if (tipo === 'taza') await window.supabaseClient.addWcConjuntoTaza(id, details.principalCode);
            else if (tipo === 'tanque') await window.supabaseClient.addWcConjuntoTanque(id, details.principalCode);
            else await window.supabaseClient.addWcConjuntoAsiento(id, details.principalCode);
            this.wcConjuntoPreviewData[tipo] = null;
            const input = document.getElementById(inputId);
            if (input) input.value = '';
            const previewEl = document.getElementById(previewId);
            if (previewEl) previewEl.style.display = 'none';
            await this.renderWcConjuntoDetailPiezas();
            const descCorta = details.descripcion ? (details.descripcion.length > 45 ? details.descripcion.substring(0, 45) + '...' : details.descripcion) : '';
            window.ui.showToast('Anadido: ' + details.principalCode + (descCorta ? ' – ' + descCorta : ''), 'success');
        } catch (e) {
            console.error('Error handleWcConjuntoConfirmAddPieza:', e);
            window.ui.showToast('Error: ' + (e.message || 'no se pudo anadir (¿codigo duplicado?)'), 'error');
        }
    }

    /**
     * Elimina una pieza (taza, tanque o asiento) del conjunto
     */
    async handleWcConjuntoRemovePieza(tipo, piezaId) {
        try {
            if (tipo === 'taza') await window.supabaseClient.removeWcConjuntoTaza(piezaId);
            else if (tipo === 'tanque') await window.supabaseClient.removeWcConjuntoTanque(piezaId);
            else await window.supabaseClient.removeWcConjuntoAsiento(piezaId);
            this.renderWcConjuntoDetailPiezas();
            window.ui.showToast('Quitado', 'success');
        } catch (e) {
            console.error('Error handleWcConjuntoRemovePieza:', e);
            window.ui.showToast('Error al quitar', 'error');
        }
    }

    /**
     * Elimina un conjunto WC tras confirmar
     */
    async handleWcConjuntoDelete(conjuntoId) {
        if (!confirm('Eliminar este conjunto? Se borraran tambien sus tazas, tanques y asientos.')) return;
        try {
            await window.supabaseClient.deleteWcConjunto(conjuntoId);
            window.ui.showToast('Conjunto eliminado', 'success');
            this.renderWcConjuntosList();
        } catch (e) {
            console.error('Error handleWcConjuntoDelete:', e);
            window.ui.showToast('Error: ' + (e.message || 'no se pudo eliminar'), 'error');
        }
    }

    // --- Recambios (Panel de Control) ---

    /**
     * Resetea y muestra pantalla Recambios (sin producto seleccionado)
     */
    initRecambiosScreen() {
        this.recambiosProductoCodigo = null;
        this.recambiosPreviewRecambio = null;
        this.recambiosPreviewPadre = null;
        const input = document.getElementById('recambiosProductoInput');
        const actualEl = document.getElementById('recambiosProductoActual');
        const contenidoEl = document.getElementById('recambiosContenido');
        const previewRecambio = document.getElementById('recambiosPreviewRecambio');
        const previewPadre = document.getElementById('recambiosPreviewPadre');
        if (input) input.value = '';
        if (actualEl) actualEl.style.display = 'none';
        if (contenidoEl) contenidoEl.style.display = 'none';
        if (previewRecambio) previewRecambio.style.display = 'none';
        if (previewPadre) previewPadre.style.display = 'none';
    }

    /**
     * Busca producto por codigo/secundario y lo selecciona para gestionar recambios
     */
    async handleRecambiosBuscarProducto() {
        const input = document.getElementById('recambiosProductoInput');
        const codigoInput = (input && input.value || '').trim();
        if (!codigoInput) {
            window.ui.showToast('Escribe codigo de producto o codigo secundario', 'error');
            return;
        }
        const details = await window.cartManager.resolveToPrincipalCodeWithDetails(codigoInput);
        if (!details) {
            window.ui.showToast('Codigo no encontrado. Usa codigo principal o codigo secundario del catalogo.', 'error');
            return;
        }
        this.recambiosProductoCodigo = details.principalCode;
        const actualEl = document.getElementById('recambiosProductoActual');
        const textEl = document.getElementById('recambiosProductoActualText');
        const contenidoEl = document.getElementById('recambiosContenido');
        if (textEl) {
            textEl.textContent = details.principalCode + ' – ' + details.descripcion + (details.matchedSecondary ? ' (' + details.matchedSecondary + ')' : '');
        }
        if (actualEl) actualEl.style.display = 'block';
        if (contenidoEl) contenidoEl.style.display = 'block';
        this.recambiosPreviewRecambio = null;
        this.recambiosPreviewPadre = null;
        const previewRecambio = document.getElementById('recambiosPreviewRecambio');
        const previewPadre = document.getElementById('recambiosPreviewPadre');
        if (previewRecambio) previewRecambio.style.display = 'none';
        if (previewPadre) previewPadre.style.display = 'none';
        document.getElementById('recambiosAddRecambioInput').value = '';
        document.getElementById('recambiosAddPadreInput').value = '';
        await this.renderRecambiosLists();
    }

    /**
     * Rellena las listas "Este producto tiene estos recambios" y "Este producto es recambio de"
     */
    async renderRecambiosLists() {
        const codigo = this.recambiosProductoCodigo;
        if (!codigo) return;
        const listRecambios = document.getElementById('recambiosList');
        const listPadres = document.getElementById('recambiosPadresList');
        try {
            const [recambios, padres] = await Promise.all([
                window.supabaseClient.getRecambiosDeProducto(codigo),
                window.supabaseClient.getPadresDeRecambio(codigo)
            ]);
            const renderList = async (listEl, items, codigoKey) => {
                if (!listEl) return;
                if (!items || items.length === 0) {
                    listEl.innerHTML = '';
                    return;
                }
                const lines = [];
                for (const item of items) {
                    const cod = item[codigoKey] || '';
                    const product = await window.cartManager.getProductByCodigo(cod);
                    const desc = (product && product.descripcion) ? product.descripcion : cod;
                    const codigoEsc = this.escapeForHtmlAttribute(cod);
                    const descEsc = this.escapeForHtmlAttribute(desc);
                    const itemId = this.escapeForHtmlAttribute(item.id);
                    lines.push('<li class="wc-piezas-item">' +
                        '<span class="wc-piezas-item-text"><strong>' + codigoEsc + '</strong> – ' + descEsc + '</span>' +
                        '<button type="button" class="btn btn-small btn-danger" data-recambio-remove-id="' + itemId + '">Quitar</button>' +
                        '</li>');
                }
                listEl.innerHTML = lines.join('');
            };
            await renderList(listRecambios, recambios || [], 'producto_recambio_codigo');
            await renderList(listPadres, padres || [], 'producto_padre_codigo');
        } catch (e) {
            console.error('Error renderRecambiosLists:', e);
            if (listRecambios) listRecambios.innerHTML = '<li class="wc-piezas-error">Error al cargar.</li>';
            if (listPadres) listPadres.innerHTML = '<li class="wc-piezas-error">Error al cargar.</li>';
        }
    }

    /**
     * Busca recambio (hijo) y muestra vista previa para anadir a "Este producto tiene estos recambios"
     */
    async handleRecambiosBuscarRecambio() {
        const input = document.getElementById('recambiosAddRecambioInput');
        const codigoInput = (input && input.value || '').trim();
        if (!codigoInput) {
            window.ui.showToast('Escribe codigo del recambio', 'error');
            return;
        }
        const details = await window.cartManager.resolveToPrincipalCodeWithDetails(codigoInput);
        if (!details) {
            window.ui.showToast('Codigo no encontrado', 'error');
            return;
        }
        this.recambiosPreviewRecambio = details;
        const previewEl = document.getElementById('recambiosPreviewRecambio');
        const textEl = document.getElementById('recambiosPreviewRecambioText');
        if (textEl) textEl.textContent = details.principalCode + ' – ' + details.descripcion + (details.matchedSecondary ? ' (' + details.matchedSecondary + ')' : '');
        if (previewEl) previewEl.style.display = 'block';
    }

    /**
     * Confirma anadir el recambio mostrado en vista previa (como hijo del producto actual)
     */
    async handleRecambiosConfirmAddRecambio() {
        const codigo = this.recambiosProductoCodigo;
        const details = this.recambiosPreviewRecambio;
        if (!codigo || !details || !details.principalCode) {
            window.ui.showToast('Busca primero un recambio para anadir', 'error');
            return;
        }
        if (details.principalCode === codigo) {
            window.ui.showToast('Un producto no puede ser recambio de si mismo', 'error');
            return;
        }
        try {
            await window.supabaseClient.addRecambio(codigo, details.principalCode);
            this.recambiosPreviewRecambio = null;
            document.getElementById('recambiosPreviewRecambio').style.display = 'none';
            document.getElementById('recambiosAddRecambioInput').value = '';
            await this.renderRecambiosLists();
            window.ui.showToast('Recambio anadido', 'success');
        } catch (e) {
            console.error('Error handleRecambiosConfirmAddRecambio:', e);
            window.ui.showToast('Error: ' + (e.message || 'no se pudo anadir (¿duplicado?)'), 'error');
        }
    }

    /**
     * Busca producto padre y muestra vista previa para anadir a "Este producto es recambio de"
     */
    async handleRecambiosBuscarPadre() {
        const input = document.getElementById('recambiosAddPadreInput');
        const codigoInput = (input && input.value || '').trim();
        if (!codigoInput) {
            window.ui.showToast('Escribe codigo del producto padre', 'error');
            return;
        }
        const details = await window.cartManager.resolveToPrincipalCodeWithDetails(codigoInput);
        if (!details) {
            window.ui.showToast('Codigo no encontrado', 'error');
            return;
        }
        this.recambiosPreviewPadre = details;
        const previewEl = document.getElementById('recambiosPreviewPadre');
        const textEl = document.getElementById('recambiosPreviewPadreText');
        if (textEl) textEl.textContent = details.principalCode + ' – ' + details.descripcion + (details.matchedSecondary ? ' (' + details.matchedSecondary + ')' : '');
        if (previewEl) previewEl.style.display = 'block';
    }

    /**
     * Confirma anadir el padre mostrado en vista previa (el producto actual sera recambio de ese padre)
     */
    async handleRecambiosConfirmAddPadre() {
        const codigo = this.recambiosProductoCodigo;
        const details = this.recambiosPreviewPadre;
        if (!codigo || !details || !details.principalCode) {
            window.ui.showToast('Busca primero un producto padre para anadir', 'error');
            return;
        }
        if (details.principalCode === codigo) {
            window.ui.showToast('Un producto no puede ser recambio de si mismo', 'error');
            return;
        }
        try {
            await window.supabaseClient.addRecambio(details.principalCode, codigo);
            this.recambiosPreviewPadre = null;
            document.getElementById('recambiosPreviewPadre').style.display = 'none';
            document.getElementById('recambiosAddPadreInput').value = '';
            await this.renderRecambiosLists();
            window.ui.showToast('Producto padre anadido', 'success');
        } catch (e) {
            console.error('Error handleRecambiosConfirmAddPadre:', e);
            window.ui.showToast('Error: ' + (e.message || 'no se pudo anadir (¿duplicado?)'), 'error');
        }
    }

    /**
     * Elimina una relacion recambio por id (desde lista de recambios o lista de padres)
     */
    async handleRecambiosRemove(recambioId) {
        try {
            await window.supabaseClient.removeRecambio(recambioId);
            await this.renderRecambiosLists();
            window.ui.showToast('Quitado', 'success');
        } catch (e) {
            console.error('Error handleRecambiosRemove:', e);
            window.ui.showToast('Error al quitar', 'error');
        }
    }

    /**
     * Vista Recambios (cliente): pantalla de consulta desde Herramientas
     */
    initRecambiosVistaScreen() {
        this.recambiosVistaProductoCodigo = null;
        this.recambiosVistaMode = null;
        const productoActualEl = document.getElementById('recambiosVistaProductoActual');
        const contenidoEl = document.getElementById('recambiosVistaContenido');
        if (productoActualEl) productoActualEl.style.display = 'none';
        if (contenidoEl) contenidoEl.style.display = 'none';
    }

    /**
     * Abre la pagina de recambios desde el overlay de detalle de producto (Ver Recambios o Sirve para estos productos)
     * @param {Object} producto - { codigo, descripcion, pvp }
     * @param {string} mode - 'recambios' (muestra recambios de este producto) o 'sirvePara' (muestra productos para los que sirve)
     */
    openRecambiosVistaPage(producto, mode) {
        this.recambiosVistaProductoCodigo = producto.codigo;
        this.recambiosVistaMode = mode;
        this.showScreen('recambiosVista');
    }

    /**
     * Rellena la pagina de recambios: producto actual + grid de articulos (recambios o padres segun modo)
     */
    async renderRecambiosVistaPageFromProduct() {
        const codigo = this.recambiosVistaProductoCodigo;
        const mode = this.recambiosVistaMode;
        if (!codigo || !mode) return;
        const titleEl = document.getElementById('recambiosVistaTitle');
        const productoActualEl = document.getElementById('recambiosVistaProductoActual');
        const productCardEl = document.getElementById('recambiosVistaProductoCard');
        const contenidoEl = document.getElementById('recambiosVistaContenido');
        const sectionTitleEl = document.getElementById('recambiosVistaSectionTitle');
        const sectionDescEl = document.getElementById('recambiosVistaSectionDesc');
        const gridEl = document.getElementById('recambiosVistaGrid');

        if (titleEl) {
            titleEl.textContent = mode === 'recambios' ? 'Recambios de este producto' : 'Sirve para estos productos';
        }
        if (sectionTitleEl) {
            sectionTitleEl.textContent = mode === 'recambios' ? 'Articulos que son recambio de este producto' : 'Productos que puedes reparar o completar con este articulo';
        }
        if (sectionDescEl) {
            sectionDescEl.textContent = mode === 'recambios' ? 'Pulsa en un articulo para anadirlo al carrito.' : 'Pulsa en un producto para anadirlo al carrito.';
        }

        const p = await window.cartManager.getProductByCodigo(codigo);
        const desc = (p && p.descripcion) ? p.descripcion : codigo;
        const base = this._wcProductImageBase();
        const imgUrl = base + this.escapeForHtmlAttribute(codigo) + '_1.JPG';
        const codEsc = this.escapeForHtmlAttribute(codigo);
        const descEsc = this.escapeForHtmlAttribute(desc);
        if (productCardEl) {
            productCardEl.innerHTML = '<div class="recambios-vista-card-img-wrap">' +
                '<img src="' + imgUrl + '" alt="" class="recambios-vista-card-img" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';"><span class="recambios-vista-card-placeholder" style="display:none;" aria-hidden="true"></span>' +
                '</div>' +
                '<div class="recambios-vista-card-body">' +
                '<p class="recambios-vista-producto-text"><strong>' + codEsc + '</strong></p>' +
                '<p class="recambios-vista-producto-desc">' + descEsc + '</p>' +
                '</div>';
        }
        if (productoActualEl) productoActualEl.style.display = 'block';
        if (contenidoEl) contenidoEl.style.display = 'block';

        const codigoKey = mode === 'recambios' ? 'producto_recambio_codigo' : 'producto_padre_codigo';
        let items = [];
        try {
            items = mode === 'recambios'
                ? (await window.supabaseClient.getRecambiosDeProducto(codigo)) || []
                : (await window.supabaseClient.getPadresDeRecambio(codigo)) || [];
        } catch (e) {
            console.error('Error cargando recambios/padres:', e);
        }

        if (!gridEl) return;
        if (!items || items.length === 0) {
            gridEl.innerHTML = '<p class="recambios-vista-empty-grid">Ninguno</p>';
            return;
        }
        const cards = [];
        for (const item of items) {
            const cod = item[codigoKey] || '';
            const prod = await window.cartManager.getProductByCodigo(cod);
            const descItem = (prod && prod.descripcion) ? prod.descripcion : cod;
            const pvp = (prod && prod.pvp != null) ? prod.pvp : 0;
            const codEscItem = this.escapeForHtmlAttribute(cod);
            const descEscItem = this.escapeForHtmlAttribute(descItem);
            const imgUrlItem = base + codEscItem + '_1.JPG';
            const priceStr = (pvp * 1.21).toFixed(2);
            cards.push('<button type="button" class="recambios-vista-card" data-codigo="' + codEscItem + '" data-descripcion="' + descEscItem + '" data-pvp="' + pvp + '" aria-label="' + descEscItem + '">' +
                '<span class="recambios-vista-card-img-wrap">' +
                '<img src="' + imgUrlItem + '" alt="" class="recambios-vista-card-img" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';"><span class="recambios-vista-card-placeholder" style="display:none;" aria-hidden="true"></span>' +
                '</span>' +
                '<span class="recambios-vista-card-desc">' + descEscItem + '</span>' +
                '<span class="recambios-vista-card-code">' + codEscItem + '</span>' +
                '<span class="recambios-vista-card-price">' + priceStr + ' EUR</span>' +
                '</button>');
        }
        gridEl.innerHTML = cards.join('');
    }

    /** Base URL imagenes productos (WC Completo y busqueda) */
    _wcProductImageBase() {
        return 'https://www.saneamiento-martinez.com/imagenes/articulos/';
    }

    /** Base URL imagenes conjuntos WC (GitHub raw; mismo repo que la app para que funcione al comprobar y en Herramientas) */
    _wcConjuntoImageBase() {
        return 'https://raw.githubusercontent.com/GuillePrograma94/RQC2/main/assets/wc-conjuntos/';
    }

    /**
     * Pantalla WC Completo: carga conjuntos activos como cards (con filtros y grid de 2 columnas)
     */
    async renderWcCompletoScreen() {
        this.wcCompletoSelection = { conjuntoId: null, taza: null, tanque: null, asiento: null };
        this.wcCompletoConjuntosAll = [];
        const gridConjuntos = document.getElementById('wcCompletoConjuntosGrid');
        const gridTazas = document.getElementById('wcCompletoTazasGrid');
        const gridTanques = document.getElementById('wcCompletoTanquesGrid');
        const gridAsientos = document.getElementById('wcCompletoAsientosGrid');
        if (!gridConjuntos) return;
        try {
            const conjuntos = await window.supabaseClient.getWcConjuntos();
            this.wcCompletoConjuntosAll = (conjuntos || []).filter(c => c.activo !== false);
            this.renderWcCompletoConjuntosGrid();
            gridTazas.innerHTML = '';
            gridTanques.innerHTML = '';
            gridAsientos.innerHTML = '';
            document.getElementById('wcCompletoStepTaza').classList.add('wc-completo-step-locked');
            document.getElementById('wcCompletoStepTanque').classList.add('wc-completo-step-locked');
            document.getElementById('wcCompletoStepAsiento').classList.add('wc-completo-step-locked');
            this.renderWcCompletoSummary();
            document.getElementById('wcCompletoAddBtn').disabled = true;
        } catch (e) {
            console.error('Error renderWcCompletoScreen:', e);
            gridConjuntos.innerHTML = '<p class="wc-completo-empty">Error al cargar conjuntos.</p>';
        }
    }

    /**
     * Devuelve el data-value del chip seleccionado en una fila de chips WC Completo
     * @param {string} containerId - id del contenedor (wcCompletoChipsTipo o wcCompletoChipsAdosado)
     * @returns {string}
     */
    _getWcCompletoChipValue(containerId) {
        const row = document.getElementById(containerId);
        if (!row) return '';
        const selected = row.querySelector('.wc-completo-chip.selected');
        return selected ? (selected.getAttribute('data-value') || '') : '';
    }

    /**
     * Filtra conjuntos por tipo instalacion, adosado a pared y nombre; rellena el grid de modelos (paso 1)
     */
    renderWcCompletoConjuntosGrid() {
        const gridConjuntos = document.getElementById('wcCompletoConjuntosGrid');
        if (!gridConjuntos || !this.wcCompletoConjuntosAll) return;
        const tipoVal = this._getWcCompletoChipValue('wcCompletoChipsTipo');
        const adosadoVal = this._getWcCompletoChipValue('wcCompletoChipsAdosado');
        const nombreVal = (document.getElementById('wcCompletoFilterNombre') && document.getElementById('wcCompletoFilterNombre').value || '').trim().toLowerCase();
        let list = this.wcCompletoConjuntosAll;
        if (tipoVal) list = list.filter(c => c.tipo_instalacion === tipoVal);
        if (adosadoVal !== '') list = list.filter(c => (adosadoVal === 'true') === (c.adosado_pared === true));
        if (nombreVal) list = list.filter(c => {
            const nombre = (c.nombre || '').toLowerCase();
            const codigo = (c.codigo || '').toLowerCase();
            const desc = (c.descripcion || '').toLowerCase();
            return nombre.includes(nombreVal) || codigo.includes(nombreVal) || desc.includes(nombreVal);
        });
        if (list.length === 0) {
            gridConjuntos.innerHTML = '<p class="wc-completo-empty">Ningun conjunto coincide con los filtros.</p>';
            return;
        }
        gridConjuntos.innerHTML = list.map(c => {
            const id = this.escapeForHtmlAttribute(c.id);
            const nombre = this.escapeForHtmlAttribute(c.nombre || '');
            const desc = this.escapeForHtmlAttribute((c.descripcion || '').substring(0, 80));
            const imageFilename = (c.codigo || c.id || '').toString().trim() || id;
            const imageUrl = this._wcConjuntoImageBase() + this.escapeForHtmlAttribute(imageFilename) + '.jpg';
            return '<button type="button" class="wc-completo-card wc-completo-card-conjunto" data-conjunto-id="' + id + '" aria-label="Elegir ' + nombre + '">' +
                '<span class="wc-completo-card-conjunto-img-wrap">' +
                '<img src="' + imageUrl + '" alt="" class="wc-completo-card-conjunto-img" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'">' +
                '<span class="wc-completo-card-conjunto-icon" style="display:none;" aria-hidden="true"></span>' +
                '</span>' +
                '<span class="wc-completo-card-conjunto-name">' + nombre + '</span>' +
                (desc ? '<span class="wc-completo-card-conjunto-desc">' + desc + (c.descripcion && c.descripcion.length > 80 ? '...' : '') + '</span>' : '') +
                '</button>';
        }).join('');
    }

    /**
     * Enriquecer lista de codigos con datos de producto (descripcion, pvp) e imagen
     */
    async enrichWcProductos(codigos) {
        if (!codigos || codigos.length === 0) return [];
        const base = this._wcProductImageBase();
        const out = [];
        for (const it of codigos) {
            const cod = (it.producto_codigo || it.codigo || it).toString().trim();
            const p = await window.cartManager.getProductByCodigo(cod);
            out.push({
                codigo: cod,
                descripcion: (p && p.descripcion) ? p.descripcion : cod,
                pvp: (p && p.pvp != null) ? p.pvp : 0,
                imageUrl: base + cod + '_1.JPG'
            });
        }
        return out;
    }

    /**
     * Cierra el overlay de detalle de producto (si esta abierto), muestra WC Completo y preselecciona el conjunto.
     * Se usa desde los labels "Parte de conjunto completo" en el detalle de producto.
     * @param {string} conjuntoId - id del conjunto (wc_conjuntos.id)
     */
    async openWcCompletoWithConjunto(conjuntoId) {
        if (!conjuntoId) return;
        this.showScreen('wcCompleto');
        await this.renderWcCompletoScreen();
        await this.onWcCompletoConjuntoSelect(conjuntoId);
    }

    /**
     * Al elegir un conjunto: cargar tazas, tanques, asientos enriquecidos y mostrar como cards
     */
    async onWcCompletoConjuntoSelect(conjuntoId) {
        if (!conjuntoId) return;
        this.wcCompletoSelection = { conjuntoId: conjuntoId, taza: null, tanque: null, asiento: null };
        document.querySelectorAll('.wc-completo-card-conjunto').forEach(el => el.classList.remove('selected'));
        const selectedCard = document.querySelector('.wc-completo-card-conjunto[data-conjunto-id="' + this.escapeForHtmlAttribute(conjuntoId) + '"]');
        if (selectedCard) selectedCard.classList.add('selected');
        document.getElementById('wcCompletoStepTaza').classList.remove('wc-completo-step-locked');
        document.getElementById('wcCompletoStepTanque').classList.remove('wc-completo-step-locked');
        document.getElementById('wcCompletoStepAsiento').classList.remove('wc-completo-step-locked');
        const stepTaza = document.getElementById('wcCompletoStepTaza');
        if (stepTaza) {
            requestAnimationFrame(() => {
                stepTaza.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
        const gridTazas = document.getElementById('wcCompletoTazasGrid');
        const gridTanques = document.getElementById('wcCompletoTanquesGrid');
        const gridAsientos = document.getElementById('wcCompletoAsientosGrid');
        gridTazas.innerHTML = '<p class="wc-completo-loading">Cargando opciones...</p>';
        gridTanques.innerHTML = '<p class="wc-completo-loading">Cargando opciones...</p>';
        gridAsientos.innerHTML = '<p class="wc-completo-loading">Cargando opciones...</p>';
        try {
            const [tazasRaw, tanquesRaw, asientosRaw] = await Promise.all([
                window.supabaseClient.getWcConjuntoTazas(conjuntoId),
                window.supabaseClient.getWcConjuntoTanques(conjuntoId),
                window.supabaseClient.getWcConjuntoAsientos(conjuntoId)
            ]);
            const [tazas, tanques, asientos] = await Promise.all([
                this.enrichWcProductos(tazasRaw || []),
                this.enrichWcProductos(tanquesRaw || []),
                this.enrichWcProductos(asientosRaw || [])
            ]);
            gridTazas.innerHTML = this.renderWcProductCards(tazas, 'taza');
            gridTanques.innerHTML = this.renderWcProductCards(tanques, 'tanque');
            gridAsientos.innerHTML = this.renderWcProductCards(asientos, 'asiento');
            if (tazas.length === 1) this.onWcCompletoProductSelect('taza', tazas[0].codigo);
            if (tanques.length === 1) this.onWcCompletoProductSelect('tanque', tanques[0].codigo);
            if (asientos.length === 1) this.onWcCompletoProductSelect('asiento', asientos[0].codigo);
            this.renderWcCompletoSummary();
        } catch (e) {
            console.error('Error onWcCompletoConjuntoSelect:', e);
            gridTazas.innerHTML = gridTanques.innerHTML = gridAsientos.innerHTML = '<p class="wc-completo-empty">Error al cargar.</p>';
            this.renderWcCompletoSummary();
        }
    }

    /**
     * Renderiza cards de producto (taza/tanque/asiento) con imagen, descripcion y precio
     */
    renderWcProductCards(items, tipo) {
        if (!items || items.length === 0) return '<p class="wc-completo-empty">No hay opciones.</p>';
        const codAttr = (c) => this.escapeForHtmlAttribute(c);
        return items.map(item => {
            const cod = codAttr(item.codigo);
            const desc = this.escapeForHtmlAttribute(item.descripcion || '');
            const price = (item.pvp != null ? Number(item.pvp) : 0).toFixed(2);
            const img = item.imageUrl || this._wcProductImageBase() + cod + '_1.JPG';
            return '<button type="button" class="wc-completo-card wc-completo-card-product" data-tipo="' + tipo + '" data-codigo="' + cod + '" data-descripcion="' + this.escapeForHtmlAttribute(item.descripcion || '') + '" data-pvp="' + (item.pvp != null ? item.pvp : 0) + '" aria-label="' + this.escapeForHtmlAttribute(item.descripcion || item.codigo) + '">' +
                '<span class="wc-completo-card-product-img-wrap">' +
                '<img src="' + this.escapeForHtmlAttribute(img) + '" alt="" class="wc-completo-card-product-img" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';"><span class="wc-completo-card-product-placeholder" style="display:none;" aria-hidden="true"></span>' +
                '</span>' +
                '<span class="wc-completo-card-product-desc">' + desc + '</span>' +
                '<span class="wc-completo-card-product-price">' + price + ' EUR</span>' +
                '</button>';
        }).join('');
    }

    /**
     * Al elegir una pieza (taza, tanque o asiento): guardar seleccion, marcar card y actualizar resumen
     */
    onWcCompletoProductSelect(tipo, codigo) {
        if (!this.wcCompletoSelection || !codigo) return;
        const grid = document.getElementById('wcCompleto' + (tipo === 'taza' ? 'Tazas' : tipo === 'tanque' ? 'Tanques' : 'Asientos') + 'Grid');
        const card = grid && grid.querySelector('.wc-completo-card-product[data-codigo="' + this.escapeForHtmlAttribute(codigo) + '"]');
        if (card) {
            grid.querySelectorAll('.wc-completo-card-product').forEach(el => el.classList.remove('selected'));
            card.classList.add('selected');
        }
        const pvp = card ? parseFloat(card.getAttribute('data-pvp')) : 0;
        const descripcion = card ? (card.getAttribute('data-descripcion') || codigo) : codigo;
        this.wcCompletoSelection[tipo] = { codigo: codigo, descripcion: descripcion, pvp: pvp };
        this.renderWcCompletoSummary();
    }

    /**
     * Rellena el resumen (miniaturas + total) y habilita el boton cuando hay al menos una pieza seleccionada
     */
    renderWcCompletoSummary() {
        const sel = this.wcCompletoSelection || {};
        const itemsEl = document.getElementById('wcCompletoSummaryItems');
        const totalEl = document.getElementById('wcCompletoSummaryTotal');
        const btn = document.getElementById('wcCompletoAddBtn');
        if (!itemsEl) return;
        const base = this._wcProductImageBase();
        const parts = [];
        let total = 0;
        ['taza', 'tanque', 'asiento'].forEach(tipo => {
            const item = sel[tipo];
            if (item) {
                total += (item.pvp != null ? item.pvp : 0);
                const img = base + this.escapeForHtmlAttribute(item.codigo) + '_1.JPG';
                const label = tipo === 'taza' ? 'Taza' : tipo === 'tanque' ? 'Tanque' : 'Asiento';
                const desc = this.escapeForHtmlAttribute(item.descripcion || '');
                parts.push('<div class="wc-completo-summary-item">' +
                    '<img src="' + img + '" alt="" onerror="this.style.display=\'none\'">' +
                    '<span class="wc-completo-summary-item-label">' + label + '</span>' +
                    '<span class="wc-completo-summary-item-desc">' + desc + '</span>' +
                    '<span class="wc-completo-summary-item-price">' + (item.pvp != null ? Number(item.pvp).toFixed(2) : '0.00') + ' EUR</span>' +
                    '</div>');
            }
        });
        itemsEl.innerHTML = parts.length ? parts.join('') : '<p class="wc-completo-summary-empty">Elige modelo y las piezas que quieras anadir.</p>';
        if (totalEl) totalEl.textContent = parts.length ? 'Total: ' + total.toFixed(2) + ' EUR' : '';
        if (btn) btn.disabled = parts.length === 0;
    }

    /**
     * Anade al carrito las piezas seleccionadas (taza, tanque y/o asiento; las que haya)
     */
    async handleWcCompletoAddToCart() {
        const sel = this.wcCompletoSelection;
        if (!sel) return;
        const items = [sel.taza, sel.tanque, sel.asiento].filter(Boolean);
        if (items.length === 0) {
            window.ui.showToast('Elige al menos una pieza para anadir', 'error');
            return;
        }
        try {
            for (const item of items) {
                await window.cartManager.addProduct(
                    { codigo: item.codigo, descripcion: item.descripcion || item.codigo, pvp: item.pvp != null ? item.pvp : 0 },
                    1
                );
            }
            window.ui.updateCartBadge();
            window.ui.showToast(items.length === 1 ? '1 articulo anadido al carrito' : items.length + ' articulos anadidos al carrito', 'success');
            this.showScreen('cart');
        } catch (e) {
            console.error('Error handleWcCompletoAddToCart:', e);
            window.ui.showToast('Error al anadir al carrito', 'error');
        }
    }

    /**
     * Normaliza teléfono para WhatsApp: solo dígitos, con prefijo de país si no lo lleva
     */
    normalizePhoneForWhatsApp(telefono) {
        if (!telefono) return '';
        const digits = telefono.replace(/\D/g, '');
        if (digits.length <= 9) {
            return '34' + digits;
        }
        return digits;
    }

    /**
     * Cierra la sesión del usuario
     */
    async logout() {
        try {
            // Cancelar suscripción de cambios de pedidos
            this.unsubscribeFromOrderStatus();

            // Cerrar sesion en Supabase (RPC de sesiones y Auth JWT)
            if (this.currentSession) {
                await window.supabaseClient.closeUserSession(this.currentSession);
            }
            await window.supabaseClient.signOutAuth();

            // Limpiar datos locales
            localStorage.removeItem('current_user');
            localStorage.removeItem('current_session');
            this.currentUser = null;
            this.currentSession = null;

            // Resetear chips de filtro de búsqueda al cerrar sesión
            this.filterChips.misCompras = false;
            this.filterChips.oferta     = false;
            document.getElementById('chipMisCompras')?.classList.remove('active');
            document.getElementById('chipOferta')?.classList.remove('active');

            // Limpiar cache de historial (Phase 2 - Cache)
            if (window.purchaseCache) {
                window.purchaseCache.clearAll();
                console.log('🗑️ Cache de historial limpiado al cerrar sesión');
            }

            // Actualizar UI
            this.updateUserUI();

            // Mostrar pantalla de acceso (solo usuarios logueados pueden usar la app)
            this.showLanding();

            // Mostrar mensaje
            window.ui.showToast('Sesion cerrada', 'success');

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

            // Empezar en pantalla principal (carrito); showScreen('cart') ya llama a updateCartView()
            this.showScreen('cart');
            this.updateActiveNav('cart');

            this.isInitialized = true;

            window.ui.hideLoading();
            console.log('Aplicacion inicializada correctamente');
            
            // Sincronizar productos EN SEGUNDO PLANO (no bloquea la UI)
            this.syncProductsInBackground();
            // Sincronizar stock EN SEGUNDO PLANO (una vez al dia)
            this.syncStockInBackground();

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
                console.log(`   Versión local: ${versionLocalHash.substring(0, 16)}...`);
                window.ui.updateSyncIndicator('Analizando cambios...');
                
                try {
                    changeStats = await window.supabaseClient.getChangeStatistics(versionLocalHash);
                    console.log('📊 Estadísticas obtenidas:', changeStats);
                    
                    if (changeStats && changeStats.total_cambios !== null && changeStats.total_cambios !== undefined) {
                        const totalCambios = changeStats.total_cambios;
                        const totalProductos = changeStats.productos_modificados + changeStats.productos_nuevos;
                        
                        console.log(`   Total cambios: ${totalCambios}`);
                        console.log(`   Productos nuevos: ${changeStats.productos_nuevos}, modificados: ${changeStats.productos_modificados}`);
                        console.log(`   Códigos nuevos: ${changeStats.codigos_nuevos}, modificados: ${changeStats.codigos_modificados}`);
                        
                        // Usar incremental si hay menos de 1000 cambios (umbral configurable)
                        // Si hay muchos cambios, es más eficiente hacer sincronización completa
                        if (totalCambios > 0 && totalCambios < 1000) {
                            useIncremental = true;
                            console.log(`✅ Sincronización incremental: ${totalCambios} cambios detectados`);
                            console.log(`   - Productos: ${changeStats.productos_nuevos} nuevos, ${changeStats.productos_modificados} modificados`);
                            console.log(`   - Códigos: ${changeStats.codigos_nuevos} nuevos, ${changeStats.codigos_modificados} modificados`);
                        } else if (totalCambios >= 1000) {
                            console.log(`📦 Muchos cambios (${totalCambios}), usando sincronización completa para mejor rendimiento`);
                        } else if (totalCambios === 0) {
                            // Si total_cambios = 0 pero el hash cambió, puede ser que:
                            // 1. Los productos fueron modificados pero fecha_actualizacion no se actualizó (problema con UPSERT)
                            // 2. La versión local no existe en version_control (primera vez)
                            // 3. Realmente no hay cambios (hash cambió por otra razón)
                            // En cualquier caso, es más seguro hacer sincronización completa para verificar
                            console.log(`⚠️ PROBLEMA DETECTADO: total_cambios = 0 pero el hash cambió`);
                            console.log(`   Esto indica que fecha_actualizacion NO se actualizó en los productos modificados`);
                            console.log(`   Posibles causas:`);
                            console.log(`   1. Se usó UPSERT normal en lugar de upsert_productos_masivo_con_fecha`);
                            console.log(`   2. La función RPC falló y se usó el fallback`);
                            console.log(`   3. Los cambios se hicieron antes de aplicar la función RPC nueva`);
                            console.log(`   💡 SOLUCIÓN: Verifica que generate_supabase_file.py use la función RPC correcta`);
                            console.log(`   📥 Usando sincronización completa para corregir fecha_actualizacion`);
                        }
                    } else {
                        console.warn('⚠️ Estadísticas inválidas o nulas:', changeStats);
                        console.warn('   Posibles causas:');
                        console.warn('   1. La función obtener_estadisticas_cambios no existe en Supabase');
                        console.warn('   2. El script SQL no se ejecutó correctamente');
                        console.warn('   3. La versión local no existe en version_control');
                    }
                } catch (statsError) {
                    console.error('❌ Error al obtener estadísticas:', statsError);
                    console.warn('⚠️ Usando sincronización completa como fallback');
                    console.warn('   Verifica que el script migration_sincronizacion_incremental.sql se ejecutó en Supabase');
                }
            } else {
                console.log('ℹ️ No hay versión local guardada, usando sincronización completa (primera vez)');
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
     * Sincroniza el stock EN SEGUNDO PLANO una vez al dia.
     * Guarda en IndexedDB y actualiza el indice en memoria.
     */
    async syncStockInBackground() {
        try {
            // Comparar hash remoto con el local para detectar cambios
            const remoteHash = await window.supabaseClient.getStockHash();
            const localHash  = localStorage.getItem('stock_hash_local');

            if (remoteHash && localHash === remoteHash) {
                // Hash coincide: no hay cambios, cargar de IndexedDB
                this.stockIndex = await window.cartManager.getStockIndex();
                if (this.stockIndex.size > 0) {
                    console.log(`Stock en memoria: ${this.stockIndex.size} articulos (sin cambios en hash)`);
                    this.initStockAlmacenFilter();
                }
                return;
            }

            console.log('Hash de stock actualizado, descargando...');
            const stockData = await window.supabaseClient.downloadStock();

            if (stockData && stockData.length > 0) {
                await window.cartManager.saveStockToStorage(stockData);
                this.stockIndex = await window.cartManager.getStockIndex();
                if (remoteHash) localStorage.setItem('stock_hash_local', remoteHash);
                console.log(`Stock sincronizado: ${stockData.length} articulos`);
                this.initStockAlmacenFilter();
            }
        } catch (error) {
            console.error('Error al sincronizar stock (no critico):', error);
            // Intentar cargar lo que haya en local aunque falle la descarga
            try {
                this.stockIndex = await window.cartManager.getStockIndex();
                if (this.stockIndex.size > 0) {
                    this.initStockAlmacenFilter();
                }
            } catch (e) {
                // Silencioso: sin stock no se muestra el filtro
            }
        }
    }

    /**
     * Configura toda la logica de interaccion de los chips de filtro de busqueda.
     * Debe llamarse una vez en setupScreens().
     */
    setupFilterChips() {
        const self = this;

        // --- Chip: Mis compras ---
        const chipMisCompras = document.getElementById('chipMisCompras');
        if (chipMisCompras) {
            chipMisCompras.addEventListener('click', () => {
                self.filterChips.misCompras = !self.filterChips.misCompras;
                chipMisCompras.classList.toggle('active', self.filterChips.misCompras);
                self._closeChipConfig();
            });
        }

        // --- Chip: Oferta ---
        const chipOferta = document.getElementById('chipOferta');
        if (chipOferta) {
            chipOferta.addEventListener('click', () => {
                self.filterChips.oferta = !self.filterChips.oferta;
                chipOferta.classList.toggle('active', self.filterChips.oferta);
                self._closeChipConfig();
            });
        }

        // --- Chip: Almacen (abre/cierra mini picker) ---
        const chipAlmacen = document.getElementById('chipAlmacen');
        if (chipAlmacen) {
            chipAlmacen.addEventListener('click', () => {
                const isOpen = self.filterChips.activeConfig === 'almacen';
                self._closeChipConfig();
                if (!isOpen) self._openChipConfig('almacen');
            });
        }

        // --- Chip: Cód. fabricante (abre/cierra input) ---
        const chipFabricante = document.getElementById('chipFabricante');
        if (chipFabricante) {
            chipFabricante.addEventListener('click', () => {
                const isOpen = self.filterChips.activeConfig === 'fabricante';
                self._closeChipConfig();
                if (!isOpen) {
                    self._openChipConfig('fabricante');
                    setTimeout(() => {
                        const input = document.getElementById('fabricanteSearchInput');
                        if (input) input.focus();
                    }, 80);
                }
            });
        }

        // Input de fabricante: actualiza estado y label del chip
        const fabricanteInput = document.getElementById('fabricanteSearchInput');
        if (fabricanteInput) {
            fabricanteInput.addEventListener('input', () => {
                const val = fabricanteInput.value.trim();
                self.filterChips.fabricante = val;
                const labelEl = document.getElementById('chipFabricanteLabel');
                const chipFab = document.getElementById('chipFabricante');
                if (val) {
                    if (labelEl) labelEl.textContent = 'Ref: ' + val;
                    if (chipFab) chipFab.classList.add('active');
                } else {
                    if (labelEl) labelEl.textContent = 'Ref. fabricante';
                    if (chipFab) chipFab.classList.remove('active');
                }
            });
            fabricanteInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') self.performSearch();
            });
        }

        // --- Chip: Precio (abre/cierra inputs desde/hasta) ---
        const chipPrecio = document.getElementById('chipPrecio');
        if (chipPrecio) {
            chipPrecio.addEventListener('click', () => {
                const isOpen = self.filterChips.activeConfig === 'precio';
                self._closeChipConfig();
                if (!isOpen) {
                    self._openChipConfig('precio');
                    setTimeout(() => {
                        const input = document.getElementById('precioDesdeInput');
                        if (input) input.focus();
                    }, 80);
                }
            });
        }

        // Inputs de precio: actualizan estado y label del chip
        const precioDesdeInput = document.getElementById('precioDesdeInput');
        const precioHastaInput = document.getElementById('precioHastaInput');
        const updatePrecioChip = () => {
            const desde = precioDesdeInput ? parseFloat(precioDesdeInput.value) : NaN;
            const hasta = precioHastaInput ? parseFloat(precioHastaInput.value) : NaN;
            self.filterChips.precioDesde = !isNaN(desde) ? desde : null;
            self.filterChips.precioHasta = !isNaN(hasta) ? hasta : null;

            const labelEl = document.getElementById('chipPrecioLabel');
            const chipPr  = document.getElementById('chipPrecio');
            const active  = self.filterChips.precioDesde !== null || self.filterChips.precioHasta !== null;
            if (active) {
                const partes = [];
                if (self.filterChips.precioDesde !== null) partes.push(self.filterChips.precioDesde + '+');
                if (self.filterChips.precioHasta !== null) partes.push('hasta ' + self.filterChips.precioHasta);
                if (labelEl) labelEl.textContent = partes.join(' ') + ' EUR';
                if (chipPr) chipPr.classList.add('active');
            } else {
                if (labelEl) labelEl.textContent = 'Precio';
                if (chipPr) chipPr.classList.remove('active');
            }
        };
        if (precioDesdeInput) {
            precioDesdeInput.addEventListener('input', updatePrecioChip);
            precioDesdeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') self.performSearch();
            });
        }
        if (precioHastaInput) {
            precioHastaInput.addEventListener('input', updatePrecioChip);
            precioHastaInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') self.performSearch();
            });
        }
    }

    /**
     * Abre el panel de configuracion de un chip especifico.
     * @param {'fabricante'|'precio'|'almacen'} tipo
     */
    _openChipConfig(tipo) {
        this.filterChips.activeConfig = tipo;
        const panel = document.getElementById('chipConfigPanel');
        const blocks = {
            fabricante: document.getElementById('chipConfigFabricante'),
            precio:     document.getElementById('chipConfigPrecio'),
            almacen:    document.getElementById('chipConfigAlmacen'),
        };
        if (panel) panel.style.display = '';
        for (const [key, el] of Object.entries(blocks)) {
            if (el) el.style.display = (key === tipo) ? '' : 'none';
        }
        // Indicar visualmente qué chip tiene el panel abierto (flecha girada)
        const chipIds = { fabricante: 'chipFabricante', precio: 'chipPrecio', almacen: 'chipAlmacen' };
        for (const [key, id] of Object.entries(chipIds)) {
            document.getElementById(id)?.classList.toggle('config-open', key === tipo);
        }
    }

    /**
     * Cierra el panel de configuracion de chip.
     */
    _closeChipConfig() {
        this.filterChips.activeConfig = null;
        document.getElementById('chipFabricante')?.classList.remove('config-open');
        document.getElementById('chipPrecio')?.classList.remove('config-open');
        document.getElementById('chipAlmacen')?.classList.remove('config-open');
        const panel = document.getElementById('chipConfigPanel');
        if (panel) panel.style.display = 'none';
    }

    /**
     * Inicializa el chip de almacen de stock:
     * - Establece el filtro por defecto segun almacen_habitual del usuario
     * - Rellena el mini-selector de almacenes disponibles en IndexedDB
     * - Muestra el chip de almacen
     */
    async initStockAlmacenFilter() {
        const chipAlmacen = document.getElementById('chipAlmacen');
        if (!chipAlmacen) return;

        const almacenes = await window.cartManager.getAlmacenesConStock();
        if (almacenes.length === 0) return;

        // Establecer almacen habitual como predeterminado
        const habitual = this.getEffectiveAlmacenHabitual();
        if (habitual && almacenes.includes(habitual.toUpperCase())) {
            this.stockAlmacenFiltro = habitual.toUpperCase();
        } else {
            this.stockAlmacenFiltro = null;
        }

        // Actualizar label del chip
        this._updateChipAlmacenLabel();

        // Rellenar mini selector de almacenes
        this._buildAlmacenMiniRow(almacenes);

        // Mostrar el chip
        chipAlmacen.style.display = '';
    }

    /**
     * Actualiza el texto del chip de almacen segun el filtro activo.
     */
    _updateChipAlmacenLabel() {
        const labelEl = document.getElementById('chipAlmacenLabel');
        if (!labelEl) return;
        labelEl.textContent = this.stockAlmacenFiltro ? this.stockAlmacenFiltro : 'Stock global';
    }

    /**
     * Construye o actualiza los botones del mini-selector de almacen.
     * @param {string[]} almacenes
     */
    _buildAlmacenMiniRow(almacenes) {
        const container = document.getElementById('almacenMiniRow');
        if (!container) return;
        container.innerHTML = '';

        const opciones = [{ value: null, label: 'Global' }, ...almacenes.map(a => ({ value: a, label: a }))];
        for (const op of opciones) {
            const btn = document.createElement('button');
            btn.className = 'almacen-mini-btn' + (this.stockAlmacenFiltro === op.value ? ' selected' : '');
            btn.textContent = op.label;
            btn.type = 'button';
            btn.addEventListener('click', () => {
                this.stockAlmacenFiltro = op.value;
                this._updateChipAlmacenLabel();
                this._buildAlmacenMiniRow(almacenes);
                // Actualizar estado visual del chip
                const chipAlmacen = document.getElementById('chipAlmacen');
                if (chipAlmacen) {
                    chipAlmacen.classList.toggle('active', op.value !== null);
                }
                // Si hay resultados, re-buscar con nuevo filtro
                const resultsList = document.getElementById('searchResultsList');
                if (resultsList && resultsList.children.length > 0) {
                    this.performSearch();
                }
            });
            container.appendChild(btn);
        }
    }

    /**
     * Calcula el stock efectivo de un articulo para el filtro activo,
     * descontando la cantidad que ya hay en el carrito.
     * @param {string} codigo - Codigo del articulo (cualquier casing)
     * @returns {number|null} - Stock efectivo, o null si no hay dato
     */
    getStockEfectivo(codigo) {
        if (!codigo || this.stockIndex.size === 0) return null;

        const entrada = this.stockIndex.get(codigo.toUpperCase());
        if (!entrada) return null;

        let stockBase;
        if (this.stockAlmacenFiltro && this.stockAlmacenFiltro !== 'GLOBAL') {
            stockBase = entrada.por_almacen?.[this.stockAlmacenFiltro] ?? 0;
        } else {
            stockBase = entrada.stock_global ?? 0;
        }

        // Descontar lo que ya hay en el carrito
        const enCarrito = window.cartManager.cart?.productos?.find(
            p => p.codigo?.toUpperCase() === codigo.toUpperCase()
        );
        const cantidadCarrito = enCarrito ? (enCarrito.cantidad || 0) : 0;

        return stockBase - cantidadCarrito;
    }

    /**
     * Genera el HTML del desglose de stock por almacen (ONTINYENT, ALZIRA, GANDIA, REQUENA).
     * Usado en busqueda con filtro Global y en las tarjetas del carrito.
     * @param {string} codigo - Codigo del articulo
     * @returns {string} HTML del bloque o vacio si no hay dato de stock
     */
    buildStockBreakdownByAlmacenHtml(codigo) {
        if (!codigo) return '';
        const ALMACENES_ORDER = ['ONTINYENT', 'ALZIRA', 'GANDIA', 'REQUENA'];
        const entrada = this.stockIndex.size > 0 ? this.stockIndex.get(codigo.toUpperCase()) : null;
        const porAlmacen = (entrada && entrada.por_almacen) ? entrada.por_almacen : {};
        const lineas = ALMACENES_ORDER.map(alm => {
            const qty = porAlmacen[alm] ?? 0;
            let clase, texto;
            if (qty <= 0) {
                clase = 'stock-rojo';
                texto = 'CONSULTAR DISPONIBILIDAD';
            } else if (qty <= 3) {
                clase = 'stock-naranja';
                texto = 'POCAS UNIDADES';
            } else {
                clase = 'stock-verde';
                texto = 'EN STOCK';
            }
            const almEsc = this.escapeForHtmlAttribute(alm);
            const codEsc = this.escapeForHtmlAttribute(codigo.toUpperCase());
            return `<div class="stock-almacen-line" data-stock-codigo="${codEsc}" data-almacen="${almEsc}"><span class="stock-almacen-label stock-badge ${clase}"><strong>${almEsc}</strong>: ${texto}</span></div>`;
        });
        return `<div class="result-stock-global cart-stock-breakdown">${lineas.join('')}</div>`;
    }

    /**
     * Genera el HTML del badge de stock para un articulo.
     * Con filtro Global: desglose por almacen (cada uno con su estado y color).
     * Con almacen especifico: un solo badge como hasta ahora.
     * @param {string} codigo
     * @returns {string} HTML del badge (puede ser vacio si no hay dato)
     */
    buildStockBadgeHtml(codigo) {
        if (!codigo) return '';

        const entrada = this.stockIndex.size > 0 ? this.stockIndex.get(codigo.toUpperCase()) : null;
        const codEsc = this.escapeForHtmlAttribute(codigo.toUpperCase());
        const badgeConsultar = '<span class="stock-badge stock-rojo" data-stock-codigo="' + codEsc + '">CONSULTAR DISPONIBILIDAD</span>';

        if (this.stockIndex.size === 0 || !entrada) {
            if (this.stockAlmacenFiltro && this.stockAlmacenFiltro !== 'GLOBAL') {
                return badgeConsultar;
            }
            return this.buildStockBreakdownByAlmacenHtml(codigo);
        }

        if (this.stockAlmacenFiltro && this.stockAlmacenFiltro !== 'GLOBAL') {
            const efectivo = this.getStockEfectivo(codigo);
            let clase, texto;
            if (efectivo === null || efectivo <= 0) {
                clase = 'stock-rojo';
                texto = 'CONSULTAR DISPONIBILIDAD';
            } else if (efectivo <= 3) {
                clase = 'stock-naranja';
                texto = 'POCAS UNIDADES';
            } else {
                clase = 'stock-verde';
                texto = 'EN STOCK';
            }
            return `<span class="stock-badge ${clase}" data-stock-codigo="${codEsc}">${texto}</span>`;
        }
        return this.buildStockBreakdownByAlmacenHtml(codigo);
    }

    /**
     * Actualiza en el DOM solo los badges de stock de los resultados visibles,
     * sin re-renderizar la lista completa.
     * Se llama cada vez que cambia la cantidad en el carrito.
     * Con filtro Global: actualiza cada linea por almacen (stock sin descontar carrito).
     * Con almacen especifico: actualiza el badge unico (stock efectivo con carrito).
     */
    updateStockBadgesVisibles() {
        if (this.stockIndex.size === 0) return;

        const elements = document.querySelectorAll('[data-stock-codigo]');
        for (const el of elements) {
            const codigo = el.dataset.stockCodigo;
            const entrada = this.stockIndex.get(codigo);
            const setConsultar = (labelEl) => {
                if (!labelEl) return;
                labelEl.className = 'stock-almacen-label stock-badge stock-rojo';
                labelEl.innerHTML = (el.dataset.almacen ? '<strong>' + this.escapeForHtmlAttribute(el.dataset.almacen) + '</strong>: ' : '') + 'CONSULTAR DISPONIBILIDAD';
            };

            if (el.classList.contains('stock-almacen-line')) {
                const almacen = el.dataset.almacen;
                const label = el.querySelector('.stock-almacen-label');
                if (!label) continue;
                if (!entrada) {
                    setConsultar(label);
                    continue;
                }
                const qty = (entrada.por_almacen || {})[almacen] ?? 0;
                let clase, texto;
                if (qty <= 0) {
                    clase = 'stock-rojo';
                    texto = 'CONSULTAR DISPONIBILIDAD';
                } else if (qty <= 3) {
                    clase = 'stock-naranja';
                    texto = 'POCAS UNIDADES';
                } else {
                    clase = 'stock-verde';
                    texto = 'EN STOCK';
                }
                label.className = 'stock-almacen-label stock-badge ' + clase;
                label.innerHTML = '<strong>' + this.escapeForHtmlAttribute(almacen) + '</strong>: ' + texto;
            } else {
                if (!entrada) {
                    el.className = 'stock-badge stock-rojo';
                    el.innerHTML = 'CONSULTAR DISPONIBILIDAD';
                    continue;
                }
                const efectivo = this.getStockEfectivo(codigo);
                el.className = 'stock-badge';
                if (efectivo === null || efectivo <= 0) {
                    el.classList.add('stock-rojo');
                    el.innerHTML = 'CONSULTAR DISPONIBILIDAD';
                } else if (efectivo <= 3) {
                    el.classList.add('stock-naranja');
                    el.innerHTML = 'POCAS UNIDADES';
                } else {
                    el.classList.add('stock-verde');
                    el.innerHTML = 'EN STOCK';
                }
            }
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

        // Chips de filtro de búsqueda
        this.setupFilterChips();

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

        // Clic en datos de usuario: titular -> Mi perfil; operario -> nada; comercial -> seleccionar cliente
        const menuUserInfo = document.getElementById('menuUserInfo');
        if (menuUserInfo) {
            menuUserInfo.addEventListener('click', () => {
                if (this.currentUser && this.currentUser.is_operario) return;
                if (this.currentUser && this.currentUser.is_comercial) {
                    this.closeMenu();
                    this.showScreen('selectorCliente');
                    this.renderSelectorClienteScreen();
                    return;
                }
                this.closeMenu();
                this.showScreen('profile');
                this.renderProfileScreen();
            });
        }

        // My Orders: cliente carga sus pedidos; comercial carga pedidos del cliente representado (si hay uno seleccionado)
        const myOrdersBtn = document.getElementById('myOrdersBtn');
        if (myOrdersBtn) {
            myOrdersBtn.addEventListener('click', () => {
                if (this.currentUser && this.currentUser.is_comercial) {
                    if (!this.currentUser.cliente_representado_id) {
                        window.ui.showToast('Selecciona un cliente (pulsa en tu nombre)', 'info');
                        return;
                    }
                }
                this.closeMenu();
                this.showScreen('myOrders');
                this.updateActiveNav('myOrders');
                this.loadMyOrders();
            });
        }

        // Herramientas: abre pantalla de herramientas (visible para todos los usuarios)
        const herramientasBtn = document.getElementById('herramientasBtn');
        if (herramientasBtn) {
            herramientasBtn.addEventListener('click', () => {
                this.closeMenu();
                this.showScreen('herramientas');
            });
        }

        // Panel de Control: solo administrador
        const panelControlBtn = document.getElementById('panelControlBtn');
        if (panelControlBtn) {
            panelControlBtn.addEventListener('click', () => {
                this.closeMenu();
                this.showScreen('panelControl');
            });
        }

        // Panel de Control: Volver
        const panelControlBackBtn = document.getElementById('panelControlBackBtn');
        if (panelControlBackBtn) {
            panelControlBackBtn.addEventListener('click', () => {
                this.showScreen('cart');
            });
        }

        // Panel de Control: Configurar conjuntos WC
        const panelControlWcConjuntosBtn = document.getElementById('panelControlWcConjuntosBtn');
        if (panelControlWcConjuntosBtn) {
            panelControlWcConjuntosBtn.addEventListener('click', () => {
                this.showScreen('wcConjuntos');
                this.renderWcConjuntosList();
            });
        }

        // Panel de Control: Configurar recambios
        const panelControlRecambiosBtn = document.getElementById('panelControlRecambiosBtn');
        if (panelControlRecambiosBtn) {
            panelControlRecambiosBtn.addEventListener('click', () => {
                this.showScreen('recambios');
            });
        }

        // Conjuntos WC: Volver al Panel de Control
        const wcConjuntosBackBtn = document.getElementById('wcConjuntosBackBtn');
        if (wcConjuntosBackBtn) {
            wcConjuntosBackBtn.addEventListener('click', () => {
                this.showScreen('panelControl');
            });
        }

        // Conjuntos WC: Nuevo conjunto
        const wcConjuntosNuevoBtn = document.getElementById('wcConjuntosNuevoBtn');
        if (wcConjuntosNuevoBtn) {
            wcConjuntosNuevoBtn.addEventListener('click', () => {
                this.openWcConjuntoDetail(null);
            });
        }

        // Conjuntos WC: filtrar por nombre (re-renderiza sin volver a cargar)
        const wcConjuntosFilterNombre = document.getElementById('wcConjuntosFilterNombre');
        if (wcConjuntosFilterNombre) {
            wcConjuntosFilterNombre.addEventListener('input', () => this.renderWcConjuntosList(false));
        }

        // Conjunto WC detalle: Volver a lista
        const wcConjuntoDetailBackBtn = document.getElementById('wcConjuntoDetailBackBtn');
        if (wcConjuntoDetailBackBtn) {
            wcConjuntoDetailBackBtn.addEventListener('click', () => {
                this.showScreen('wcConjuntos');
                this.renderWcConjuntosList();
            });
        }

        // Conjunto WC detalle: Guardar formulario
        const wcConjuntoDetailForm = document.getElementById('wcConjuntoDetailForm');
        if (wcConjuntoDetailForm) {
            wcConjuntoDetailForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleWcConjuntoDetailSave();
            });
        }

        // Conjunto WC detalle: Comprobar imagen
        const wcConjuntoComprobarImagenBtn = document.getElementById('wcConjuntoComprobarImagenBtn');
        if (wcConjuntoComprobarImagenBtn) {
            wcConjuntoComprobarImagenBtn.addEventListener('click', () => this.handleWcConjuntoComprobarImagen());
        }

        // Conjunto WC: Buscar taza / tanque / asiento (muestra codigo y descripcion antes de anadir)
        const wcConjuntoBuscarTazaBtn = document.getElementById('wcConjuntoBuscarTazaBtn');
        if (wcConjuntoBuscarTazaBtn) wcConjuntoBuscarTazaBtn.addEventListener('click', () => this.handleWcConjuntoBuscarPieza('taza'));
        const wcConjuntoBuscarTanqueBtn = document.getElementById('wcConjuntoBuscarTanqueBtn');
        if (wcConjuntoBuscarTanqueBtn) wcConjuntoBuscarTanqueBtn.addEventListener('click', () => this.handleWcConjuntoBuscarPieza('tanque'));
        const wcConjuntoBuscarAsientoBtn = document.getElementById('wcConjuntoBuscarAsientoBtn');
        if (wcConjuntoBuscarAsientoBtn) wcConjuntoBuscarAsientoBtn.addEventListener('click', () => this.handleWcConjuntoBuscarPieza('asiento'));
        // Conjunto WC: Confirmar anadir (tras buscar y ver vista previa)
        const wcConjuntoConfirmAddTazaBtn = document.getElementById('wcConjuntoConfirmAddTazaBtn');
        if (wcConjuntoConfirmAddTazaBtn) wcConjuntoConfirmAddTazaBtn.addEventListener('click', () => this.handleWcConjuntoConfirmAddPieza('taza'));
        const wcConjuntoConfirmAddTanqueBtn = document.getElementById('wcConjuntoConfirmAddTanqueBtn');
        if (wcConjuntoConfirmAddTanqueBtn) wcConjuntoConfirmAddTanqueBtn.addEventListener('click', () => this.handleWcConjuntoConfirmAddPieza('tanque'));
        const wcConjuntoConfirmAddAsientoBtn = document.getElementById('wcConjuntoConfirmAddAsientoBtn');
        if (wcConjuntoConfirmAddAsientoBtn) wcConjuntoConfirmAddAsientoBtn.addEventListener('click', () => this.handleWcConjuntoConfirmAddPieza('asiento'));

        // Delegacion para eliminar piezas (taza/tanque/asiento) desde listas dinamicas
        const wcDetailPiezas = document.getElementById('wcConjuntoDetailPiezas');
        if (wcDetailPiezas) {
            wcDetailPiezas.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-wc-remove-pieza]');
                if (!btn) return;
                e.preventDefault();
                const tipo = btn.getAttribute('data-wc-remove-pieza');
                const id = btn.getAttribute('data-wc-pieza-id');
                if (tipo && id) this.handleWcConjuntoRemovePieza(tipo, id);
            });
        }

        // Recambios: Volver al Panel de Control
        const recambiosBackBtn = document.getElementById('recambiosBackBtn');
        if (recambiosBackBtn) {
            recambiosBackBtn.addEventListener('click', () => {
                this.showScreen('panelControl');
            });
        }

        // Recambios: Buscar producto
        const recambiosBuscarBtn = document.getElementById('recambiosBuscarBtn');
        if (recambiosBuscarBtn) {
            recambiosBuscarBtn.addEventListener('click', () => this.handleRecambiosBuscarProducto());
        }

        // Recambios: Buscar y anadir recambio (hijo)
        const recambiosBuscarRecambioBtn = document.getElementById('recambiosBuscarRecambioBtn');
        if (recambiosBuscarRecambioBtn) recambiosBuscarRecambioBtn.addEventListener('click', () => this.handleRecambiosBuscarRecambio());
        const recambiosConfirmAddRecambioBtn = document.getElementById('recambiosConfirmAddRecambioBtn');
        if (recambiosConfirmAddRecambioBtn) recambiosConfirmAddRecambioBtn.addEventListener('click', () => this.handleRecambiosConfirmAddRecambio());

        // Recambios: Buscar y anadir producto padre
        const recambiosBuscarPadreBtn = document.getElementById('recambiosBuscarPadreBtn');
        if (recambiosBuscarPadreBtn) recambiosBuscarPadreBtn.addEventListener('click', () => this.handleRecambiosBuscarPadre());
        const recambiosConfirmAddPadreBtn = document.getElementById('recambiosConfirmAddPadreBtn');
        if (recambiosConfirmAddPadreBtn) recambiosConfirmAddPadreBtn.addEventListener('click', () => this.handleRecambiosConfirmAddPadre());

        // Delegacion Recambios: Quitar (lista recambios y lista padres)
        const recambiosContenido = document.getElementById('recambiosContenido');
        if (recambiosContenido) {
            recambiosContenido.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-recambio-remove-id]');
                if (!btn) return;
                e.preventDefault();
                const id = btn.getAttribute('data-recambio-remove-id');
                if (id) this.handleRecambiosRemove(id);
            });
        }

        // Vista Recambios: Volver (a la pantalla desde la que se abrio el detalle)
        const recambiosVistaBackBtn = document.getElementById('recambiosVistaBackBtn');
        if (recambiosVistaBackBtn) {
            recambiosVistaBackBtn.addEventListener('click', () => {
                this.showScreen(this.recambiosVistaReturnScreen || 'cart');
            });
        }

        // Vista Recambios: clic en una tarjeta -> anadir recambio al carrito
        const recambiosVistaContenido = document.getElementById('recambiosVistaContenido');
        if (recambiosVistaContenido) {
            recambiosVistaContenido.addEventListener('click', async (e) => {
                const item = e.target.closest('.recambios-vista-card');
                if (!item || !item.dataset.codigo) return;
                const codigo = item.dataset.codigo;
                const descripcion = item.dataset.descripcion || '';
                const pvp = parseFloat(item.dataset.pvp) || 0;
                await this.addProductToCart(codigo, descripcion, pvp);
            });
        }

        // Herramientas: Volver
        const herramientasBackBtn = document.getElementById('herramientasBackBtn');
        if (herramientasBackBtn) {
            herramientasBackBtn.addEventListener('click', () => {
                this.showScreen('cart');
            });
        }

        // Herramientas: WC Completo -> pantalla configurador
        const herramientaWcCompletoBtn = document.getElementById('herramientaWcCompletoBtn');
        if (herramientaWcCompletoBtn) {
            herramientaWcCompletoBtn.addEventListener('click', () => {
                this.showScreen('wcCompleto');
                this.renderWcCompletoScreen();
            });
        }

        // WC Completo: Volver a Herramientas
        const wcCompletoBackBtn = document.getElementById('wcCompletoBackBtn');
        if (wcCompletoBackBtn) {
            wcCompletoBackBtn.addEventListener('click', () => {
                this.showScreen('herramientas');
            });
        }

        // WC Completo: delegacion de clics en cards (conjunto y producto)
        const wcCompletoMain = document.querySelector('.wc-completo-main');
        if (wcCompletoMain) {
            wcCompletoMain.addEventListener('click', (e) => {
                const cardConjunto = e.target.closest('.wc-completo-card-conjunto[data-conjunto-id]');
                const cardProduct = e.target.closest('.wc-completo-card-product[data-tipo][data-codigo]');
                if (cardConjunto) {
                    e.preventDefault();
                    this.onWcCompletoConjuntoSelect(cardConjunto.getAttribute('data-conjunto-id'));
                } else if (cardProduct) {
                    e.preventDefault();
                    this.onWcCompletoProductSelect(cardProduct.getAttribute('data-tipo'), cardProduct.getAttribute('data-codigo'));
                }
            });
        }

        // WC Completo: Anadir al carrito
        const wcCompletoAddBtn = document.getElementById('wcCompletoAddBtn');
        if (wcCompletoAddBtn) {
            wcCompletoAddBtn.addEventListener('click', () => {
                this.handleWcCompletoAddToCart();
            });
        }

        // WC Completo: chips tipo y adosado + filtro nombre re-renderizan el grid de conjuntos
        const wcCompletoChipsTipo = document.getElementById('wcCompletoChipsTipo');
        const wcCompletoChipsAdosado = document.getElementById('wcCompletoChipsAdosado');
        const wcCompletoFilterNombre = document.getElementById('wcCompletoFilterNombre');
        const selectChipInRow = (row, target) => {
            if (!row || !target || !target.classList.contains('wc-completo-chip')) return;
            row.querySelectorAll('.wc-completo-chip').forEach(el => el.classList.remove('selected'));
            target.classList.add('selected');
            if (this.renderWcCompletoConjuntosGrid) this.renderWcCompletoConjuntosGrid();
        };
        if (wcCompletoChipsTipo) {
            wcCompletoChipsTipo.addEventListener('click', (e) => selectChipInRow(wcCompletoChipsTipo, e.target));
        }
        if (wcCompletoChipsAdosado) {
            wcCompletoChipsAdosado.addEventListener('click', (e) => selectChipInRow(wcCompletoChipsAdosado, e.target));
        }
        if (wcCompletoFilterNombre) {
            wcCompletoFilterNombre.addEventListener('input', () => this.renderWcCompletoConjuntosGrid && this.renderWcCompletoConjuntosGrid());
        }

        // Tarjeta comercial en menú: abre pantalla de comercial
        const menuCommercialCard = document.getElementById('menuCommercialCard');
        if (menuCommercialCard) {
            menuCommercialCard.addEventListener('click', () => {
                this.closeMenu();
                this.showScreen('commercial');
                this.renderCommercialScreen();
            });
        }

        // Comercial: Llamar
        const commercialBtnCall = document.getElementById('commercialBtnCall');
        if (commercialBtnCall) {
            commercialBtnCall.addEventListener('click', () => {
                const tel = (commercialBtnCall.dataset.telefono || '').trim().replace(/\s/g, '');
                if (tel) window.location.href = 'tel:' + tel;
            });
        }

        // Comercial: WhatsApp
        const commercialBtnWhatsApp = document.getElementById('commercialBtnWhatsApp');
        if (commercialBtnWhatsApp) {
            commercialBtnWhatsApp.addEventListener('click', () => {
                const tel = (commercialBtnWhatsApp.dataset.telefono || '').trim();
                const wa = this.normalizePhoneForWhatsApp(tel);
                if (wa) window.open('https://wa.me/' + wa, '_blank');
            });
        }

        // Comercial: Email
        const commercialBtnEmail = document.getElementById('commercialBtnEmail');
        if (commercialBtnEmail) {
            commercialBtnEmail.addEventListener('click', () => {
                const email = (commercialBtnEmail.dataset.email || '').trim();
                if (email) window.location.href = 'mailto:' + email;
            });
        }

        // Recoger en Almacén: abre modal para elegir almacén y luego observaciones
        const recogerEnAlmacenBtn = document.getElementById('recogerEnAlmacenBtn');
        if (recogerEnAlmacenBtn) {
            recogerEnAlmacenBtn.addEventListener('click', () => {
                this.showAlmacenSelectionModal();
            });
        }

        // Enviar en Ruta: abre modal de aviso y envía al almacén habitual
        const enviarEnRutaBtn = document.getElementById('enviarEnRutaBtn');
        if (enviarEnRutaBtn) {
            enviarEnRutaBtn.addEventListener('click', () => {
                this.showEnviarEnRutaModal();
            });
        }

        // Escanear en Mostrador: abre pantalla con QR y código manual
        const escanearEnMostradorBtn = document.getElementById('escanearEnMostradorBtn');
        if (escanearEnMostradorBtn) {
            escanearEnMostradorBtn.addEventListener('click', () => {
                this.showScreen('mostrador');
            });
        }

        // Volver desde Mostrador a Caja
        const mostradorBackBtn = document.getElementById('mostradorBackBtn');
        if (mostradorBackBtn) {
            mostradorBackBtn.addEventListener('click', () => {
                this.showScreen('checkout');
            });
        }

        // Perfil: Volver
        const profileBackBtn = document.getElementById('profileBackBtn');
        if (profileBackBtn) {
            profileBackBtn.addEventListener('click', () => {
                this.showScreen('cart');
            });
        }

        // Selector cliente (comercial): Volver
        const selectorClienteBackBtn = document.getElementById('selectorClienteBackBtn');
        if (selectorClienteBackBtn) {
            selectorClienteBackBtn.addEventListener('click', () => {
                this.showScreen('cart');
            });
        }

        // Selector cliente (comercial): filtrar por numero, nombre o poblacion
        const selectorClienteFilterNumero = document.getElementById('selectorClienteFilterNumero');
        const selectorClienteFilterNombre = document.getElementById('selectorClienteFilterNombre');
        const selectorClienteFilterPoblacion = document.getElementById('selectorClienteFilterPoblacion');
        if (selectorClienteFilterNumero) {
            selectorClienteFilterNumero.addEventListener('input', () => this._applySelectorClienteFilter());
        }
        if (selectorClienteFilterNombre) {
            selectorClienteFilterNombre.addEventListener('input', () => this._applySelectorClienteFilter());
        }
        if (selectorClienteFilterPoblacion) {
            selectorClienteFilterPoblacion.addEventListener('input', () => this._applySelectorClienteFilter());
        }

        // Perfil: Cambiar contraseña
        const profilePasswordForm = document.getElementById('profilePasswordForm');
        if (profilePasswordForm) {
            profilePasswordForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (!this.currentUser || !this.currentUser.user_id) return;
                const current = document.getElementById('profileCurrentPassword');
                const newP = document.getElementById('profileNewPassword');
                const confirmP = document.getElementById('profileConfirmPassword');
                const msgEl = document.getElementById('profilePasswordMessage');
                const submitBtn = document.getElementById('profilePasswordSubmit');
                if (!current || !newP || !confirmP || !msgEl) return;
                const newVal = newP.value;
                const confirmVal = confirmP.value;
                if (newVal.length < 4) {
                    msgEl.textContent = 'La nueva contrasena debe tener al menos 4 caracteres';
                    msgEl.className = 'profile-message error';
                    msgEl.style.display = 'block';
                    return;
                }
                if (newVal !== confirmVal) {
                    msgEl.textContent = 'La nueva contrasena y la repeticion no coinciden';
                    msgEl.className = 'profile-message error';
                    msgEl.style.display = 'block';
                    return;
                }
                if (submitBtn) submitBtn.disabled = true;
                window.supabaseClient.cambiarPassword(this.currentUser.user_id, current.value, newVal)
                    .then((result) => {
                        if (result.success) {
                            msgEl.textContent = 'Contrasena actualizada correctamente';
                            msgEl.className = 'profile-message success';
                            msgEl.style.display = 'block';
                            profilePasswordForm.reset();
                            window.ui.showToast('Contrasena actualizada', 'success');
                        } else {
                            msgEl.textContent = result.message || 'Error al cambiar contrasena';
                            msgEl.className = 'profile-message error';
                            msgEl.style.display = 'block';
                        }
                    })
                    .catch(() => {
                        msgEl.textContent = 'Error de conexion';
                        msgEl.className = 'profile-message error';
                        msgEl.style.display = 'block';
                    })
                    .finally(() => {
                        if (submitBtn) submitBtn.disabled = false;
                    });
            });
        }

        // Perfil: Añadir operario (abre modal)
        const profileAddOperarioBtn = document.getElementById('profileAddOperarioBtn');
        if (profileAddOperarioBtn) {
            profileAddOperarioBtn.addEventListener('click', () => {
                this.openProfileOperarioModal();
            });
        }

        // Perfil: Cerrar modal operario
        const profileOperarioModalClose = document.getElementById('profileOperarioModalClose');
        if (profileOperarioModalClose) {
            profileOperarioModalClose.addEventListener('click', () => {
                this.closeProfileOperarioModal();
            });
        }
        const profileOperarioModal = document.getElementById('profileOperarioModal');
        if (profileOperarioModal) {
            const overlay = profileOperarioModal.querySelector('.profile-modal-overlay');
            if (overlay) {
                overlay.addEventListener('click', () => this.closeProfileOperarioModal());
            }
        }

        // Comercial: Cerrar modal editar alias cliente
        const editAliasClienteModalClose = document.getElementById('editAliasClienteModalClose');
        if (editAliasClienteModalClose) {
            editAliasClienteModalClose.addEventListener('click', () => this.closeEditAliasModal());
        }
        const editAliasClienteModal = document.getElementById('editAliasClienteModal');
        if (editAliasClienteModal) {
            const overlay = editAliasClienteModal.querySelector('.profile-modal-overlay');
            if (overlay) {
                overlay.addEventListener('click', () => this.closeEditAliasModal());
            }
        }

        // Perfil: Enviar formulario nuevo operario
        const profileOperarioForm = document.getElementById('profileOperarioForm');
        if (profileOperarioForm) {
            profileOperarioForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (!this.currentUser || !this.currentUser.user_id) return;
                const codigoInput = document.getElementById('profileOperarioCodigo');
                const nombreInput = document.getElementById('profileOperarioNombre');
                const passwordInput = document.getElementById('profileOperarioPassword');
                const msgEl = document.getElementById('profileOperarioMessage');
                const submitBtn = document.getElementById('profileOperarioSubmit');
                if (!codigoInput || !nombreInput || !passwordInput || !msgEl) return;
                const codigo = codigoInput.value.trim();
                const nombre = nombreInput.value.trim();
                const password = passwordInput.value;
                if (!codigo || !nombre) {
                    msgEl.textContent = 'Completa codigo y nombre';
                    msgEl.className = 'profile-message error';
                    msgEl.style.display = 'block';
                    return;
                }
                if (password.length < 4) {
                    msgEl.textContent = 'La contrasena debe tener al menos 4 caracteres';
                    msgEl.className = 'profile-message error';
                    msgEl.style.display = 'block';
                    return;
                }
                if (submitBtn) submitBtn.disabled = true;
                window.supabaseClient.addOperario(this.currentUser.user_id, codigo, nombre, password)
                    .then((result) => {
                        if (result.success) {
                            this.closeProfileOperarioModal();
                            this.renderProfileScreen();
                            window.ui.showToast('Operario anadido', 'success');
                        } else {
                            msgEl.textContent = result.message || 'Error al crear operario';
                            msgEl.className = 'profile-message error';
                            msgEl.style.display = 'block';
                        }
                    })
                    .catch(() => {
                        msgEl.textContent = 'Error de conexion';
                        msgEl.className = 'profile-message error';
                        msgEl.style.display = 'block';
                    })
                    .finally(() => {
                        if (submitBtn) submitBtn.disabled = false;
                    });
            });
        }

        // Perfil: Eliminar operario (delegación)
        const profileOperariosList = document.getElementById('profileOperariosList');
        if (profileOperariosList) {
            profileOperariosList.addEventListener('click', (e) => {
                const btn = e.target.closest('.profile-operario-remove');
                if (!btn || !this.currentUser) return;
                const operarioId = parseInt(btn.dataset.operarioId, 10);
                if (!operarioId) return;
                window.ui.showConfirm('Eliminar operario', '¿Eliminar este operario? Perdera el acceso a tu cuenta.', 'Eliminar', 'Cancelar')
                    .then((ok) => { if (ok) this.doRemoveOperario(operarioId); });
            });
        }

        // Cerrar modal de almacén
        const cancelAlmacenModalBtn = document.getElementById('cancelAlmacenModalBtn');
        if (cancelAlmacenModalBtn) {
            cancelAlmacenModalBtn.addEventListener('click', () => {
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

        // Botones de selección de almacén: al elegir, abrir modal centrado de observaciones
        const almacenButtons = document.querySelectorAll('.almacen-btn');
        almacenButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const almacen = btn.dataset.almacen;
                document.querySelectorAll('.almacen-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.showAlmacenObservacionesModal(almacen);
            });
        });

        // Confirmar Recoger en Almacén: enviar con observaciones "RECOGER EN ALMACEN [ALMACEN] - [texto]"
        const confirmarRecogerAlmacenBtn = document.getElementById('confirmarRecogerAlmacenBtn');
        if (confirmarRecogerAlmacenBtn) {
            confirmarRecogerAlmacenBtn.addEventListener('click', () => {
                const observacionesModal = document.getElementById('almacenObservacionesModal');
                const almacen = observacionesModal ? observacionesModal.getAttribute('data-selected-almacen') : null;
                if (!almacen) {
                    window.ui.showToast('Selecciona un almacen', 'warning');
                    return;
                }
                const input = document.getElementById('almacenObservacionesInput');
                const userText = input ? input.value.trim() : '';
                let observaciones = 'RECOGER EN ALMACEN ' + almacen + '\n\n' + (userText || '');
                if (this.currentUser && this.currentUser.nombre_operario) {
                    observaciones += '\n\nPedido realizado por: ' + this.currentUser.nombre_operario;
                }
                this.sendRemoteOrder(almacen, observaciones);
            });
        }

        // Volver del modal observaciones al modal de selección de almacén (cierre con Volver; sin X en cabecera)
        const volverAlmacenSelectionBtn = document.getElementById('volverAlmacenSelectionBtn');
        if (volverAlmacenSelectionBtn) {
            volverAlmacenSelectionBtn.addEventListener('click', () => {
                this.hideAlmacenObservacionesModal();
                const almacenModal = document.getElementById('almacenModal');
                if (almacenModal) {
                    almacenModal.style.display = 'flex';
                }
            });
        }

        // Cerrar modal observaciones al hacer clic en overlay
        const almacenObservacionesModal = document.getElementById('almacenObservacionesModal');
        if (almacenObservacionesModal) {
            almacenObservacionesModal.addEventListener('click', (e) => {
                if (e.target.id === 'almacenObservacionesModal' || e.target.classList.contains('login-modal-overlay')) {
                    this.hideAlmacenObservacionesModal();
                    this.hideAlmacenModal();
                }
            });
        }

        // Cerrar modal Enviar en Ruta
        const closeEnviarEnRutaModal = document.getElementById('closeEnviarEnRutaModal');
        if (closeEnviarEnRutaModal) {
            closeEnviarEnRutaModal.addEventListener('click', () => {
                this.hideEnviarEnRutaModal();
            });
        }

        // Cerrar modal Enviar en Ruta al hacer clic en overlay
        const enviarEnRutaModal = document.getElementById('enviarEnRutaModal');
        if (enviarEnRutaModal) {
            enviarEnRutaModal.addEventListener('click', (e) => {
                if (e.target.id === 'enviarEnRutaModal' || e.target.classList.contains('login-modal-overlay')) {
                    this.hideEnviarEnRutaModal();
                }
            });
        }

        // Confirmar Enviar en Ruta: envía al almacén habitual con observaciones "ENVIAR EN RUTA [texto]"
        const confirmarEnviarEnRutaBtn = document.getElementById('confirmarEnviarEnRutaBtn');
        if (confirmarEnviarEnRutaBtn) {
            confirmarEnviarEnRutaBtn.addEventListener('click', () => {
                const almacenHabitual = this.getEffectiveAlmacenHabitual();
                if (!this.currentUser || !almacenHabitual) {
                    window.ui.showToast('No tienes almacen habitual asignado.', 'warning');
                    return;
                }
                const input = document.getElementById('enviarEnRutaObservacionesInput');
                const userText = input ? input.value.trim() : '';
                let observaciones = 'ENVIAR EN RUTA' + (userText ? '\n\n' + userText : '');
                if (this.currentUser && this.currentUser.nombre_operario) {
                    observaciones += '\n\nPedido realizado por: ' + this.currentUser.nombre_operario;
                }
                this.sendRemoteOrder(almacenHabitual, observaciones);
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
        if (this.currentUser && !this.currentUser.comercial) {
            this.loadComercialAsignado();
        }
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
        
        // Detener cámara de checkout si estábamos en checkout o en mostrador
        if (previousScreen === 'checkout' || previousScreen === 'mostrador') {
            console.log('Verificando si hay que cerrar camara de checkout...');
            console.log('   isScanningCheckout:', window.scannerManager.isScanningCheckout);
            if (window.scannerManager.isScanningCheckout) {
                console.log('Cerrando camara de checkout...');
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

            // Pantalla Caja: solo mostrar/ocultar sección de pedido remoto (sin cámara)
            if (screenName === 'checkout') {
                const remoteOrderSection = document.getElementById('remoteOrderSection');
                if (remoteOrderSection) {
                    remoteOrderSection.style.display = this.currentUser ? 'block' : 'none';
                }
            }

            // Iniciar cámara de checkout si entramos en pantalla Escanear en Mostrador
            if (screenName === 'mostrador') {
                console.log('Entrando a pantalla MOSTRADOR - Iniciando camara de checkout...');
                setTimeout(() => {
                    window.scannerManager.startCheckoutCameraIntegrated();
                }, 100);
            }

            // Actualizar vista del carrito cuando se accede a esa pantalla
            if (screenName === 'cart') {
                this.updateCartView();
                console.log('Vista del carrito actualizada');
            }

            if (screenName === 'commercial') {
                this.renderCommercialScreen();
            }

            if (screenName === 'profile') {
                this.renderProfileScreen();
            }

            if (screenName === 'recambios') {
                this.initRecambiosScreen();
            }

            if (screenName === 'recambiosVista') {
                if (this.recambiosVistaProductoCodigo && this.recambiosVistaMode) {
                    this.renderRecambiosVistaPageFromProduct();
                } else {
                    this.initRecambiosVistaScreen();
                }
            }

        }
    }

    /**
     * Realiza la búsqueda
     */
    async performSearch() {
        const codeInput = document.getElementById('codeSearchInput');
        const descInput = document.getElementById('descriptionSearchInput');
        
        const code        = codeInput?.value.trim() || '';
        const description = descInput?.value.trim() || '';
        const fabricante  = this.filterChips.fabricante || '';
        const onlyPurchased = this.filterChips.misCompras;
        const soloOfertas   = this.filterChips.oferta;
        const precioDesde   = this.filterChips.precioDesde;
        const precioHasta   = this.filterChips.precioHasta;

        if (!code && !description && !fabricante) {
            window.ui.showToast('Introduce un código, descripción o código de fabricante', 'warning');
            return;
        }

        // Si el filtro de "solo comprados" está activo, verificar que el usuario esté logueado
        if (onlyPurchased && !this.currentUser) {
            window.ui.showToast('Debes iniciar sesión para filtrar por historial', 'warning');
            this.filterChips.misCompras = false;
            document.getElementById('chipMisCompras')?.classList.remove('active');
            return;
        }
        if (onlyPurchased && !this.getEffectiveUserId()) {
            window.ui.showToast('Selecciona un cliente a representar (menú) para ver su historial', 'info');
            this.filterChips.misCompras = false;
            document.getElementById('chipMisCompras')?.classList.remove('active');
            return;
        }

        try {
            let productos = [];
            
            if (onlyPurchased) {
                const effectiveUserId = this.getEffectiveUserId();
                console.log('Buscando en historial de compras (con cache)...');
                const historial = await window.purchaseCache.getUserHistory(
                    effectiveUserId,
                    code || null,
                    description || null
                );
                productos = historial.map(item => ({
                    codigo: item.codigo,
                    descripcion: item.descripcion,
                    pvp: item.pvp,
                    fecha_ultima_compra: item.fecha_ultima_compra
                }));

            } else if (fabricante && !code && !description) {
                // Búsqueda exclusiva por código de fabricante
                console.log('Buscando por cod. fabricante:', fabricante);
                productos = await window.cartManager.searchByManufacturerCode(fabricante);

            } else {
                // Búsqueda en el catálogo completo (código y/o descripción)
                if (code && description) {
                    console.log('Busqueda combinada: descripcion + codigo');
                    const productosPorDescripcion = await window.cartManager.searchByDescriptionAllWords(description);
                    const codeUpper = code.toUpperCase().trim();
                    productos = productosPorDescripcion.filter(p =>
                        p.codigo.toUpperCase().includes(codeUpper)
                    );
                    console.log(`Resultados: ${productosPorDescripcion.length} por descripcion, ${productos.length} con codigo`);
                } else if (code) {
                    productos = await window.cartManager.searchByCodeSmart(code);
                } else if (description) {
                    productos = await window.cartManager.searchByDescriptionAllWords(description);
                }

                // Si además hay filtro de fabricante, cruzamos con sus resultados
                if (fabricante && productos.length > 0) {
                    const porFabricante = await window.cartManager.searchByManufacturerCode(fabricante);
                    const codigosFab = new Set(porFabricante.map(p => p.codigo.toUpperCase()));
                    productos = productos.filter(p => codigosFab.has(p.codigo.toUpperCase()));
                }
            }

            // Filtro de ofertas
            if (soloOfertas && window.cartManager && window.cartManager.db) {
                const codigoCliente = this.getEffectiveGrupoCliente() || null;
                if (codigoCliente) {
                    const ofertasProductos = await window.cartManager.getAllOfertasProductosFromCache(codigoCliente);
                    const codigosConOferta = new Set(ofertasProductos.map(op => op.codigo_articulo.toUpperCase()));
                    productos = productos.filter(p => codigosConOferta.has(p.codigo.toUpperCase()));
                }
            }

            // Filtro de precio (PVP sin IVA; comparamos contra pvp * 1.21 para precio con IVA)
            if (precioDesde !== null) {
                productos = productos.filter(p => (p.pvp || 0) * 1.21 >= precioDesde);
            }
            if (precioHasta !== null) {
                productos = productos.filter(p => (p.pvp || 0) * 1.21 <= precioHasta);
            }

            // Ordenar por stock efectivo descendente (mas stock = mas arriba).
            // Los articulos sin dato de stock van al final.
            if (this.stockIndex.size > 0) {
                productos.sort((a, b) => {
                    const sa = this.getStockEfectivo(a.codigo);
                    const sb = this.getStockEfectivo(b.codigo);
                    const va = sa !== null ? sa : -1;
                    const vb = sb !== null ? sb : -1;
                    return vb - va;
                });
            }

            await this.displaySearchResults(productos, onlyPurchased);
        } catch (error) {
            console.error('Error en busqueda:', error);
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
        const codigoCliente = this.getEffectiveGrupoCliente() || null;
        
        if (codigoCliente && window.cartManager && window.cartManager.db) {
            console.log('Cargando indice de ofertas desde cache local...');
            const inicio = performance.now();
            try {
                // Obtener TODOS los productos en ofertas de UNA SOLA VEZ desde IndexedDB
                const ofertasProductosCache = await window.cartManager.getAllOfertasProductosFromCache(codigoCliente);
                for (const op of ofertasProductosCache) {
                    productosConOfertas.add(op.codigo_articulo.toUpperCase());
                }
                const tiempo = (performance.now() - inicio).toFixed(0);
                console.log(`Indice de ofertas cargado en ${tiempo}ms: ${productosConOfertas.size} productos con ofertas`);
            } catch (error) {
                console.error('Error al cargar indice de ofertas:', error);
            }
        }

        // Refrescar indice de stock en memoria antes de renderizar (es un Map, muy rapido)
        if (this.stockIndex.size === 0 && window.cartManager && window.cartManager.db) {
            this.stockIndex = await window.cartManager.getStockIndex();
        }

        resultsList.innerHTML = productosLimitados.map(producto => {
            const priceWithIVA = producto.pvp * 1.21;
            const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo}_1.JPG`;
            const escapedDescripcion = this.escapeForHtmlAttribute(producto.descripcion);
            
            // Añadir indicador de oferta al código si tiene ofertas
            const tieneOferta = productosConOfertas.has(producto.codigo.toUpperCase());
            const codigoConOferta = tieneOferta 
                ? `${producto.codigo} - <span class="oferta-tag">[OFERTA]</span>` 
                : producto.codigo;

            // Badge de stock
            const stockBadge = this.buildStockBadgeHtml(producto.codigo);
            
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
                                <span class="result-last-purchase">Ultima compra: ${fechaFormateada}</span>
                                ${stockBadge}
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
                        ${stockBadge ? `<div class="result-stock">${stockBadge}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Comprueba qué imágenes del producto existen (_1 a _4) y devuelve array de URLs
     */
    async getAvailableProductImageUrls(codigo) {
        const baseUrl = 'https://www.saneamiento-martinez.com/imagenes/articulos/';
        const urls = [];
        const check = (i) => new Promise((resolve) => {
            const url = baseUrl + codigo + '_' + i + '.JPG';
            const img = new Image();
            img.onload = () => { urls.push(url); resolve(); };
            img.onerror = () => resolve();
            img.src = url;
        });
        await Promise.all([check(1), check(2), check(3), check(4)]);
        return urls;
    }

    /**
     * Abre el overlay de detalle de producto (carousel 1-4 imágenes)
     */
    async openProductDetail(producto) {
        if (this._productDetailCleanup) {
            this._productDetailCleanup();
            this._productDetailCleanup = null;
        }
        const overlayEl = document.getElementById('productDetailOverlay');
        const carouselInner = document.getElementById('productDetailCarouselInner');
        const prevBtn = document.getElementById('productDetailCarouselPrev');
        const nextBtn = document.getElementById('productDetailCarouselNext');
        const dotsContainer = document.getElementById('productDetailCarouselDots');
        const codeEl = document.getElementById('productDetailCode');
        const descEl = document.getElementById('productDetailDescription');
        const closeBtn = document.getElementById('closeProductDetailBtn');
        const backdrop = overlayEl ? overlayEl.querySelector('.product-detail-backdrop') : null;

        if (!overlayEl || !carouselInner) return;

        codeEl.textContent = producto.codigo;
        descEl.textContent = producto.descripcion || '';

        const recambiosActionsEl = document.getElementById('productDetailRecambiosActions');
        const verRecambiosBtn = document.getElementById('productDetailVerRecambiosBtn');
        const sirveParaBtn = document.getElementById('productDetailSirveParaBtn');

        let recambiosData = [];
        let padresData = [];
        try {
            const [recambios, padres] = await Promise.all([
                window.supabaseClient.getRecambiosDeProducto(producto.codigo),
                window.supabaseClient.getPadresDeRecambio(producto.codigo)
            ]);
            recambiosData = recambios || [];
            padresData = padres || [];
        } catch (e) {
            console.error('Error cargando recambios/padres:', e);
        }

        if (recambiosActionsEl && (recambiosData.length > 0 || padresData.length > 0)) {
            recambiosActionsEl.style.display = 'flex';
            if (verRecambiosBtn) verRecambiosBtn.style.display = recambiosData.length > 0 ? 'inline-block' : 'none';
            if (sirveParaBtn) sirveParaBtn.style.display = padresData.length > 0 ? 'inline-block' : 'none';
        } else if (recambiosActionsEl) {
            recambiosActionsEl.style.display = 'none';
        }

        const imageUrls = await this.getAvailableProductImageUrls(producto.codigo);
        carouselInner.innerHTML = '';
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        dotsContainer.innerHTML = '';

        if (imageUrls.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'product-detail-carousel-placeholder';
            placeholder.style.cssText = 'font-size: 3rem; opacity: 0.4; padding: 2rem;';
            placeholder.textContent = '\uD83D\uDCE6';
            carouselInner.appendChild(placeholder);
        } else {
            imageUrls.forEach((url, idx) => {
                const slide = document.createElement('div');
                slide.className = 'product-detail-carousel-slide' + (idx === 0 ? ' active' : '');
                slide.dataset.index = String(idx);
                const img = document.createElement('img');
                img.src = url;
                img.alt = producto.descripcion ? producto.descripcion + ' (imagen ' + (idx + 1) + ')' : 'Imagen ' + (idx + 1);
                slide.appendChild(img);
                carouselInner.appendChild(slide);
            });
            if (imageUrls.length > 1) {
                prevBtn.style.display = 'flex';
                nextBtn.style.display = 'flex';
                imageUrls.forEach((_, idx) => {
                    const dot = document.createElement('button');
                    dot.type = 'button';
                    dot.className = 'product-detail-carousel-dot' + (idx === 0 ? ' active' : '');
                    dot.setAttribute('aria-label', 'Imagen ' + (idx + 1));
                    dot.dataset.index = String(idx);
                    dotsContainer.appendChild(dot);
                });
            }
        }

        overlayEl.style.display = 'flex';
        overlayEl.setAttribute('aria-hidden', 'false');

        const controlsRow = document.getElementById('productDetailCarouselControls');
        if (controlsRow) controlsRow.style.display = imageUrls.length > 1 ? 'flex' : 'none';

        const onVerRecambiosClick = () => {
            handleClose();
            const addToCartModal = document.getElementById('addToCartModal');
            if (addToCartModal) addToCartModal.style.display = 'none';
            this.recambiosVistaReturnScreen = this.currentScreen;
            this.openRecambiosVistaPage(producto, 'recambios');
        };
        const onSirveParaClick = () => {
            handleClose();
            const addToCartModal = document.getElementById('addToCartModal');
            if (addToCartModal) addToCartModal.style.display = 'none';
            this.recambiosVistaReturnScreen = this.currentScreen;
            this.openRecambiosVistaPage(producto, 'sirvePara');
        };

        if (verRecambiosBtn && recambiosData.length > 0) verRecambiosBtn.addEventListener('click', onVerRecambiosClick);
        if (sirveParaBtn && padresData.length > 0) sirveParaBtn.addEventListener('click', onSirveParaClick);

        let currentIndex = 0;
        let currentScale = 1;
        const total = imageUrls.length;
        const MIN_ZOOM = 1;
        const MAX_ZOOM = 4;

        const getActiveSlide = () => carouselInner.querySelector('.product-detail-carousel-slide.active');
        const getActiveImg = () => {
            const slide = getActiveSlide();
            return slide ? slide.querySelector('img') : null;
        };

        const setZoom = (scale) => {
            const img = getActiveImg();
            if (img) img.style.transform = 'scale(' + Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale)) + ')';
        };

        const resetZoom = () => {
            carouselInner.querySelectorAll('.product-detail-carousel-slide img').forEach(function (im) {
                im.style.transform = 'scale(1)';
            });
        };

        const showSlide = (index) => {
            const slides = carouselInner.querySelectorAll('.product-detail-carousel-slide');
            const dots = dotsContainer.querySelectorAll('.product-detail-carousel-dot');
            slides.forEach(function (s, i) { s.classList.toggle('active', i === index); });
            dots.forEach(function (dot, i) { dot.classList.toggle('active', i === index); });
            currentIndex = index;
            currentScale = 1;
            resetZoom();
        };

        const handlePrev = () => {
            if (total <= 1) return;
            currentIndex = currentIndex <= 0 ? total - 1 : currentIndex - 1;
            showSlide(currentIndex);
        };
        const handleNext = () => {
            if (total <= 1) return;
            currentIndex = currentIndex >= total - 1 ? 0 : currentIndex + 1;
            showSlide(currentIndex);
        };

        const handleDotClick = (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            if (!isNaN(idx)) showSlide(idx);
        };

        var touchStartX = 0;
        var touchStartY = 0;
        var touchStartDist = 0;
        var touchStartScale = 1;
        var isPinching = false;

        const handleTouchStart = function (e) {
            if (e.touches.length === 2) {
                isPinching = true;
                touchStartDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
                touchStartScale = currentScale;
            } else if (e.touches.length === 1) {
                isPinching = false;
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }
        };

        const handleTouchMove = function (e) {
            if (e.touches.length === 2 && isPinching) {
                e.preventDefault();
                var dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
                if (touchStartDist > 0) {
                    currentScale = touchStartScale * (dist / touchStartDist);
                    setZoom(currentScale);
                }
            }
        };

        const handleTouchEnd = function (e) {
            if (e.changedTouches.length === 1 && !isPinching && e.touches.length === 0) {
                var dx = e.changedTouches[0].clientX - touchStartX;
                var dy = e.changedTouches[0].clientY - touchStartY;
                if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                    e.preventDefault();
                    if (dx > 0) handlePrev();
                    else handleNext();
                }
            }
            if (e.touches.length < 2) {
                isPinching = false;
                var img = getActiveImg();
                if (img) {
                    var t = img.style.transform || 'scale(1)';
                    var m = t.match(/scale\(([^)]+)\)/);
                    currentScale = m ? parseFloat(m[1]) : 1;
                }
            }
        };

        carouselInner.addEventListener('touchstart', handleTouchStart, { passive: true });
        carouselInner.addEventListener('touchmove', handleTouchMove, { passive: false });
        carouselInner.addEventListener('touchend', handleTouchEnd, { passive: false });

        const handleClose = () => {
            if (overlayEl.contains(document.activeElement)) {
                document.activeElement.blur();
            }
            overlayEl.style.display = 'none';
            overlayEl.setAttribute('aria-hidden', 'true');
            this._productDetailCleanup = null;
            closeBtn.removeEventListener('click', handleClose);
            if (backdrop) backdrop.removeEventListener('click', handleClose);
            if (verRecambiosBtn && recambiosData.length > 0) verRecambiosBtn.removeEventListener('click', onVerRecambiosClick);
            if (sirveParaBtn && padresData.length > 0) sirveParaBtn.removeEventListener('click', onSirveParaClick);
            prevBtn.removeEventListener('click', handlePrev);
            nextBtn.removeEventListener('click', handleNext);
            dotsContainer.querySelectorAll('.product-detail-carousel-dot').forEach(function (dot) {
                dot.removeEventListener('click', handleDotClick);
            });
            carouselInner.removeEventListener('touchstart', handleTouchStart);
            carouselInner.removeEventListener('touchmove', handleTouchMove);
            carouselInner.removeEventListener('touchend', handleTouchEnd);
        };

        closeBtn.addEventListener('click', handleClose);
        if (backdrop) backdrop.addEventListener('click', handleClose);
        prevBtn.addEventListener('click', handlePrev);
        nextBtn.addEventListener('click', handleNext);
        dotsContainer.querySelectorAll('.product-detail-carousel-dot').forEach(function (dot) {
            dot.addEventListener('click', handleDotClick);
        });

        // Guardar referencia para que la proxima llamada pueda cerrar esta invocacion
        this._productDetailCleanup = handleClose;
    }

    /**
     * Muestra el modal de añadir al carrito con selección de cantidad
     */
    async showAddToCartModal(producto) {
        if (this._addToCartModalCleanup) {
            this._addToCartModalCleanup();
            this._addToCartModalCleanup = null;
        }
        return new Promise(async (resolve) => {
            const modal = document.getElementById('addToCartModal');
            const overlay = modal.querySelector('.add-to-cart-overlay');
            const closeBtn = document.getElementById('closeAddToCartModal');
            const imageContainer = modal.querySelector('.add-to-cart-image-container');
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

            // Verificar si el producto tiene ofertas (solo para usuarios con grupo_cliente)
            let ofertaData = null;
            const codigoCliente = this.getEffectiveGrupoCliente() || null;
            
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

            const wcConjuntosBlock = document.getElementById('addToCartWcConjuntos');
            const wcConjuntosLabels = document.getElementById('addToCartWcConjuntosLabels');
            let conjuntos = [];
            try {
                conjuntos = await window.supabaseClient.getWcConjuntosByProductoCodigo(producto.codigo) || [];
            } catch (e) {
                console.error('Error getWcConjuntosByProductoCodigo:', e);
            }
            if (wcConjuntosBlock && wcConjuntosLabels) {
                if (conjuntos.length === 0) {
                    wcConjuntosBlock.style.display = 'none';
                } else {
                    wcConjuntosBlock.style.display = 'block';
                    wcConjuntosLabels.innerHTML = conjuntos.map(function (c) {
                        const id = this.escapeForHtmlAttribute(c.id);
                        const nombre = this.escapeForHtmlAttribute((c.nombre || '').trim() || c.id);
                        return '<button type="button" class="product-detail-wc-conjunto-label" data-conjunto-id="' + id + '">' + nombre + '</button>';
                    }.bind(this)).join('');
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
                this._addToCartModalCleanup = null;
                resolve(null);
            };

            const handleConfirm = async () => {
                const cantidad = parseInt(qtyInput.value) || 1;
                modal.style.display = 'none';
                cleanup();
                this._addToCartModalCleanup = null;
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

            const handleImageClick = () => {
                this.openProductDetail(producto);
            };

            const handleWcConjuntoLabelClick = (e) => {
                const btn = e.target.closest('.product-detail-wc-conjunto-label');
                if (!btn) return;
                const conjuntoId = btn.getAttribute('data-conjunto-id');
                modal.style.display = 'none';
                cleanup();
                resolve(null);
                if (conjuntoId) this.openWcCompletoWithConjunto(conjuntoId);
            };

            const cleanup = () => {
                closeBtn.removeEventListener('click', handleClose);
                overlay.removeEventListener('click', handleClose);
                if (imageContainer) imageContainer.removeEventListener('click', handleImageClick);
                if (wcConjuntosLabels && conjuntos.length > 0) wcConjuntosLabels.removeEventListener('click', handleWcConjuntoLabelClick);
                confirmBtn.removeEventListener('click', handleConfirm);
                decreaseBtn.removeEventListener('click', handleDecrease);
                increaseBtn.removeEventListener('click', handleIncrease);
                qtyInput.removeEventListener('input', handleInputChange);
                qtyInput.removeEventListener('focus', handleFocus);
                qtyInput.removeEventListener('keypress', handleKeyPress);
            };

            // Añadir listeners
            closeBtn.addEventListener('click', handleClose);
            overlay.addEventListener('click', handleClose);
            if (imageContainer) imageContainer.addEventListener('click', handleImageClick);
            if (wcConjuntosLabels && conjuntos.length > 0) wcConjuntosLabels.addEventListener('click', handleWcConjuntoLabelClick);
            confirmBtn.addEventListener('click', handleConfirm);
            decreaseBtn.addEventListener('click', handleDecrease);
            increaseBtn.addEventListener('click', handleIncrease);
            qtyInput.addEventListener('input', handleInputChange);
            qtyInput.addEventListener('focus', handleFocus);
            qtyInput.addEventListener('keypress', handleKeyPress);

            // Guardar referencia para que la proxima llamada pueda limpiar esta invocacion
            this._addToCartModalCleanup = handleClose;
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
            
            // Actualizar badges de stock en los resultados visibles
            this.updateStockBadgesVisibles();

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

        // Resetear chips activos
        this.filterChips.misCompras  = false;
        this.filterChips.oferta      = false;
        this.filterChips.fabricante  = '';
        this.filterChips.precioDesde = null;
        this.filterChips.precioHasta = null;
        this._closeChipConfig();

        document.getElementById('chipMisCompras')?.classList.remove('active');
        document.getElementById('chipOferta')?.classList.remove('active');
        document.getElementById('chipFabricante')?.classList.remove('active');
        document.getElementById('chipPrecio')?.classList.remove('active');

        const labelFab   = document.getElementById('chipFabricanteLabel');
        const labelPrecio = document.getElementById('chipPrecioLabel');
        if (labelFab)   labelFab.textContent   = 'Ref. fabricante';
        if (labelPrecio) labelPrecio.textContent = 'Precio';

        const fabricanteInput  = document.getElementById('fabricanteSearchInput');
        const precioDesdeInput = document.getElementById('precioDesdeInput');
        const precioHastaInput = document.getElementById('precioHastaInput');
        if (fabricanteInput)  fabricanteInput.value  = '';
        if (precioDesdeInput) precioDesdeInput.value = '';
        if (precioHastaInput) precioHastaInput.value = '';

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
            
            // Invalidar cache de historial para el usuario efectivo (puede ser cliente representado por comercial)
            if (this.currentUser && window.purchaseCache) {
                const effectiveId = this.getEffectiveUserId() || this.currentUser.user_id;
                window.purchaseCache.invalidateUser(effectiveId);
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
        if (this._updatingCartView) {
            return;
        }
        this._updatingCartView = true;
        try {
            await this._updateCartViewCore();
        } finally {
            this._updatingCartView = false;
        }
    }

    async _updateCartViewCore() {
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

        // Asegurar indice de stock para mostrar desglose por almacen en las tarjetas
        if (this.stockIndex.size === 0 && window.cartManager && window.cartManager.db) {
            this.stockIndex = await window.cartManager.getStockIndex();
        }

        // Precalcular mapa de ofertas por codigo (una sola pasada) para evitar O(N^2) llamadas
        const codigoCliente = this.getEffectiveGrupoCliente() || null;
        const ofertasByCodigo = new Map();
        const intervalosCache = {};
        const loteCache = {};
        if (codigoCliente && window.supabaseClient) {
            const codigosUnicos = [...new Set(cart.productos.map(p => p.codigo_producto))];
            for (const codigo of codigosUnicos) {
                const ofertas = await window.supabaseClient.getOfertasProducto(codigo, codigoCliente, true);
                if (ofertas && ofertas.length > 0) {
                    ofertasByCodigo.set(codigo, ofertas);
                }
            }
        }

        // Verificar si necesitamos regenerar todo o solo actualizar
        const existingCards = container.querySelectorAll('.cart-product-card');
        const needsFullRefresh = existingCards.length !== cart.productos.length;

        if (needsFullRefresh) {
            // Solo regenerar todo si cambió el número de productos
            container.innerHTML = '';
            for (const producto of cart.productos) {
                const card = await this.createCartProductCard(producto, ofertasByCodigo, intervalosCache, loteCache);
                container.appendChild(card);
            }
        } else {
            // Actualizar solo los valores sin regenerar el DOM
            for (let i = 0; i < cart.productos.length; i++) {
                const producto = cart.productos[i];
                const card = existingCards[i];
                
                // Actualizar solo los elementos que pueden cambiar
                await this.updateCartProductCard(card, producto, ofertasByCodigo, intervalosCache, loteCache);
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
     * @param {Map} [ofertasByCodigo] - Mapa codigo -> ofertas[] (precalculado para no repetir lecturas)
     * @param {Object} [intervalosCache] - Cache numero_oferta -> intervalos
     * @param {Object} [loteCache] - Cache numero_oferta -> unidadesLote
     * @returns {Object} { cumplida: boolean, mensaje: string }
     */
    async verificarOfertaCumplida(oferta, codigoArticulo, cantidad, carrito, ofertasByCodigo, intervalosCache, loteCache) {
        try {
            const tipoOferta = oferta.tipo_oferta;
            const getOfertasProd = async (codigo) => {
                if (ofertasByCodigo && ofertasByCodigo.has(codigo)) return ofertasByCodigo.get(codigo);
                return await window.supabaseClient.getOfertasProducto(codigo, this.getEffectiveGrupoCliente() || null, true);
            };

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
                let intervalos = intervalosCache && intervalosCache[oferta.numero_oferta];
                if (!intervalos) {
                    intervalos = await window.supabaseClient.getIntervalosOferta(oferta.numero_oferta, true);
                    if (intervalosCache) intervalosCache[oferta.numero_oferta] = intervalos;
                }
                if (!intervalos || intervalos.length === 0) {
                    return { cumplida: false, mensaje: oferta.titulo_descripcion || 'Oferta por intervalo (sin intervalos definidos)' };
                }
                
                // Ordenar intervalos por desde_unidades
                const intervalosOrdenados = intervalos.sort((a, b) => a.desde_unidades - b.desde_unidades);
                
                // Sumar unidades de todos los productos de esta oferta en el carrito
                let totalUnidades = 0;
                for (const prod of carrito.productos) {
                    const ofertasProd = await getOfertasProd(prod.codigo_producto);
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
                let unidadesLote = loteCache && loteCache[oferta.numero_oferta];
                if (unidadesLote === undefined) {
                    unidadesLote = await window.supabaseClient.getLoteOferta(oferta.numero_oferta, true);
                    if (loteCache) loteCache[oferta.numero_oferta] = unidadesLote;
                }
                if (!unidadesLote) {
                    return { cumplida: false, mensaje: oferta.titulo_descripcion || 'Oferta por lote' };
                }
                
                // Sumar unidades de todos los productos de esta oferta en el carrito
                let totalUnidades = 0;
                for (const prod of carrito.productos) {
                    const ofertasProd = await getOfertasProd(prod.codigo_producto);
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
     * @param {Map} [ofertasByCodigo] - Mapa codigo -> ofertas[] (precalculado)
     * @param {Object} [intervalosCache] - Cache numero_oferta -> intervalos
     * @param {Object} [loteCache] - Cache numero_oferta -> unidadesLote
     * @returns {Promise<{descuento: number, factor: number}>} - Porcentaje y factor de aplicación
     */
    async calcularDescuentoOferta(oferta, producto, carrito, ofertasByCodigo, intervalosCache, loteCache) {
        try {
            const tipoOferta = oferta.tipo_oferta;
            const codigoCliente = this.getEffectiveGrupoCliente() || null;
            const getOfertasProd = async (codigo) => {
                if (ofertasByCodigo && ofertasByCodigo.has(codigo)) return ofertasByCodigo.get(codigo);
                return await window.supabaseClient.getOfertasProducto(codigo, codigoCliente, true);
            };

            // ESTANDAR: Aplica a todas las unidades si se cumple el mínimo
            if (tipoOferta === 1) {
                return {
                    descuento: oferta.descuento_oferta || 0,
                    factor: 1.0 // 100% de las unidades
                };
            }
            
            // INTERVALO: buscar el descuento del intervalo correspondiente
            if (tipoOferta === 2) {
                let intervalos = intervalosCache && intervalosCache[oferta.numero_oferta];
                if (!intervalos) {
                    intervalos = await window.supabaseClient.getIntervalosOferta(oferta.numero_oferta, true);
                    if (intervalosCache) intervalosCache[oferta.numero_oferta] = intervalos;
                }
                if (!intervalos || intervalos.length === 0) {
                    return { descuento: 0, factor: 0 };
                }
                
                // Ordenar intervalos
                const intervalosOrdenados = intervalos.sort((a, b) => a.desde_unidades - b.desde_unidades);
                
                // Calcular total de unidades de la oferta en el carrito
                let totalUnidades = 0;
                
                for (const prod of carrito.productos) {
                    const ofertasProd = await getOfertasProd(prod.codigo_producto);
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
                    return {
                        descuento: intervaloActual.descuento_porcentaje || 0,
                        factor: 1.0 // Aplica a todas las unidades del intervalo
                    };
                } else {
                    // Si está por encima del último intervalo, aplicar el descuento máximo
                    const ultimoIntervalo = intervalosOrdenados[intervalosOrdenados.length - 1];
                    if (totalUnidades > ultimoIntervalo.hasta_unidades) {
                        return {
                            descuento: ultimoIntervalo.descuento_porcentaje || 0,
                            factor: 1.0
                        };
                    }
                }
            }
            
            // LOTE: Aplica solo a lotes completos
            if (tipoOferta === 3) {
                let unidadesLote = loteCache && loteCache[oferta.numero_oferta];
                if (unidadesLote === undefined) {
                    unidadesLote = await window.supabaseClient.getLoteOferta(oferta.numero_oferta, true);
                    if (loteCache) loteCache[oferta.numero_oferta] = unidadesLote;
                }
                if (!unidadesLote) return { descuento: 0, factor: 0 };
                
                // Calcular total de unidades de la oferta en el carrito
                let totalUnidades = 0;
                
                for (const prod of carrito.productos) {
                    const ofertasProd = await getOfertasProd(prod.codigo_producto);
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
     * @param {Map} [ofertasByCodigo] - Mapa precalculado codigo -> ofertas[]
     * @param {Object} [intervalosCache] - Cache numero_oferta -> intervalos
     * @param {Object} [loteCache] - Cache numero_oferta -> unidadesLote
     */
    async updateCartProductCard(card, producto, ofertasByCodigo, intervalosCache, loteCache) {
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
        const codigoCliente = this.getEffectiveGrupoCliente() || null;
        let precioConDescuento = priceWithIVA;
        let subtotalConDescuento = subtotalWithIVA;
        let descuentoAplicado = 0;
        let precioNetoOfertaAplicado = false;
        let ofertaActiva = null;
        let resultadoOferta = null;
        
        if (codigoCliente) {
            const ofertas = (ofertasByCodigo && ofertasByCodigo.get(producto.codigo_producto)) ||
                await window.supabaseClient.getOfertasProducto(producto.codigo_producto, codigoCliente, true);
            if (ofertas && ofertas.length > 0) {
                ofertaActiva = ofertas[0];
                const carrito = window.cartManager.getCart();
                resultadoOferta = await this.verificarOfertaCumplida(ofertaActiva, producto.codigo_producto, producto.cantidad, carrito, ofertasByCodigo, intervalosCache, loteCache);
                
                if (resultadoOferta && resultadoOferta.cumplida) {
                    const precioNetoOferta = ofertaActiva.precio != null && ofertaActiva.precio !== '' && parseFloat(ofertaActiva.precio) > 0 ? parseFloat(ofertaActiva.precio) : 0;
                    if (precioNetoOferta > 0) {
                        precioConDescuento = precioNetoOferta * 1.21;
                        subtotalConDescuento = precioConDescuento * producto.cantidad;
                        precioNetoOfertaAplicado = true;
                    } else {
                        const { descuento, factor } = await this.calcularDescuentoOferta(ofertaActiva, producto, carrito, ofertasByCodigo, intervalosCache, loteCache);
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
        }
        
        // Actualizar badge de oferta
        const ofertaBadge = card.querySelector('.oferta-badge');
        if (ofertaActiva && resultadoOferta) {
            if (ofertaBadge) {
                ofertaBadge.textContent = resultadoOferta.mensaje;
                ofertaBadge.className = `oferta-badge ${resultadoOferta.cumplida ? 'oferta-cumplida' : 'oferta-pendiente'}`;
            }
        }
        
        // Actualizar precios (descuento % o precio neto de oferta)
        const mostrarPrecioOferta = descuentoAplicado > 0 || precioNetoOfertaAplicado;
        const badgeTexto = precioNetoOfertaAplicado ? 'Precio oferta' : (descuentoAplicado > 0 ? `-${descuentoAplicado}%` : '');
        if (mostrarPrecioOferta) {
            const priceContainer = card.querySelector('.cart-product-price-container, .cart-product-price');
            if (priceContainer) {
                priceContainer.innerHTML = `
                    <div class="cart-product-price-original">${priceWithIVA.toFixed(2)} €</div>
                    <div class="cart-product-price-discount">${precioConDescuento.toFixed(2)} €${badgeTexto ? ` <span class="discount-badge">${badgeTexto}</span>` : ''}</div>
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
     * @param {Map} [ofertasByCodigo] - Mapa precalculado codigo -> ofertas[]
     * @param {Object} [intervalosCache] - Cache numero_oferta -> intervalos
     * @param {Object} [loteCache] - Cache numero_oferta -> unidadesLote
     */
    async createCartProductCard(producto, ofertasByCodigo, intervalosCache, loteCache) {
        const card = document.createElement('div');
        card.className = 'cart-product-card';

        const priceWithIVA = producto.precio_unitario * 1.21;
        const subtotalWithIVA = producto.subtotal * 1.21;

        const imageUrl = `https://www.saneamiento-martinez.com/imagenes/articulos/${producto.codigo_producto}_1.JPG`;
        
        // Obtener ofertas del producto (mapa precalculado o cache)
        const codigoCliente = this.getEffectiveGrupoCliente() || null;
        let resultadoOferta = null;
        let ofertaActiva = null;
        let precioConDescuento = priceWithIVA;
        let subtotalConDescuento = subtotalWithIVA;
        let descuentoAplicado = 0;
        let precioNetoOfertaAplicado = false;
        
        if (codigoCliente) {
            const ofertas = (ofertasByCodigo && ofertasByCodigo.get(producto.codigo_producto)) ||
                await window.supabaseClient.getOfertasProducto(producto.codigo_producto, codigoCliente, true);
            if (ofertas && ofertas.length > 0) {
                ofertaActiva = ofertas[0];
                const carrito = window.cartManager.getCart();
                resultadoOferta = await this.verificarOfertaCumplida(ofertaActiva, producto.codigo_producto, producto.cantidad, carrito, ofertasByCodigo, intervalosCache, loteCache);
                if (resultadoOferta && resultadoOferta.cumplida) {
                    const precioNetoOferta = ofertaActiva.precio != null && ofertaActiva.precio !== '' && parseFloat(ofertaActiva.precio) > 0 ? parseFloat(ofertaActiva.precio) : 0;
                    if (precioNetoOferta > 0) {
                        precioConDescuento = precioNetoOferta * 1.21;
                        subtotalConDescuento = precioConDescuento * producto.cantidad;
                        precioNetoOfertaAplicado = true;
                    } else {
                        const { descuento, factor } = await this.calcularDescuentoOferta(ofertaActiva, producto, carrito, ofertasByCodigo, intervalosCache, loteCache);
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
        }
        
        // Generar HTML del rectángulo de oferta con mensaje inteligente
        let ofertaHTML = '';
        if (ofertaActiva && resultadoOferta) {
            const claseOferta = resultadoOferta.cumplida ? 'oferta-cumplida' : 'oferta-pendiente';
            ofertaHTML = `<div class="oferta-badge ${claseOferta}" onclick="event.stopPropagation(); window.app.verProductosOfertaDesdeCarrito('${ofertaActiva.numero_oferta}')">${this.escapeForHtmlAttribute(resultadoOferta.mensaje)}</div>`;
        }
        
        // Generar HTML del precio (descuento % o precio neto de oferta)
        const mostrarPrecioOferta = descuentoAplicado > 0 || precioNetoOfertaAplicado;
        const badgeTexto = precioNetoOfertaAplicado ? 'Precio oferta' : (descuentoAplicado > 0 ? `-${descuentoAplicado}%` : '');
        let precioHTML = '';
        let subtotalHTML = '';
        if (mostrarPrecioOferta) {
            precioHTML = `
                <div class="cart-product-price-container">
                    <div class="cart-product-price-original">${priceWithIVA.toFixed(2)} €</div>
                    <div class="cart-product-price-discount">${precioConDescuento.toFixed(2)} €${badgeTexto ? ` <span class="discount-badge">${badgeTexto}</span>` : ''}</div>
                </div>
            `;
            subtotalHTML = `
                <div class="cart-product-subtotal-container">
                    <div class="cart-product-subtotal-original">${subtotalWithIVA.toFixed(2)} €</div>
                    <div class="cart-product-subtotal-discount">${subtotalConDescuento.toFixed(2)} €</div>
                </div>
            `;
        } else {
            precioHTML = `<div class="cart-product-price">${priceWithIVA.toFixed(2)} €</div>`;
            subtotalHTML = `<div class="cart-product-subtotal">${subtotalWithIVA.toFixed(2)} €</div>`;
        }

        // Determinar si hay oferta para ajustar el layout
        const footerClass = ofertaHTML ? 'cart-product-footer has-oferta' : 'cart-product-footer';

        const stockBreakdownHtml = this.buildStockBreakdownByAlmacenHtml(producto.codigo_producto);

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
                        ${stockBreakdownHtml ? `<div class="cart-product-stock">${stockBreakdownHtml}</div>` : ''}
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
            this.updateStockBadgesVisibles();
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
            this.updateStockBadgesVisibles();
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

            // Obtener historial del usuario (o del cliente representado si es comercial)
            const userId = this.getEffectiveUserId();
            if (!userId) {
                if (loadingState) loadingState.style.display = 'none';
                this.showHistoryEmptyState();
                return;
            }
            const historial = await window.supabaseClient.getUserPurchaseHistory(userId);

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
        if (!this.getEffectiveUserId()) {
            window.ui.showToast('Selecciona un cliente a representar (menú)', 'info');
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
                this.getEffectiveUserId(),
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

        if (this.currentUser.is_comercial && !this.currentUser.cliente_representado_id) {
            window.ui.showToast('Selecciona el cliente al que representas para poder enviar el pedido', 'warning');
            this.showScreen('selectorCliente');
            this.renderSelectorClienteScreen();
            return;
        }

        const container = document.querySelector('.almacen-options');
        if (container) {
            const allAlmacenes = ['ALZIRA', 'GANDIA', 'ONTINYENT', 'REQUENA'];
            const habitual = this.getEffectiveAlmacenHabitual() ? this.getEffectiveAlmacenHabitual().toUpperCase().trim() : null;
            const orden = habitual && allAlmacenes.includes(habitual)
                ? [habitual].concat(allAlmacenes.filter(a => a !== habitual).sort())
                : allAlmacenes.slice().sort();
            const buttonsByAlmacen = {};
            container.querySelectorAll('.almacen-btn').forEach(btn => {
                const a = btn.dataset.almacen;
                if (a) buttonsByAlmacen[a] = btn;
            });
            orden.forEach(almacen => {
                if (buttonsByAlmacen[almacen]) container.appendChild(buttonsByAlmacen[almacen]);
            });
        }

        const almacenButtons = document.querySelectorAll('.almacen-btn');
        const almacenHabitualForModal = this.getEffectiveAlmacenHabitual();
        almacenButtons.forEach(btn => {
            btn.classList.remove('selected');
            if (almacenHabitualForModal && btn.dataset.almacen === almacenHabitualForModal) {
                btn.classList.add('selected');
            }
        });

        this.hideAlmacenObservacionesModal();

        const almacenModal = document.getElementById('almacenModal');
        if (almacenModal) {
            almacenModal.style.display = 'flex';
        }
    }

    /**
     * Muestra el modal centrado de observaciones para Recoger en Almacén.
     * Si el almacén elegido no es el habitual del cliente, muestra advertencia en rojo.
     * @param {string} almacen - Código del almacén seleccionado (ONTINYENT, GANDIA, etc.)
     */
    showAlmacenObservacionesModal(almacen) {
        const modal = document.getElementById('almacenObservacionesModal');
        if (!modal) return;
        modal.setAttribute('data-selected-almacen', almacen);

        const titleEl = document.getElementById('almacenObservacionesModalTitle');
        if (titleEl) {
            titleEl.textContent = 'RECOGER EN ' + (almacen || '').toUpperCase();
        }

        const advertenciaEl = document.getElementById('almacenObservacionesAdvertencia');
        const esAlmacenHabitual = this.getEffectiveAlmacenHabitual() && this.getEffectiveAlmacenHabitual() === almacen;
        if (advertenciaEl) {
            if (esAlmacenHabitual) {
                advertenciaEl.style.display = 'none';
                advertenciaEl.textContent = '';
            } else {
                advertenciaEl.textContent = '¿Estás seguro de que quieres recoger tu pedido en ' + almacen + '?';
                advertenciaEl.style.display = 'block';
            }
        }

        const input = document.getElementById('almacenObservacionesInput');
        if (input) {
            input.value = '';
        }

        const almacenModal = document.getElementById('almacenModal');
        if (almacenModal) {
            almacenModal.style.display = 'none';
        }
        modal.style.display = 'flex';
        if (input) {
            setTimeout(function () { input.focus(); }, 100);
        }
    }

    /**
     * Oculta el modal de observaciones de Recoger en Almacén y limpia su estado
     */
    hideAlmacenObservacionesModal() {
        const modal = document.getElementById('almacenObservacionesModal');
        if (modal) {
            modal.style.display = 'none';
            modal.removeAttribute('data-selected-almacen');
        }
        const input = document.getElementById('almacenObservacionesInput');
        if (input) {
            input.value = '';
        }
    }

    /**
     * Oculta el modal de selección de almacén y el modal de observaciones
     */
    hideAlmacenModal() {
        const almacenModal = document.getElementById('almacenModal');
        if (almacenModal) {
            almacenModal.style.display = 'none';
        }
        this.hideAlmacenObservacionesModal();
        document.querySelectorAll('.almacen-btn').forEach(btn => btn.classList.remove('selected'));
    }

    /**
     * Muestra el modal Enviar en Ruta (almacén predeterminado del cliente)
     */
    showEnviarEnRutaModal() {
        if (!this.currentUser) {
            window.ui.showToast('Debes iniciar sesion para enviar pedidos', 'warning');
            return;
        }
        const cart = window.cartManager.getCart();
        if (!cart || cart.productos.length === 0) {
            window.ui.showToast('El carrito esta vacio', 'warning');
            return;
        }
        if (this.currentUser.is_comercial && !this.currentUser.cliente_representado_id) {
            window.ui.showToast('Selecciona el cliente al que representas para poder enviar el pedido', 'warning');
            this.showScreen('selectorCliente');
            this.renderSelectorClienteScreen();
            return;
        }
        if (!this.getEffectiveAlmacenHabitual()) {
            window.ui.showToast('No tienes almacen habitual asignado. Contacta con tu comercial.', 'warning');
            return;
        }
        const input = document.getElementById('enviarEnRutaObservacionesInput');
        if (input) {
            input.value = '';
        }
        const modal = document.getElementById('enviarEnRutaModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    /**
     * Oculta el modal Enviar en Ruta
     */
    hideEnviarEnRutaModal() {
        const modal = document.getElementById('enviarEnRutaModal');
        if (modal) {
            modal.style.display = 'none';
        }
        const input = document.getElementById('enviarEnRutaObservacionesInput');
        if (input) {
            input.value = '';
        }
    }

    /**
     * Construye el payload del pedido para el ERP.
     * codigoClienteUsuario: valor de carritos_clientes.codigo_cliente_usuario (usuarios.codigo_usuario al crear el pedido).
     * serie = almacen destino (donde recoge). centro_venta = almacen habitual del cliente.
     */
    buildErpOrderPayload(cart, almacen, referencia, observaciones, codigoClienteUsuario) {
        const almacenHabitual = this.getEffectiveAlmacenHabitual();
        const { serie, centro_venta } = typeof ERP_PEDIDO_OPCIONES !== 'undefined'
            ? ERP_PEDIDO_OPCIONES.getSerieYCentroVenta(almacen, almacenHabitual)
            : { serie: 'BT7', centro_venta: '1' };

        const ref = referencia != null && referencia !== '' ? referencia : ('PEDIDO_TIENDA_' + (Date.now ? Date.now() : String(Math.random()).slice(2, 10)));
        const lineas = (cart.productos || []).map((p) => ({
            codigo_articulo: p.codigo_producto || p.codigo,
            unidades: p.cantidad != null ? p.cantidad : 0
        }));

        const codigoClienteErp = (codigoClienteUsuario != null && codigoClienteUsuario !== '') ? codigoClienteUsuario : null;
        const codigoUsuarioErp = codigoClienteErp;

        return {
            codigo_cliente: codigoClienteErp,
            codigo_usuario_erp: codigoUsuarioErp,
            serie: serie,
            centro_venta: centro_venta,
            referencia: ref,
            observaciones: observaciones != null ? String(observaciones) : '',
            lineas: lineas
        };
    }

    /**
     * Construye el payload ERP a partir de un item de la cola offline.
     * codigoClienteUsuario: carritos_clientes.codigo_cliente_usuario (viene de result al crear el pedido).
     */
    buildErpPayloadFromOfflineItem(item, carritoId, codigoQr, codigoClienteUsuario) {
        const almacen = item.almacen;
        const observaciones = item.observaciones != null ? String(item.observaciones) : '';
        const referencia = 'RQC/' + carritoId + '-' + (codigoQr || '');
        const almacenHabitual = (item.user_snapshot && item.user_snapshot.almacen_habitual) ? item.user_snapshot.almacen_habitual : null;
        const { serie, centro_venta } = typeof ERP_PEDIDO_OPCIONES !== 'undefined'
            ? ERP_PEDIDO_OPCIONES.getSerieYCentroVenta(almacen, almacenHabitual)
            : { serie: 'BT7', centro_venta: '1' };
        const productos = (item.cart && item.cart.productos) ? item.cart.productos : [];
        const lineas = productos.map((p) => ({
            codigo_articulo: p.codigo_producto || p.codigo,
            unidades: p.cantidad != null ? p.cantidad : 0
        }));
        const codigoClienteErp = (codigoClienteUsuario != null && codigoClienteUsuario !== '') ? codigoClienteUsuario : null;
        const codigoUsuarioErp = codigoClienteErp;
        return {
            codigo_cliente: codigoClienteErp,
            codigo_usuario_erp: codigoUsuarioErp,
            serie: serie,
            centro_venta: centro_venta,
            referencia: referencia,
            observaciones: observaciones,
            lineas: lineas
        };
    }

    /**
     * Envía un pedido remoto al almacén seleccionado.
     * @param {string} almacen - Código del almacén (ONTINYENT, GANDIA, ALZIRA, REQUENA).
     * @param {string} [observaciones] - Observaciones para el pedido (opcional).
     */
    async sendRemoteOrder(almacen, observaciones) {
        try {
            if (!this.currentUser) {
                window.ui.showToast('Debes iniciar sesion', 'error');
                return;
            }

            if (this.currentUser.is_comercial && !this.currentUser.cliente_representado_id) {
                this.hideAlmacenModal();
                this.hideEnviarEnRutaModal();
                window.ui.showToast('Selecciona el cliente al que representas para poder enviar el pedido', 'warning');
                this.showScreen('selectorCliente');
                this.renderSelectorClienteScreen();
                return;
            }

            const effectiveUserId = this.getEffectiveUserId();
            if (!effectiveUserId) {
                window.ui.showToast('Selecciona un cliente a representar (menu)', 'warning');
                return;
            }

            const cart = window.cartManager.getCart();
            if (!cart || cart.productos.length === 0) {
                window.ui.showToast('El carrito esta vacio', 'warning');
                return;
            }

            this.hideAlmacenModal();
            this.hideEnviarEnRutaModal();

            let observacionesFinal = observaciones != null ? String(observaciones) : '';
            if (this.currentUser.is_comercial && this.currentUser.user_name) {
                observacionesFinal += (observacionesFinal ? '\n\n' : '') + 'Pedido enviado por: ' + this.currentUser.user_name;
            }

            window.ui.showLoading(`Enviando pedido a ${almacen}...`);

            const result = await window.supabaseClient.crearPedidoRemoto(
                effectiveUserId,
                almacen,
                observacionesFinal || null,
                this.currentUser.is_operario ? (this.currentUser.nombre_operario || null) : null
            );

            if (!result.success) {
                if (this.isConnectionError(result.message) && window.offlineOrderQueue) {
                    const cart = window.cartManager.getCart();
                    const offlineItem = {
                        usuario_id: effectiveUserId,
                        almacen: almacen,
                        observaciones: observacionesFinal,
                        cart: {
                            productos: (cart.productos || []).map((p) => ({
                                codigo_producto: p.codigo_producto || p.codigo,
                                descripcion_producto: p.descripcion_producto,
                                precio_unitario: p.precio_unitario,
                                cantidad: p.cantidad
                            })),
                            total_importe: cart.total_importe
                        },
                        user_snapshot: {
                            grupo_cliente: this.getEffectiveGrupoCliente(),
                            codigo_usuario: this.currentUser.codigo_usuario,
                            codigo_usuario_titular: this.currentUser.codigo_usuario_titular,
                            almacen_habitual: this.getEffectiveAlmacenHabitual(),
                            is_operario: this.currentUser.is_operario,
                            nombre_operario: this.currentUser.nombre_operario
                        }
                    };
                    await window.offlineOrderQueue.enqueue(offlineItem);
                    window.ui.hideLoading();
                    window.ui.showToast('Pedido guardado. Se enviara cuando haya conexion.', 'success');
                    await window.cartManager.clearCart();
                    window.ui.updateCartBadge();
                    this.showScreen('cart');
                    this.updateActiveNav('cart');
                    this.updateCartView();
                    return;
                }
                throw new Error(result.message || 'Error al crear pedido remoto');
            }

            const referencia = 'RQC/' + result.carrito_id + '-' + result.codigo_qr;
            const erpPayload = this.buildErpOrderPayload(cart, almacen, referencia, observacionesFinal, result.codigo_cliente_usuario);

            let erpResponse = null;
            let erpError = null;
            if (window.erpClient && (window.erpClient.proxyPath || window.erpClient.createOrderPath)) {
                window.ui.showLoading(`Conectando con ERP para ${almacen}...`);
                try {
                    console.log('ERP create-order POST payload (detalles enviados):', JSON.stringify(erpPayload, null, 2));
                    erpResponse = await window.erpClient.createRemoteOrder(erpPayload);
                    if (erpResponse && erpResponse.success === false) {
                        erpError = new Error(erpResponse.message || erpResponse.error || 'El ERP rechazo el pedido');
                    } else {
                        console.log('Pedido enviado al ERP correctamente');
                    }
                } catch (e) {
                    erpError = e;
                }
            } else {
                console.log('ERP no configurado o endpoint de pedidos no disponible aun');
            }

            if (erpError) {
                const isValidationError = this.isErpValidationError(erpError);
                try {
                    await window.supabaseClient.updateCarritoEstadoProcesamiento(result.carrito_id, 'error_erp');
                } catch (e) {
                    console.warn('No se pudo marcar pedido como error_erp:', e);
                }
                window.ui.hideLoading();
                if (isValidationError) {
                    window.ui.showErpErrorModal(erpError.message || String(erpError));
                    return;
                }
                if (!window.erpRetryQueue) {
                    window.ui.showToast('Error de conexion con el ERP. El pedido no se ha guardado.', 'error');
                    return;
                }
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
                await window.supabaseClient.updateCarritoEstadoProcesamiento(result.carrito_id, 'pendiente_erp');
                let erpEnqueued = false;
                try {
                    if (!window.erpRetryQueue.db && typeof window.erpRetryQueue.init === 'function') {
                        await window.erpRetryQueue.init();
                    }
                    await window.erpRetryQueue.enqueue({
                        carrito_id: result.carrito_id,
                        payload: erpPayload,
                        referencia: referencia,
                        almacen: almacen,
                        usuario_id: effectiveUserId || this.currentUser.user_id
                    });
                    erpEnqueued = true;
                } catch (queueErr) {
                    console.warn('No se pudo encolar reintento ERP:', queueErr);
                }
                if (window.offlineOrderQueue && typeof window.offlineOrderQueue.registerBackgroundSync === 'function') {
                    window.offlineOrderQueue.registerBackgroundSync();
                }
                window.ui.hideLoading();
                window.ui.showToast(erpEnqueued
                    ? 'Pedido guardado. Se enviara al ERP cuando haya conexion.'
                    : 'Pedido guardado en el servidor. Si el ERP no lo recibe, contacta con soporte.', erpEnqueued ? 'success' : 'warning');
                if (window.purchaseCache) {
                    window.purchaseCache.invalidateUser(effectiveUserId || this.currentUser.user_id);
                }
                await window.cartManager.clearCart();
                window.ui.updateCartBadge();
                this.showScreen('cart');
                this.updateActiveNav('cart');
                this.updateCartView();
                return;
            }

            const pedidoErp = erpResponse && erpResponse.data && erpResponse.data.pedido != null ? erpResponse.data.pedido : null;
            if (pedidoErp && result.carrito_id) {
                try {
                    await window.supabaseClient.updatePedidoErp(result.carrito_id, pedidoErp);
                } catch (e) {
                    console.warn('No se pudo guardar pedido_erp en Supabase:', e);
                }
            }

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

            try {
                await window.supabaseClient.registrarHistorialDesdeCarrito(result.carrito_id);
            } catch (e) {
                console.warn('No se pudo registrar historial (pedido enviado correctamente):', e);
            }

            window.ui.hideLoading();
            const totalWithIVA = cart.total_importe * 1.21;
            window.ui.showToast(
                `Pedido enviado a ${almacen} - ${totalWithIVA.toFixed(2)}€`,
                'success'
            );

            if (window.purchaseCache) {
                window.purchaseCache.invalidateUser(effectiveUserId || this.currentUser.user_id);
            }
            await window.cartManager.clearCart();
            window.ui.updateCartBadge();
            this.showScreen('cart');
            this.updateActiveNav('cart');
            this.updateCartView();
            console.log('Pedido remoto enviado exitosamente a ' + almacen);

        } catch (error) {
            console.error('Error al enviar pedido remoto:', error);
            const errMsg = error && (error.message || String(error));
            if (this.isConnectionError(errMsg) && this.currentUser && window.offlineOrderQueue) {
                const cart = window.cartManager.getCart();
                if (cart && cart.productos && cart.productos.length > 0) {
                    const effectiveUserIdCatch = this.getEffectiveUserId();
                    let observacionesFinalCatch = observaciones != null ? String(observaciones) : '';
                    if (this.currentUser.is_comercial && this.currentUser.user_name) {
                        observacionesFinalCatch += (observacionesFinalCatch ? '\n\n' : '') + 'Pedido enviado por: ' + this.currentUser.user_name;
                    }
                    const offlineItem = {
                        usuario_id: effectiveUserIdCatch || this.currentUser.user_id,
                        almacen: almacen,
                        observaciones: observacionesFinalCatch,
                        cart: {
                            productos: (cart.productos || []).map((p) => ({
                                codigo_producto: p.codigo_producto || p.codigo,
                                descripcion_producto: p.descripcion_producto,
                                precio_unitario: p.precio_unitario,
                                cantidad: p.cantidad
                            })),
                            total_importe: cart.total_importe
                        },
                        user_snapshot: {
                            grupo_cliente: this.getEffectiveGrupoCliente(),
                            codigo_usuario: this.currentUser.codigo_usuario,
                            codigo_usuario_titular: this.currentUser.codigo_usuario_titular,
                            almacen_habitual: this.getEffectiveAlmacenHabitual(),
                            is_operario: this.currentUser.is_operario,
                            nombre_operario: this.currentUser.nombre_operario
                        }
                    };
                    try {
                        await window.offlineOrderQueue.enqueue(offlineItem);
                        window.ui.hideLoading();
                        window.ui.showToast('Pedido guardado. Se enviara cuando haya conexion.', 'success');
                        await window.cartManager.clearCart();
                        window.ui.updateCartBadge();
                        this.showScreen('cart');
                        this.updateActiveNav('cart');
                        this.updateCartView();
                        return;
                    } catch (e) {
                        console.warn('No se pudo guardar pedido offline:', e);
                    }
                }
            }
            window.ui.hideLoading();
            window.ui.showToast('Error al enviar pedido. Intenta de nuevo.', 'error');
        }
    }

    /**
     * Detecta si el error del ERP es de validacion/datos (400, obligatorio, etc.).
     * En ese caso el pedido NO debe darse por creado y se muestra modal de error.
     */
    isErpValidationError(error) {
        const msg = (error && (error.message || error.toString || String(error))) ? String(error.message || error) : '';
        return /400|Bad Request|obligatorio|ERP error 4\d\d/i.test(msg);
    }

    /**
     * Detecta si el mensaje indica fallo de conexion (offline / red).
     * Usado para encolar el pedido en la cola offline cuando Supabase no responde.
     */
    isConnectionError(message) {
        if (message == null) return false;
        const msg = String(message);
        return /conexion|conexión|intenta de nuevo|network|failed to fetch|load failed|err_connection/i.test(msg);
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

        const userId = this.getEffectiveUserId();
        if (!this.currentUser || !userId) {
            if (ordersEmpty) ordersEmpty.style.display = 'flex';
            if (ordersLoading) ordersLoading.style.display = 'none';
            if (ordersList) ordersList.style.display = 'none';
            return;
        }

        try {
            this._offlinePendingByOrderId = {};
            let offlineSynthetics = [];
            if (window.offlineOrderQueue && typeof window.offlineOrderQueue.getAll === 'function') {
                try {
                    const allQueued = await window.offlineOrderQueue.getAll();
                    const forUser = (allQueued || []).filter(function (x) { return x.usuario_id === userId; });
                    for (const item of forUser) {
                        const sid = 'offline_' + item.id;
                        this._offlinePendingByOrderId[sid] = item;
                        offlineSynthetics.push({
                            id: sid,
                            almacen_destino: item.almacen || '-',
                            fecha_creacion: item.createdAt || Date.now(),
                            estado_procesamiento: 'pendiente_envio',
                            codigo_qr: '-',
                            total_productos: (item.cart && item.cart.productos) ? item.cart.productos.length : 0,
                            total_importe: (item.cart && item.cart.total_importe) != null ? item.cart.total_importe : 0,
                            tipo_pedido: 'remoto',
                            observaciones: item.observaciones != null ? String(item.observaciones) : null,
                            nombre_operario: (item.user_snapshot && item.user_snapshot.is_operario && item.user_snapshot.nombre_operario) ? item.user_snapshot.nombre_operario : null
                        });
                    }
                } catch (e) {
                    console.warn('No se pudo cargar cola offline para Mis pedidos:', e);
                }
            }

            // PASO 1: Cargar desde caché local (INMEDIATO)
            console.log('Cargando pedidos para user_id:', userId);
            const pedidosCache = await window.cartManager.loadRemoteOrdersFromCache(userId);
            const pedidosFromCache = (pedidosCache && pedidosCache.length > 0) ? pedidosCache : [];

            if (offlineSynthetics.length > 0 || pedidosFromCache.length > 0) {
                ordersLoading.style.display = 'none';
                ordersList.style.display = 'block';
                ordersEmpty.style.display = 'none';
                ordersList.innerHTML = '';

                const allPedidos = offlineSynthetics.concat(pedidosFromCache);
                console.log('Mostrando ' + allPedidos.length + ' pedidos (' + offlineSynthetics.length + ' pend. envio)');
                for (const pedido of allPedidos) {
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
                console.log('Consultando Supabase...');
                const pedidosOnline = await window.supabaseClient.getUserRemoteOrders(userId);

                await window.cartManager.saveRemoteOrdersToCache(pedidosOnline || [], userId);

                ordersLoading.style.display = 'none';

                const onlineList = pedidosOnline && pedidosOnline.length > 0 ? pedidosOnline : [];
                const allPedidosOnline = offlineSynthetics.concat(onlineList);

                if (allPedidosOnline.length === 0) {
                    ordersEmpty.style.display = 'flex';
                    ordersList.style.display = 'none';
                    return;
                }

                ordersList.style.display = 'block';
                ordersEmpty.style.display = 'none';
                ordersList.innerHTML = '';

                for (const pedido of allPedidosOnline) {
                    const orderCard = await this.createOrderCard(pedido);
                    ordersList.appendChild(orderCard);
                }

                console.log('Pedidos actualizados desde Supabase');

            } catch (onlineError) {
                console.log('Modo offline - mostrando datos en cache');
                if (offlineSynthetics.length === 0 && pedidosFromCache.length === 0) {
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
     * Formatea una fecha para mostrar en hora de España (Europe/Madrid).
     * La base de datos puede guardar en UTC u otro horario; aqui se muestra siempre hora española.
     */
    formatDateSpain(dateOrString) {
        const d = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
        return d.toLocaleDateString('es-ES', {
            timeZone: 'Europe/Madrid',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Crea una tarjeta de pedido
     */
    async createOrderCard(pedido) {
        const card = document.createElement('div');
        card.className = 'order-card';
        const orderIdAttr = typeof pedido.id === 'string' ? pedido.id : String(pedido.id);
        card.setAttribute('data-order-id', orderIdAttr);

        // Fecha en hora España
        const fechaFormateada = this.formatDateSpain(pedido.fecha_creacion);

        // Determinar estado y badge (estado + estado_procesamiento de carritos_clientes)
        const estadoInfo = this.getEstadoBadge(pedido.estado, pedido.estado_procesamiento);

        // Determinar tipo de pedido
        const tipoPedido = pedido.tipo_pedido === 'remoto' ? 'Remoto' : 'Presencial';
        const tipoClass = pedido.tipo_pedido === 'remoto' ? 'remote' : 'presencial';

        // Calcular total con IVA
        const totalConIVA = (pedido.total_importe || 0) * 1.21;

        // Observaciones y operario (escapados para HTML)
        const hasObservaciones = pedido.observaciones && String(pedido.observaciones).trim() !== '';
        const observacionesTitle = hasObservaciones ? this.escapeForHtmlAttribute(String(pedido.observaciones).trim()) : '';
        const observacionesContent = hasObservaciones ? this.escapeForHtmlContentPreservingNewlines(String(pedido.observaciones)) : '';
        const hasOperario = pedido.nombre_operario && String(pedido.nombre_operario).trim() !== '';
        const operarioText = hasOperario ? this.escapeForHtmlAttribute(String(pedido.nombre_operario).trim()) : '';

        const orderIdForClick = typeof pedido.id === 'string' ? JSON.stringify(pedido.id) : String(pedido.id);
        const badgeHtml = pedido.estado_procesamiento === 'pendiente_erp'
            ? `<button type="button" class="order-badge order-badge-${estadoInfo.class} order-badge-erp-retry" data-carrito-id="${this.escapeForHtmlAttribute(orderIdAttr)}" title="Pulsar para enviar de nuevo al ERP" onclick="event.stopPropagation(); window.app.retryEnvioErp(this.getAttribute('data-carrito-id'));">${estadoInfo.icon} ${estadoInfo.text}</button>`
            : `<span class="order-badge order-badge-${estadoInfo.class}">${estadoInfo.icon} ${estadoInfo.text}</span>`;
        card.innerHTML = `
            <div class="order-card-header" onclick="window.app.toggleOrderDetails(${orderIdForClick})">
                <div class="order-card-main">
                    <div class="order-card-top">
                        <span class="order-almacen">${this.escapeForHtmlAttribute(pedido.almacen_destino || '')}</span>
                        <span class="order-type order-type-${tipoClass}">${tipoPedido}</span>
                        ${badgeHtml}
                    </div>
                    <div class="order-card-meta">
                        <span class="order-date">${fechaFormateada}</span>
                        <span class="order-code">Código: ${this.escapeForHtmlAttribute(pedido.codigo_qr || '-')}</span>
                        ${pedido.pedido_erp ? `<span class="order-erp">Ped. ${this.escapeForHtmlAttribute(pedido.pedido_erp)}</span>` : ''}
                    </div>
                    ${hasObservaciones ? `<div class="order-observaciones" title="${observacionesTitle}">${observacionesContent}</div>` : ''}
                    ${hasOperario ? `<div class="order-operario">Pedido por ${operarioText}</div>` : ''}
                    <div class="order-card-totals">
                        <span class="order-items">${pedido.total_productos} producto${pedido.total_productos !== 1 ? 's' : ''}</span>
                        <span class="order-total">${totalConIVA.toFixed(2)} €</span>
                    </div>
                </div>
                <div class="order-card-trigger" data-order-id="${orderIdAttr}">
                    <span class="order-card-trigger-label">Ver detalles</span>
                    <span class="order-card-arrow">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
            </div>
            <div class="order-card-details" id="orderDetails-${orderIdAttr}" style="display: none;">
                <div class="order-details-loading">
                    <div class="spinner-small"></div>
                    <span>Cargando productos...</span>
                </div>
            </div>
        `;

        return card;
    }

    /**
     * Obtiene información del badge según estado y estado_procesamiento (carritos_clientes).
     * - estado=en_preparacion y estado_procesamiento=procesando -> "En Preparación"
     * - estado=completado y estado_procesamiento=completado -> "Completado"
     */
    getEstadoBadge(estado, estadoProcesamiento) {
        if (estado === 'en_preparacion' && estadoProcesamiento === 'procesando') {
            return { class: 'processing', icon: '\uD83D\uDCE6', text: 'En Preparación' };
        }
        if (estado === 'completado' && estadoProcesamiento === 'completado') {
            return { class: 'completed', icon: '\u2705', text: 'Completado' };
        }
        const estados = {
            'pendiente': { class: 'pending', icon: '\u23F3', text: 'Pendiente' },
            'pendiente_erp': { class: 'pending', icon: '\uD83D\uDCE4', text: 'Pend. enviar a ERP' },
            'pendiente_envio': { class: 'pending', icon: '\uD83D\uDCF4', text: 'Pend. de envio' },
            'error_erp': { class: 'cancelled', icon: '\u274C', text: 'Error ERP' },
            'procesando': { class: 'processing', icon: '\uD83D\uDCE4', text: 'Enviado' },
            'completado': { class: 'completed', icon: '\u2705', text: 'Completado' }
        };
        const key = typeof estadoProcesamiento !== 'undefined' ? estadoProcesamiento : estado;
        return estados[key] || { class: 'pending', icon: '\u23F3', text: key || estado };
    }

    /**
     * Reintento manual de envio al ERP para un pedido en estado pendiente_erp.
     * Primero intenta desde la cola local; si no esta, construye payload desde Supabase y envia.
     */
    async retryEnvioErp(carritoId) {
        if (!carritoId) return;
        const id = String(carritoId).trim();
        if (!id) return;
        window.ui.showLoading('Enviando a ERP...');
        try {
            let result = { found: false };
            if (window.erpRetryQueue && typeof window.erpRetryQueue.retryCarritoNow === 'function') {
                if (!window.erpRetryQueue.db && typeof window.erpRetryQueue.init === 'function') {
                    await window.erpRetryQueue.init();
                }
                result = await window.erpRetryQueue.retryCarritoNow(id);
            }
            if (result.found) {
                window.ui.hideLoading();
                if (result.success) {
                    window.ui.showToast('Pedido enviado al ERP correctamente', 'success');
                    await this.loadMyOrders();
                } else {
                    window.ui.showToast('No se pudo enviar al ERP. Se reintentara automaticamente.', 'warning');
                    await this.loadMyOrders();
                }
                return;
            }
            if (!window.erpClient || (!window.erpClient.proxyPath && !window.erpClient.createOrderPath)) {
                window.ui.hideLoading();
                window.ui.showToast('ERP no configurado. El pedido seguira en cola.', 'warning');
                return;
            }
            const carrito = await window.supabaseClient.getCart(id);
            if (!carrito || !carrito.productos || carrito.productos.length === 0) {
                window.ui.hideLoading();
                window.ui.showToast('No se encontraron datos del pedido', 'error');
                return;
            }
            if (carrito.estado_procesamiento !== 'pendiente_erp') {
                window.ui.hideLoading();
                window.ui.showToast('El pedido ya fue enviado al ERP', 'success');
                await this.loadMyOrders();
                return;
            }
            const almacen = carrito.almacen_destino || this.getEffectiveAlmacenHabitual() || '';
            const referencia = 'RQC/' + id + '-' + (carrito.codigo_qr || '');
            const cart = {
                productos: (carrito.productos || []).map((p) => ({
                    codigo_producto: p.codigo_producto || p.codigo,
                    cantidad: p.cantidad != null ? p.cantidad : 0
                }))
            };
            const payload = this.buildErpOrderPayload(cart, almacen, referencia, carrito.observaciones || '', carrito.codigo_cliente_usuario);
            const response = await window.erpClient.createRemoteOrder(payload);
            if (response && response.success === false) {
                await window.supabaseClient.updateCarritoEstadoProcesamiento(id, 'error_erp');
                window.ui.hideLoading();
                window.ui.showToast(response.message || 'El ERP rechazo el pedido', 'error');
                await this.loadMyOrders();
                return;
            }
            const pedidoErp = response && response.data && response.data.pedido != null ? response.data.pedido : null;
            if (pedidoErp) {
                await window.supabaseClient.updatePedidoErp(id, pedidoErp);
            }
            await window.supabaseClient.marcarPedidoRemotoEnviado(id);
            try {
                await window.supabaseClient.registrarHistorialDesdeCarrito(id);
            } catch (e) {
                console.warn('registrarHistorialDesdeCarrito en retryEnvioErp:', e);
            }
            if (window.purchaseCache && carrito.usuario_id) {
                window.purchaseCache.invalidateUser(carrito.usuario_id);
            }
            window.ui.hideLoading();
            window.ui.showToast('Pedido enviado al ERP correctamente', 'success');
            await this.loadMyOrders();
        } catch (err) {
            window.ui.hideLoading();
            const errMsg = err && (err.message || String(err));
            const isValidation = this.isErpValidationError(err);
            if (isValidation) {
                try {
                    await window.supabaseClient.updateCarritoEstadoProcesamiento(id, 'error_erp');
                } catch (e) {
                    console.warn('updateCarritoEstadoProcesamiento error_erp:', e);
                }
                window.ui.showToast(errMsg || 'Error de validacion ERP', 'error');
                await this.loadMyOrders();
                return;
            }
            if (this.isConnectionError(errMsg) && window.erpRetryQueue) {
                const carrito = await window.supabaseClient.getCart(id).catch(() => null);
                if (carrito && carrito.estado_procesamiento === 'procesando') {
                    window.ui.showToast('El pedido ya fue enviado al ERP. Comprueba la lista.', 'success');
                } else if (carrito && carrito.productos && carrito.productos.length > 0 && carrito.estado_procesamiento === 'pendiente_erp') {
                    const almacen = carrito.almacen_destino || this.getEffectiveAlmacenHabitual() || '';
                    const referencia = 'RQC/' + id + '-' + (carrito.codigo_qr || '');
                    const cart = {
                        productos: (carrito.productos || []).map((p) => ({
                            codigo_producto: p.codigo_producto || p.codigo,
                            cantidad: p.cantidad != null ? p.cantidad : 0
                        }))
                    };
                    const payload = this.buildErpOrderPayload(cart, almacen, referencia, carrito.observaciones || '', carrito.codigo_cliente_usuario);
                    try {
                        await window.erpRetryQueue.init();
                        await window.erpRetryQueue.enqueue({
                            carrito_id: id,
                            payload: payload,
                            referencia: referencia,
                            almacen: almacen,
                            usuario_id: carrito.usuario_id
                        });
                        window.ui.showToast('Sin conexion. Se enviara al ERP cuando haya red.', 'warning');
                    } catch (e) {
                        console.warn('No se pudo encolar reintento ERP:', e);
                        window.ui.showToast('Error de conexion. Intenta de nuevo mas tarde.', 'error');
                    }
                } else {
                    window.ui.showToast('Error de conexion. Intenta de nuevo mas tarde.', 'error');
                }
            } else {
                window.ui.showToast(errMsg || 'Error al enviar al ERP', 'error');
            }
            await this.loadMyOrders();
        }
    }

    /**
     * Alterna la visualización de detalles del pedido
     */
    async toggleOrderDetails(orderId) {
        const detailsDiv = document.getElementById(`orderDetails-${orderId}`);
        const cardEl = document.querySelector(`[data-order-id="${orderId}"]`);
        const arrow = cardEl ? cardEl.querySelector('.order-card-arrow svg') : null;
        const triggerLabel = cardEl ? cardEl.querySelector('.order-card-trigger-label') : null;

        if (!detailsDiv) return;

        if (detailsDiv.style.display === 'none') {
            detailsDiv.style.display = 'block';
            if (arrow) arrow.style.transform = 'rotate(180deg)';
            if (triggerLabel) triggerLabel.textContent = 'Ocultar';

            if (detailsDiv.querySelector('.order-details-loading')) {
                await this.loadOrderProducts(orderId);
            }
        } else {
            detailsDiv.style.display = 'none';
            if (arrow) arrow.style.transform = 'rotate(0deg)';
            if (triggerLabel) triggerLabel.textContent = 'Ver detalles';
        }
    }

    /**
     * Carga los productos de un pedido (ESTRATEGIA OFFLINE-FIRST)
     */
    async loadOrderProducts(orderId) {
        const detailsDiv = document.getElementById('orderDetails-' + orderId);
        if (!detailsDiv) return;

        if (typeof orderId === 'string' && orderId.indexOf('offline_') === 0 && this._offlinePendingByOrderId && this._offlinePendingByOrderId[orderId]) {
            const item = this._offlinePendingByOrderId[orderId];
            const raw = (item.cart && item.cart.productos) ? item.cart.productos : [];
            const productos = raw.map(function (p) {
                const precio = p.precio_unitario != null ? p.precio_unitario : 0;
                const qty = p.cantidad != null ? p.cantidad : 0;
                return {
                    codigo_producto: p.codigo_producto || p.codigo,
                    descripcion_producto: p.descripcion_producto || p.descripcion || '-',
                    precio_unitario: precio,
                    cantidad: qty,
                    subtotal: precio * qty
                };
            });
            this.renderOrderProducts(detailsDiv, productos);
            return;
        }

        try {
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

