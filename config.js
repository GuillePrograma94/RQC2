/**
 * Configuración de la aplicación Scan as You Shop
 */

const APP_CONFIG = {
    // Configuración de sincronización
    sync: {
        autoSyncInterval: 240, // Minutos entre sincronizaciones automáticas
        batchSize: 1000, // Productos por lote
        maxRetries: 3 // Reintentos en caso de error
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
    
    /**
     * Carga la configuración de Supabase desde el servidor
     */
    async loadSupabaseConfig() {
        try {
            // Si ya hay credenciales configuradas, usarlas directamente
            if (this.SUPABASE_URL && this.SUPABASE_ANON_KEY && 
                this.SUPABASE_URL !== 'https://tu-proyecto.supabase.co') {
                console.log('Usando credenciales configuradas directamente');
                return true;
            }
            
            // Intentar cargar desde serverless function (Vercel/Netlify)
            // Forzar .js explícitamente para evitar que cargue .php cacheado
            const configUrl = '/api/config.js';
            console.log('[Config] Solicitando configuracion:', configUrl);
            let response = await fetch(configUrl);

            console.log('[Config] Respuesta recibida:', {
                status: response.status,
                ok: response.ok
            });

            if (!response.ok) {
                // Fallback: leer desde variables de entorno del navegador (desarrollo)
                console.warn('[Config] No se pudo cargar config desde servidor (status ' + response.status + '), usando valores configurados');
                // Si hay credenciales hardcodeadas, considerarlo válido
                if (this.SUPABASE_URL && this.SUPABASE_ANON_KEY) {
                    return true;
                }
                return false;
            }
            
            const responseText = await response.text();
            // No loguear el cuerpo de la respuesta: puede contener SUPABASE_ANON_KEY

            let config;
            try {
                config = JSON.parse(responseText);
            } catch (parseError) {
                console.error('[Config] La respuesta no es JSON valido. Content-Type era:', response.headers.get('Content-Type'), '| Parse error:', parseError.message);
                console.error('[Config] Posible causa: el Service Worker o el servidor devolvieron otro archivo (p. ej. sw.js). Comprueba que /api/config.js no este siendo cacheado.');
                throw parseError;
            }
            
            if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
                this.SUPABASE_URL = config.SUPABASE_URL;
                this.SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
                console.log('Configuracion de Supabase cargada correctamente desde servidor');
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

