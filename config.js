/**
 * Configuración de la aplicación BATMAR
 */

const APP_CONFIG = {
    // Configuración de sincronización
    sync: {
        autoSyncInterval: 240, // Minutos entre sincronizaciones automáticas
        batchSize: 1000, // Productos por lote
        maxRetries: 3, // Reintentos en caso de error
        // Por debajo del umbral: sync incremental (solo registros modificados).
        // Por encima: sync completa del dominio. Calibrado para ~60k productos y ~100k+ codigos secundarios:
        // 10k cambios sigue siendo incremental; completa solo cuando cambia una fraccion muy grande del catalogo.
        incrementalThresholdProductos: 25000,
        incrementalThresholdCodigosSecundarios: 40000,
        incrementalThresholdClavesDescuento: 1000
    },
    
    // Configuración de búsqueda
    search: {
        minSearchLength: 2, // Mínimo caracteres para buscar
        debounceDelay: 300 // Delay para búsqueda en tiempo real (ms)
    },
    
    // Configuración de carritos
    cart: {
        expirationHours: 2, // Horas antes de expirar carrito
        maxProductsPerCart: 200, // Máximo productos por carrito
        autoSyncInterval: 5000 // Sincronización automática del carrito (ms)
    },
    
    // Configuración de UI
    ui: {
        toastDuration: 3000, // Duración de notificaciones (ms)
        loadingDelay: 500 // Delay mínimo para pantallas de carga (ms)
    }
};

// Configuración de Supabase (se carga dinámicamente desde el servidor)
let CONFIG = {
    // TEMPORAL: Reemplaza con tus credenciales reales de Supabase
    SUPABASE_URL: 'https://tu-proyecto.supabase.co',
    SUPABASE_ANON_KEY: 'tu-anon-key-aqui',

    // Configuracion ERP
    ERP: {
        BASE_URL: '',
        LOGIN_PATH: '/login',
        CREATE_ORDER_PATH: '',
        PROXY_PATH: '/api/erp/pedidos',
        USER: '',
        PASSWORD: '',
        TOKEN_LIFETIME_HOURS: 8,
        REQUEST_TIMEOUT_MS: 15000
    },

    _apiBaseUrl: '',
    _apiBaseUrlResolved: false,
    _serverConfigRefreshPromise: null,

    SERVER_CONFIG_CACHE_KEY: 'batmar_server_config_cache',
    SERVER_CONFIG_CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,

    readServerConfigCache() {
        try {
            const raw = localStorage.getItem(this.SERVER_CONFIG_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.config || !parsed.savedAt) return null;
            if (Date.now() - Number(parsed.savedAt) > this.SERVER_CONFIG_CACHE_MAX_AGE_MS) {
                return null;
            }
            return parsed.config;
        } catch (e) {
            return null;
        }
    },

    saveServerConfigCache(config) {
        if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return;
        try {
            localStorage.setItem(this.SERVER_CONFIG_CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                config: config
            }));
        } catch (e) {
            console.warn('[Config] No se pudo guardar cache de configuracion:', e);
        }
    },

    applyServerConfig(config) {
        if (!config) return false;
        let applied = false;
        if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
            this.SUPABASE_URL = config.SUPABASE_URL;
            this.SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
            applied = true;
        }
        if (config.ERP) {
            this.ERP = Object.assign({}, this.ERP, config.ERP);
        }
        if (config.ERP_BASE_URL || config.ERP_LOGIN_PATH || config.ERP_CREATE_ORDER_PATH || config.ERP_PROXY_PATH) {
            this.ERP = Object.assign({}, this.ERP, {
                BASE_URL: config.ERP_BASE_URL || this.ERP.BASE_URL,
                LOGIN_PATH: config.ERP_LOGIN_PATH || this.ERP.LOGIN_PATH,
                CREATE_ORDER_PATH: config.ERP_CREATE_ORDER_PATH || this.ERP.CREATE_ORDER_PATH,
                PROXY_PATH: config.ERP_PROXY_PATH || this.ERP.PROXY_PATH,
                USER: config.ERP_USER || this.ERP.USER,
                PASSWORD: config.ERP_PASSWORD || this.ERP.PASSWORD
            });
        }
        return applied;
    },

    async fetchServerConfigFromNetwork() {
        await this.resolveApiBaseUrl();
        const configUrl = this.buildApiUrl('/api/config.js');
        const response = await fetch(configUrl);
        if (!response.ok) {
            return null;
        }
        const responseText = await response.text();
        let config;
        try {
            config = JSON.parse(responseText);
        } catch (parseError) {
            console.error('[Config] La respuesta no es JSON valido:', parseError.message);
            return null;
        }
        if (config && config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
            this.saveServerConfigCache(config);
        }
        return config;
    },

    refreshServerConfigInBackground() {
        if (this._serverConfigRefreshPromise) {
            return this._serverConfigRefreshPromise;
        }
        this._serverConfigRefreshPromise = this.fetchServerConfigFromNetwork()
            .then((config) => {
                if (config) {
                    this.applyServerConfig(config);
                }
                return !!config;
            })
            .catch((error) => {
                console.warn('[Config] Actualizacion en segundo plano fallida:', error);
                return false;
            })
            .finally(() => {
                this._serverConfigRefreshPromise = null;
            });
        return this._serverConfigRefreshPromise;
    },

    /**
     * Precarga /api/config.js mientras el usuario esta en el gate (calienta serverless y llena cache).
     */
    prefetchServerConfig() {
        if (this._serverConfigRefreshPromise) {
            return this._serverConfigRefreshPromise;
        }
        return this.refreshServerConfigInBackground();
    },

    /**
     * Base URL para /api/* (Vercel). En TiendaPC con UI local usa app_url del config nativo.
     */
    async resolveApiBaseUrl() {
        if (this._apiBaseUrlResolved) {
            return this._apiBaseUrl;
        }
        let base = '';
        try {
            if (window.TiendaNative && typeof window.TiendaNative.whenReady === 'function') {
                await window.TiendaNative.whenReady();
            }
            if (window.TiendaNative && typeof window.TiendaNative.getRemoteApiBase === 'function') {
                base = await window.TiendaNative.getRemoteApiBase();
            }
        } catch (e) {
            console.warn('[Config] No se pudo obtener API base remota de TiendaPC:', e);
        }
        if (!base && typeof window !== 'undefined' && window.location && window.location.origin) {
            base = window.location.origin;
        }
        this._apiBaseUrl = String(base || '').replace(/\/+$/, '');
        this._apiBaseUrlResolved = true;
        console.log('[Config] API base URL:', this._apiBaseUrl || '(relativa)');
        return this._apiBaseUrl;
    },

    buildApiUrl(path) {
        const cleanPath = path && String(path).startsWith('/') ? String(path) : '/' + String(path || '');
        if (this._apiBaseUrl) {
            return this._apiBaseUrl + cleanPath;
        }
        return cleanPath;
    },
    
    /**
     * Carga la configuración de Supabase desde el servidor
     */
    async loadSupabaseConfig() {
        try {
            if (this.SUPABASE_URL && this.SUPABASE_ANON_KEY &&
                this.SUPABASE_URL !== 'https://tu-proyecto.supabase.co') {
                console.log('Usando credenciales configuradas directamente');
                return true;
            }

            await this.resolveApiBaseUrl();

            const cachedConfig = this.readServerConfigCache();
            if (cachedConfig && this.applyServerConfig(cachedConfig)) {
                console.log('[Config] Configuracion cargada desde cache local');
                void this.refreshServerConfigInBackground();
                return true;
            }

            const configUrl = this.buildApiUrl('/api/config.js');
            console.log('[Config] Solicitando configuracion:', configUrl);
            const response = await fetch(configUrl);

            console.log('[Config] Respuesta recibida:', {
                status: response.status,
                ok: response.ok
            });

            if (!response.ok) {
                console.warn('[Config] No se pudo cargar config desde servidor (status ' + response.status + '), usando valores configurados');
                if (this.SUPABASE_URL && this.SUPABASE_ANON_KEY) {
                    return true;
                }
                return false;
            }

            const responseText = await response.text();

            let config;
            try {
                config = JSON.parse(responseText);
            } catch (parseError) {
                console.error('[Config] La respuesta no es JSON valido. Content-Type era:', response.headers.get('Content-Type'), '| Parse error:', parseError.message);
                console.error('[Config] Posible causa: el Service Worker o el servidor devolvieron otro archivo (p. ej. sw.js). Comprueba que /api/config.js no este siendo cacheado.');
                throw parseError;
            }

            if (this.applyServerConfig(config)) {
                this.saveServerConfigCache(config);
                console.log('Configuracion de Supabase cargada correctamente desde servidor');
            }

            return !!(this.SUPABASE_URL && this.SUPABASE_ANON_KEY);
        } catch (error) {
            console.error('[Config] Error al cargar configuracion de Supabase:', error);
            console.error('[Config] Si la respuesta empieza por "/**" o "/*", el servidor o el SW devolvieron un .js en lugar de JSON. Excluye /api/* del cache del Service Worker.');
            // Si hay credenciales hardcodeadas, considerarlo válido
            if (this.SUPABASE_URL && this.SUPABASE_ANON_KEY && 
                this.SUPABASE_URL !== 'https://tu-proyecto.supabase.co') {
                console.log('[Config] Usando credenciales configuradas como fallback');
                return true;
            }
            return false;
        }
    }
};

// Exportar configuración
window.CONFIG = CONFIG;
window.APP_CONFIG = APP_CONFIG;

