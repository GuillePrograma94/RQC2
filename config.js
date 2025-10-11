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
        maxResults: 50, // Máximo resultados mostrados
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
            let response = await fetch('/api/config.js');
            
            if (!response.ok) {
                // Fallback: leer desde variables de entorno del navegador (desarrollo)
                console.warn('No se pudo cargar config desde servidor, usando valores configurados');
                // Si hay credenciales hardcodeadas, considerarlo válido
                if (this.SUPABASE_URL && this.SUPABASE_ANON_KEY) {
                    return true;
                }
                return false;
            }
            
            const config = await response.json();
            
            if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
                this.SUPABASE_URL = config.SUPABASE_URL;
                this.SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
                console.log('Configuracion de Supabase cargada correctamente desde servidor');
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Error al cargar configuracion de Supabase:', error);
            // Si hay credenciales hardcodeadas, considerarlo válido
            if (this.SUPABASE_URL && this.SUPABASE_ANON_KEY && 
                this.SUPABASE_URL !== 'https://tu-proyecto.supabase.co') {
                console.log('Usando credenciales configuradas como fallback');
                return true;
            }
            return false;
        }
    }
};

// Exportar configuración
window.CONFIG = CONFIG;
window.APP_CONFIG = APP_CONFIG;

