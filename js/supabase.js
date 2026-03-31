/**
 * Cliente de Supabase para Scan as You Shop
 * Maneja la conexión con la base de datos en la nube
 */

class SupabaseClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.OFERTAS_CACHE_STATUS_KEY = 'ofertas_cache_status';
        this.OFERTAS_CACHE_VERSION_KEY = 'ofertas_cache_version_hash';
        this.OFERTAS_CACHE_COMPLETED_AT_KEY = 'ofertas_cache_completed_at';
        this.OFERTAS_CACHE_TARGET_VERSION_KEY = 'ofertas_cache_target_version_hash';
    }

    isNetworkError(errorLike) {
        if (errorLike == null) return false;
        const msg = String(errorLike && (errorLike.message || errorLike.error_description || errorLike) || '');
        return /network|failed to fetch|load failed|timeout|timed out|err_connection|connection reset|dns|offline|fetch failed/i.test(msg);
    }

    /**
     * Inicializa el cliente de Supabase
     */
    async initialize() {
        try {
            // Cargar configuración
            const configLoaded = await window.CONFIG.loadSupabaseConfig();
            
            if (!configLoaded) {
                throw new Error('No se pudo cargar la configuracion de Supabase');
            }

            // Crear cliente de Supabase
            const { createClient } = supabase;
            this.client = createClient(
                window.CONFIG.SUPABASE_URL,
                window.CONFIG.SUPABASE_ANON_KEY
            );

            this.isConnected = true;
            console.log('Cliente de Supabase inicializado correctamente');
            return true;

        } catch (error) {
            console.error('Error al inicializar Supabase:', error);
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Verifica si necesita actualización comparando hashes
     */
    async verificarActualizacionNecesaria() {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            // Obtener versión remota de Supabase
            const { data: versionRemota, error } = await this.client
                .from('version_control')
                .select('*')
                .order('fecha_actualizacion', { ascending: false })
                .limit(1);

            if (error) throw error;

            if (!versionRemota || versionRemota.length === 0) {
            console.log('No hay información de versión en Supabase');
                return { necesitaActualizacion: true, versionRemota: null };
            }

            const infoRemota = versionRemota[0];

            // Obtener hash local guardado
            const versionLocalHash = localStorage.getItem('version_hash_local');
            
            if (!versionLocalHash) {
                console.log('Primera sincronización - necesita descargar datos');
                return { necesitaActualizacion: true, versionRemota: infoRemota };
            }

            // Comparar hashes
            const versionRemotaHash = infoRemota.version_hash || '';
            const necesitaActualizacion = versionLocalHash !== versionRemotaHash;

            console.log('Verificación de versión:', {
                versionLocal: versionLocalHash.substring(0, 8) + '...',
                versionRemota: versionRemotaHash.substring(0, 8) + '...',
                necesitaActualizacion: necesitaActualizacion
            });

            return { necesitaActualizacion, versionRemota: infoRemota };

        } catch (error) {
            console.error('Error al verificar actualización:', error);
            // En caso de error, asumir que necesita actualización
            return { necesitaActualizacion: true, versionRemota: null };
        }
    }

    /**
     * Actualiza el hash local guardado
     */
    async actualizarVersionLocal(versionRemota) {
        try {
            if (versionRemota && versionRemota.version_hash) {
                localStorage.setItem('version_hash_local', versionRemota.version_hash);
                localStorage.setItem('last_sync_date', new Date().toISOString());
                const ofertasVersion = localStorage.getItem(this.OFERTAS_CACHE_VERSION_KEY);
                if (!ofertasVersion || ofertasVersion !== versionRemota.version_hash) {
                    this.markOfertasCachePending(versionRemota.version_hash);
                }
                console.log('Hash local actualizado:', versionRemota.version_hash.substring(0, 8) + '...');
            }
        } catch (error) {
            console.error('Error al actualizar versión local:', error);
        }
    }

    markOfertasCachePending(targetVersionHash = null) {
        try {
            localStorage.setItem(this.OFERTAS_CACHE_STATUS_KEY, 'pending');
            localStorage.removeItem(this.OFERTAS_CACHE_COMPLETED_AT_KEY);
            if (targetVersionHash) {
                localStorage.setItem(this.OFERTAS_CACHE_TARGET_VERSION_KEY, targetVersionHash);
            }
        } catch (error) {
            console.error('Error al marcar cache de ofertas pendiente:', error);
        }
    }

    markOfertasCacheComplete(versionHash = null) {
        try {
            const effectiveVersion = versionHash || localStorage.getItem('version_hash_local') || '';
            if (effectiveVersion) {
                localStorage.setItem(this.OFERTAS_CACHE_VERSION_KEY, effectiveVersion);
            }
            localStorage.setItem(this.OFERTAS_CACHE_STATUS_KEY, 'complete');
            localStorage.setItem(this.OFERTAS_CACHE_COMPLETED_AT_KEY, new Date().toISOString());
            localStorage.removeItem(this.OFERTAS_CACHE_TARGET_VERSION_KEY);
        } catch (error) {
            console.error('Error al marcar cache de ofertas completa:', error);
        }
    }

    isOfertasCacheCompleteAndCurrent() {
        try {
            const localCatalogVersion = localStorage.getItem('version_hash_local') || '';
            if (!localCatalogVersion) {
                return false;
            }
            const ofertasStatus = localStorage.getItem(this.OFERTAS_CACHE_STATUS_KEY) || '';
            const ofertasVersion = localStorage.getItem(this.OFERTAS_CACHE_VERSION_KEY) || '';
            return ofertasStatus === 'complete' && ofertasVersion === localCatalogVersion;
        } catch (error) {
            console.error('Error al comprobar estado de cache de ofertas:', error);
            return false;
        }
    }

    shouldFallbackToSupabaseOnOfertasCacheMiss() {
        const hybridModeActive = !!(
            window.app &&
            typeof window.app.isHybridCatalogReadModeEnabled === 'function' &&
            window.app.isHybridCatalogReadModeEnabled()
        );
        if (hybridModeActive) {
            return true;
        }
        return !this.isOfertasCacheCompleteAndCurrent();
    }

    /**
     * Descarga el catálogo de productos con paginación
     */
    async downloadProducts(onProgress = null) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('Descargando productos desde Supabase...');

            // Descargar productos con paginación
            const productos = await this._downloadWithPagination('productos', onProgress);
            
            // Descargar códigos secundarios con paginación
            const codigosSecundarios = await this._downloadWithPagination('codigos_secundarios', onProgress);

            console.log(`Productos descargados: ${productos.length}`);
            console.log(`Códigos secundarios descargados: ${codigosSecundarios.length}`);

            return {
                productos: productos || [],
                codigosSecundarios: codigosSecundarios || []
            };

        } catch (error) {
            console.error('Error al descargar productos:', error);
            throw error;
        }
    }

    /**
     * Obtiene estadísticas de cambios desde una versión específica
     * Útil para decidir si hacer sincronización incremental o completa
     */
    async getChangeStatistics(versionHashLocal) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log(`Llamando a obtener_estadisticas_cambios con hash: ${versionHashLocal?.substring(0, 16)}...`);

            const { data, error } = await this.client.rpc(
                'obtener_estadisticas_cambios',
                { p_version_hash_local: versionHashLocal }
            );

            if (error) {
                console.error('Error al obtener estadísticas:', error);
                console.error('   Código:', error.code);
                console.error('   Mensaje:', error.message);
                console.error('   Detalles:', error.details);
                console.error('   Hint:', error.hint);
                console.warn('Verifica que la función obtener_estadisticas_cambios existe en Supabase');
                return null; // Fallback a sincronización completa
            }

            console.log('Respuesta de estadísticas:', data);

            return data && data.length > 0 ? data[0] : null;

        } catch (error) {
            console.error('Error al obtener estadísticas de cambios:', error);
            console.error('   Stack:', error.stack);
            return null;
        }
    }

    /**
     * Obtiene un manifest de sincronización en una sola llamada.
     * Si la RPC no está disponible, devuelve null para fallback transparente.
     */
    async getSyncManifest(versionHashLocal = null) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { data, error } = await this.client.rpc(
                'obtener_manifest_sync_cliente',
                { p_version_hash_local: versionHashLocal || null }
            );

            if (error) {
                console.warn('Manifest no disponible en backend, se usa fallback por componentes:', error.message);
                return null;
            }

            if (!Array.isArray(data) || data.length === 0) {
                return null;
            }

            return data[0];
        } catch (error) {
            console.warn('No se pudo obtener manifest de sincronización:', error && error.message);
            return null;
        }
    }

    /**
     * Descarga incremental paginada por RPC (con fallback a RPC legacy no paginada).
     */
    async _downloadIncrementalWithPagination(options) {
        const rpcName = options && options.rpcName ? options.rpcName : '';
        const fallbackRpcName = options && options.fallbackRpcName ? options.fallbackRpcName : '';
        const versionHashLocal = options && options.versionHashLocal ? options.versionHashLocal : null;
        const onProgress = options && options.onProgress ? options.onProgress : null;
        const progressTable = options && options.progressTable ? options.progressTable : 'incremental';
        const expectedTotal = options && Number.isFinite(options.expectedTotal) ? options.expectedTotal : null;
        const pageSize = options && Number.isFinite(options.pageSize)
            ? Math.max(100, Math.min(options.pageSize, 10000))
            : 2000;

        if (!rpcName || !versionHashLocal) {
            return [];
        }

        let offset = 0;
        const rows = [];

        try {
            while (true) {
                const { data, error } = await this.client.rpc(rpcName, {
                    p_version_hash_local: versionHashLocal,
                    p_limit: pageSize,
                    p_offset: offset
                });

                if (error) {
                    throw error;
                }

                const batch = Array.isArray(data) ? data : [];
                if (batch.length === 0) {
                    break;
                }

                rows.push(...batch);
                offset += batch.length;

                if (onProgress) {
                    onProgress({
                        table: progressTable,
                        loaded: rows.length,
                        total: expectedTotal || rows.length,
                        batch: batch.length
                    });
                }

                if (batch.length < pageSize) {
                    break;
                }
            }

            return rows;
        } catch (error) {
            if (!fallbackRpcName) {
                throw error;
            }

            console.warn(`${rpcName} no disponible, fallback a ${fallbackRpcName}:`, error && error.message);
            const { data, error: fallbackError } = await this.client.rpc(
                fallbackRpcName,
                { p_version_hash_local: versionHashLocal }
            );

            if (fallbackError) {
                throw fallbackError;
            }

            const fallbackRows = Array.isArray(data) ? data : [];
            if (onProgress) {
                onProgress({
                    table: progressTable,
                    loaded: fallbackRows.length,
                    total: expectedTotal || fallbackRows.length,
                    batch: fallbackRows.length
                });
            }
            return fallbackRows;
        }
    }

    /**
     * Descarga solo los productos modificados/agregados desde una versión específica
     * Sincronización incremental - mucho más rápida que descargar todo
     */
    async downloadProductsIncremental(versionHashLocal, onProgress = null) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('Descargando cambios incrementales desde versión:', versionHashLocal?.substring(0, 8) + '...');

            // Obtener productos modificados
            const { data: productosData, error: productosError } = await this.client.rpc(
                'obtener_productos_modificados',
                { p_version_hash_local: versionHashLocal }
            );

            if (productosError) {
                console.error('Error al obtener productos modificados:', productosError);
                throw productosError;
            }

            // Obtener códigos secundarios modificados
            const { data: codigosData, error: codigosError } = await this.client.rpc(
                'obtener_codigos_secundarios_modificados',
                { p_version_hash_local: versionHashLocal }
            );

            if (codigosError) {
                console.error('Error al obtener códigos modificados:', codigosError);
                throw codigosError;
            }

            const productos = productosData || [];
            const codigosSecundarios = codigosData || [];

            // Reportar progreso
            if (onProgress) {
                onProgress({
                    table: 'cambios',
                    loaded: productos.length + codigosSecundarios.length,
                    total: productos.length + codigosSecundarios.length,
                    batch: productos.length + codigosSecundarios.length
                });
            }

            console.log(`Cambios descargados: ${productos.length} productos, ${codigosSecundarios.length} códigos`);

            return {
                productos: productos,
                codigosSecundarios: codigosSecundarios,
                isIncremental: true
            };

        } catch (error) {
            console.error('Error en sincronización incremental:', error);
            // Fallback a sincronización completa
            console.log('Fallback a sincronización completa...');
            return await this.downloadProducts(onProgress);
        }
    }

    /**
     * Descarga productos, codigos secundarios y claves_descuento con decision independiente
     * incremental vs completa segun estadisticas (umbrales separados).
     */
    async downloadCatalogSplit(versionHashLocal, changeStats, onProgress = null, manifest = null) {
        const t0 = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
        const TH_PROD = 1000;
        const TH_COD = 800;
        const TH_CLAVE = 400;

        const prodN = changeStats
            ? (changeStats.productos_modificados || 0) + (changeStats.productos_nuevos || 0)
            : (manifest ? (manifest.productos_cambios || 0) : 0);
        const codN = changeStats
            ? (changeStats.codigos_modificados || 0) + (changeStats.codigos_nuevos || 0)
            : (manifest ? (manifest.codigos_cambios || 0) : 0);
        const clN = changeStats
            ? (changeStats.claves_descuento_modificadas || 0) + (changeStats.claves_descuento_nuevas || 0)
            : (manifest ? (manifest.claves_descuento_cambios || 0) : 0);

        let useIncProd = !!(versionHashLocal && changeStats && prodN > 0 && prodN < TH_PROD);
        let useIncCod = !!(versionHashLocal && changeStats && codN > 0 && codN < TH_COD);
        let useIncClave = !!(versionHashLocal && changeStats && clN > 0 && clN < TH_CLAVE);

        if (!versionHashLocal || !changeStats) {
            useIncProd = false;
            useIncCod = false;
            useIncClave = false;
        }

        if (versionHashLocal && changeStats && prodN === 0 && codN === 0 && clN === 0) {
            useIncProd = false;
            useIncCod = false;
            useIncClave = false;
        }

        const productosTask = useIncProd
            ? this._downloadIncrementalWithPagination({
                rpcName: 'obtener_productos_modificados_paginado',
                fallbackRpcName: 'obtener_productos_modificados',
                versionHashLocal: versionHashLocal,
                onProgress: onProgress,
                progressTable: 'productos_incremental',
                expectedTotal: prodN,
                pageSize: 2500
            })
            : this._downloadWithPagination('productos', onProgress);

        const codigosTask = useIncCod
            ? this._downloadIncrementalWithPagination({
                rpcName: 'obtener_codigos_secundarios_modificados_paginado',
                fallbackRpcName: 'obtener_codigos_secundarios_modificados',
                versionHashLocal: versionHashLocal,
                onProgress: onProgress,
                progressTable: 'codigos_incremental',
                expectedTotal: codN,
                pageSize: 3000
            })
            : this._downloadWithPagination('codigos_secundarios', onProgress);

        const clavesTask = (async () => {
            try {
                if (useIncClave) {
                    return await this._downloadIncrementalWithPagination({
                        rpcName: 'obtener_claves_descuento_modificadas_paginado',
                        fallbackRpcName: 'obtener_claves_descuento_modificadas',
                        versionHashLocal: versionHashLocal,
                        onProgress: onProgress,
                        progressTable: 'claves_incremental',
                        expectedTotal: clN,
                        pageSize: 2000
                    });
                }
                return await this._downloadWithPagination('claves_descuento', onProgress);
            } catch (e) {
                console.warn('claves_descuento omitido (tabla o RPC no disponible):', e && e.message);
                return [];
            }
        })();

        const [productos, codigosSecundarios, clavesDescuento] = await Promise.all([
            productosTask,
            codigosTask,
            clavesTask
        ]);

        const t1 = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
        console.log(`downloadCatalogSplit completado en ${Math.max(0, Math.round(t1 - t0))} ms`);

        return {
            productos,
            codigosSecundarios,
            clavesDescuento,
            flags: {
                productsIncremental: useIncProd,
                codesIncremental: useIncCod,
                clavesIncremental: useIncClave
            }
        };
    }

    /**
     * Descarga tablas familias y familias_asignadas para navegacion por codigo modificar (cache local).
     */
    async downloadFamiliasCatalog(onProgress = null) {
        let familias = [];
        let familias_asignadas = [];
        try {
            familias = await this._downloadWithPagination('familias', onProgress);
        } catch (e) {
            console.warn('familias no descargada:', e && e.message);
        }
        try {
            familias_asignadas = await this._downloadWithPagination('familias_asignadas', onProgress);
        } catch (e) {
            console.warn('familias_asignadas no descargada:', e && e.message);
        }
        return { familias, familias_asignadas };
    }

    /**
     * Descarga pactos de descuento por cliente (sobrescriben tarifa base por clave).
     */
    async downloadPactosClientesDescuento(onProgress = null) {
        try {
            return await this._downloadWithPagination(
                'pactos_clientes_descuento',
                onProgress,
                { activo: true }
            );
        } catch (e) {
            console.warn('pactos_clientes_descuento no descargado:', e && e.message);
            return [];
        }
    }

    /**
     * Descarga datos con paginación automática
     */
    async _downloadWithPagination(tableName, onProgress = null, filters = {}, pageSize = 1000) {
        const allData = [];
        const requestedPageSize = Math.max(100, Math.min(pageSize || 1000, 5000));
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const from = offset;
            const to = from + requestedPageSize - 1;

            let query = this.client
                .from(tableName)
                .select('*', { count: 'exact' })
                .range(from, to);
            
            // Aplicar filtros si existen
            if (filters && Object.keys(filters).length > 0) {
                for (const [key, value] of Object.entries(filters)) {
                    query = query.eq(key, value);
                }
            }
            
            // Aplicar orden según la tabla
            if (tableName === 'productos') {
                query = query.order('codigo');
            } else if (tableName === 'codigos_secundarios') {
                query = query.order('codigo_secundario');
            } else if (tableName === 'ofertas_intervalos') {
                query = query.order('desde_unidades');
            } else if (tableName === 'stock_almacen_articulo') {
                query = query.order('codigo_almacen').order('codigo_articulo');
            } else if (tableName === 'claves_descuento') {
                query = query.order('clave');
            } else if (tableName === 'familias') {
                query = query.order('CODIGO');
            } else if (tableName === 'familias_asignadas') {
                query = query.order('id');
            } else {
                query = query.order('id');
            }
            
            const { data, error, count } = await query;

            if (error) {
                console.error(`Error en ${tableName}:`, error);
                throw error;
            }

            if (data && data.length > 0) {
                allData.push(...data);
                offset += data.length;
                
                // Reportar progreso
                if (onProgress) {
                    onProgress({
                        table: tableName,
                        loaded: allData.length,
                        total: count,
                        batch: data.length
                    });
                }
                
                // Si hay count exacto, seguir hasta completarlo (robusto ante límites server-side).
                // Si no hay count, usar el criterio clásico por tamaño de bloque.
                if (typeof count === 'number' && count >= 0) {
                    hasMore = allData.length < count;
                } else {
                    hasMore = data.length === requestedPageSize;
                }
            } else {
                hasMore = false;
            }
        }

        return allData;
    }

    /**
     * Busca un producto por código
     */
    async searchProductByCode(codigo) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            // Buscar en productos principales
            const { data: producto, error: errorProducto } = await this.client
                .from('productos')
                .select('*')
                .eq('codigo', codigo)
                .maybeSingle();

            if (errorProducto) {
                console.error('searchProductByCode productos:', errorProducto);
                return null;
            }

            if (producto) {
                return producto;
            }

            // Buscar en códigos secundarios
            const { data: codigoSec, error: errorCodigo } = await this.client
                .from('codigos_secundarios')
                .select('*, productos(*)')
                .eq('codigo_secundario', codigo)
                .maybeSingle();

            if (errorCodigo) {
                console.error('searchProductByCode codigos_secundarios:', errorCodigo);
                return null;
            }

            if (codigoSec && codigoSec.productos) {
                return codigoSec.productos;
            }

            return null;

        } catch (error) {
            console.error('Error al buscar producto:', error);
            return null;
        }
    }

    /**
     * Busca productos remotos por descripcion y/o codigo parcial.
     * Se usa como soporte temporal durante el modo hibrido de sincronizacion.
     * @param {Object} options
     * @param {string} options.description
     * @param {string} options.code
     * @param {number} options.limit
     * @returns {Promise<Array>}
     */
    async searchProductsRemoteCatalog(options = {}) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const rawDescription = options.description || '';
            const rawCode = options.code || '';
            const limit = Number(options.limit) > 0 ? Number(options.limit) : 200;
            const descriptionTerms = rawDescription
                .trim()
                .split(/\s+/)
                .map(term => term.trim())
                .filter(Boolean);
            const code = rawCode.trim().toUpperCase();

            if (!code && descriptionTerms.length === 0) {
                return [];
            }

            let query = this.client
                .from('productos')
                .select('*')
                .limit(limit)
                .order('codigo', { ascending: true });

            if (code) {
                query = query.ilike('codigo', `%${code}%`);
            }

            for (const term of descriptionTerms) {
                query = query.ilike('descripcion', `%${term}%`);
            }

            const { data, error } = await query;
            if (error) {
                throw error;
            }

            return data || [];
        } catch (error) {
            console.error('Error en busqueda remota de catalogo:', error);
            return [];
        }
    }

    /**
     * Crea un carrito en Supabase con el código QR escaneado
     */
    async createCart(codigoQR) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            // Verificar que el código QR existe y está activo
            const { data: carrito, error } = await this.client
                .from('carritos_clientes')
                .select('*')
                .eq('codigo_qr', codigoQR)
                .eq('estado', 'activo')
                .single();

            if (error || !carrito) {
                throw new Error('Codigo QR invalido o expirado');
            }

            console.log('Carrito vinculado correctamente:', carrito);
            return carrito;

        } catch (error) {
            console.error('Error al crear carrito:', error);
            throw error;
        }
    }

    /**
     * Añade un producto al carrito en Supabase
     */
    async addProductToCart(carritoId, producto, cantidad) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const subtotal = producto.pvp * cantidad;

            // Verificar si el producto ya existe en el carrito (.maybeSingle() evita 406 cuando hay 0 filas)
            const { data: existing, error: errorCheck } = await this.client
                .from('productos_carrito')
                .select('*')
                .eq('carrito_id', carritoId)
                .eq('codigo_producto', producto.codigo)
                .maybeSingle();

            if (existing) {
                // Actualizar cantidad
                const nuevaCantidad = existing.cantidad + cantidad;
                const nuevoSubtotal = producto.pvp * nuevaCantidad;

                const { data, error } = await this.client
                    .from('productos_carrito')
                    .update({
                        cantidad: nuevaCantidad,
                        subtotal: nuevoSubtotal,
                        fecha_actualizado: new Date().toISOString()
                    })
                    .eq('id', existing.id)
                    .select()
                    .single();

                if (error) throw error;
                return data;
            } else {
                // Insertar nuevo producto
                const { data, error } = await this.client
                    .from('productos_carrito')
                    .insert({
                        carrito_id: carritoId,
                        codigo_producto: producto.codigo,
                        descripcion_producto: producto.descripcion,
                        cantidad: cantidad,
                        precio_unitario: producto.pvp,
                        subtotal: subtotal
                    })
                    .select()
                    .single();

                if (error) throw error;
                return data;
            }

        } catch (error) {
            console.error('Error al añadir producto al carrito:', error);
            throw error;
        }
    }

    /**
     * Actualiza la cantidad de un producto en el carrito
     */
    async updateProductQuantity(carritoId, codigoProducto, nuevaCantidad) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            if (nuevaCantidad <= 0) {
                // Eliminar producto si la cantidad es 0
                return await this.removeProductFromCart(carritoId, codigoProducto);
            }

            // Obtener producto actual
            const { data: productoCarrito, error: errorGet } = await this.client
                .from('productos_carrito')
                .select('*')
                .eq('carrito_id', carritoId)
                .eq('codigo_producto', codigoProducto)
                .single();

            if (errorGet || !productoCarrito) {
                throw new Error('Producto no encontrado en el carrito');
            }

            const nuevoSubtotal = productoCarrito.precio_unitario * nuevaCantidad;

            // Actualizar cantidad
            const { data, error } = await this.client
                .from('productos_carrito')
                .update({
                    cantidad: nuevaCantidad,
                    subtotal: nuevoSubtotal,
                    fecha_actualizado: new Date().toISOString()
                })
                .eq('id', productoCarrito.id)
                .select()
                .single();

            if (error) throw error;
            return data;

        } catch (error) {
            console.error('Error al actualizar cantidad:', error);
            throw error;
        }
    }

    /**
     * Elimina un producto del carrito
     */
    async removeProductFromCart(carritoId, codigoProducto) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { error } = await this.client
                .from('productos_carrito')
                .delete()
                .eq('carrito_id', carritoId)
                .eq('codigo_producto', codigoProducto);

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error al eliminar producto:', error);
            throw error;
        }
    }

    /**
     * Obtiene el carrito actual con sus productos
     */
    async getCart(carritoId) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            // Obtener carrito
            const { data: carrito, error: errorCarrito } = await this.client
                .from('carritos_clientes')
                .select('*')
                .eq('id', carritoId)
                .single();

            if (errorCarrito) throw errorCarrito;

            // Obtener productos del carrito
            const { data: productos, error: errorProductos } = await this.client
                .from('productos_carrito')
                .select('*')
                .eq('carrito_id', carritoId)
                .order('fecha_agregado', { ascending: false });

            if (errorProductos) throw errorProductos;

            carrito.productos = productos || [];
            return carrito;

        } catch (error) {
            console.error('Error al obtener carrito:', error);
            throw error;
        }
    }

    /**
     * Marca el carrito como listo para checkout
     */
    async finalizeCart(carritoId) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            // El carrito se mantiene activo, el PC lo confirmará
            // Solo verificamos que tenga productos
            const carrito = await this.getCart(carritoId);
            
            if (!carrito.productos || carrito.productos.length === 0) {
                throw new Error('El carrito esta vacio');
            }

            return carrito;

        } catch (error) {
            console.error('Error al finalizar carrito:', error);
            throw error;
        }
    }

    /**
     * Hash de contraseña (SHA-256) - debe coincidir con el del panel de gestión
     */
    async _hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    _toAuthPassword(password) {
        const raw = (password != null) ? String(password) : '';
        return raw.length >= 6 ? raw : (raw + '__BM');
    }

    /**
     * Verifica credenciales y establece sesion Supabase Auth (JWT con app_metadata.usuario_id).
     * Llama a la API de login (Vercel) que crea/actualiza el usuario en Auth y devuelve el perfil.
     */
    async loginUser(codigoUsuario, password) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('Intentando login para usuario:', codigoUsuario);

            const apiBase = typeof window !== 'undefined' && window.location && window.location.origin
                ? window.location.origin
                : '';
            const loginUrl = apiBase ? `${apiBase}/api/auth/login` : '/api/auth/login';

            const response = await fetch(loginUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    codigo_usuario: codigoUsuario,
                    password: password
                })
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                if (response.status === 401) {
                    return { success: false, message: data.message || 'Usuario o contrasena incorrectos' };
                }
                return {
                    success: false,
                    message: data.message || 'Error de conexion. Intenta de nuevo.'
                };
            }

            if (!data.success || !data.email) {
                return {
                    success: false,
                    message: data.message || 'Usuario o contrasena incorrectos'
                };
            }

            const { error: signInError } = await this.client.auth.signInWithPassword({
                email: data.email,
                password: this._toAuthPassword(password)
            });

            if (signInError) {
                console.error('Error signInWithPassword:', signInError);
                return {
                    success: false,
                    message: 'Error al iniciar sesion. Intenta de nuevo.'
                };
            }

            console.log('Login exitoso (Supabase Auth):', data.user_name);
            const tipo = (data.tipo && String(data.tipo).toUpperCase()) || 'CLIENTE';
            return {
                success: true,
                user_id: data.user_id ?? null,
                user_name: data.user_name,
                codigo_usuario: data.codigo_usuario || codigoUsuario,
                grupo_cliente: data.grupo_cliente ?? null,
                tarifa: data.tarifa != null && String(data.tarifa).trim() !== '' ? String(data.tarifa).trim() : null,
                codigo_usuario_titular: data.codigo_usuario_titular ?? null,
                almacen_habitual: data.almacen_habitual ?? null,
                es_operario: !!data.es_operario,
                nombre_operario: data.nombre_operario || null,
                nombre_titular: data.nombre_titular || null,
                tipo: tipo,
                es_comercial: tipo === 'COMERCIAL' || !!data.es_comercial,
                es_dependiente: tipo === 'DEPENDIENTE' || !!data.es_dependiente,
                almacen_tienda: data.almacen_tienda ?? null,
                es_administrador: !!data.es_administrador,
                es_administracion: tipo === 'ADMINISTRACION' || !!data.es_administracion,
                comercial_id: data.comercial_id ?? null,
                comercial_numero: data.comercial_numero ?? null
            };
        } catch (error) {
            console.error('Error al verificar login:', error);
            return {
                success: false,
                message: 'Error de conexion. Intenta de nuevo.'
            };
        }
    }

    /**
     * Obtiene los datos del comercial asignado al usuario (nombre, telefono, email)
     * @param {number} userId - ID del usuario (usuarios.id)
     * @returns {Promise<{nombre: string, telefono: string, email: string}|null>}
     */
    async getComercialAsignado(userId) {
        try {
            if (!this.client || !userId) return null;
            const { data, error } = await this.client.rpc('get_comercial_por_usuario', {
                p_user_id: userId
            });
            if (error) {
                console.error('Error getComercialAsignado:', error);
                return null;
            }
            if (data && data.length > 0 && data[0].nombre) {
                return {
                    nombre: data[0].nombre || '',
                    telefono: data[0].telefono || '',
                    email: data[0].email || ''
                };
            }
            return null;
        } catch (err) {
            console.error('getComercialAsignado:', err);
            return null;
        }
    }

    /**
     * Lista los clientes asignados a un comercial (usuarios donde comercial_asignado = numero del comercial).
     * Para que el comercial seleccione a quien representar en la app.
     * @param {number} comercialNumero - Numero del comercial (usuarios_comerciales.numero)
     * @returns {Promise<Array<{id: number, nombre: string, codigo_usuario: string}>>}
     */
    async getClientesAsignadosComercial(comercialNumero) {
        try {
            if (!this.client || comercialNumero == null) return [];
            const num = typeof comercialNumero === 'string' ? parseInt(comercialNumero, 10) : comercialNumero;
            if (isNaN(num)) return [];
            const { data, error } = await this.client.rpc('get_clientes_asignados_comercial', {
                p_comercial_numero: num
            });
            if (error) {
                console.error('Error getClientesAsignadosComercial:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getClientesAsignadosComercial:', err);
            return [];
        }
    }

    /**
     * Obtiene todos los pedidos de los clientes asignados a un comercial en una sola consulta.
     * Usa la RPC get_pedidos_comercial (JOIN carritos_clientes + usuarios).
     * Devuelve los pedidos ya ordenados: COMPLETADO al final, resto por fecha DESC.
     * Cada pedido incluye cliente_nombre para mostrarlo en la tarjeta.
     * @param {number} comercialNumero - Numero del comercial (usuarios_comerciales.numero)
     * @returns {Promise<Array>}
     */
    async getPedidosComercial(comercialNumero) {
        try {
            if (!this.client || comercialNumero == null) return [];
            const num = typeof comercialNumero === 'string' ? parseInt(comercialNumero, 10) : comercialNumero;
            if (isNaN(num)) return [];
            const { data, error } = await this.client.rpc('get_pedidos_comercial', {
                p_comercial_numero: num
            });
            if (error) {
                console.error('Error getPedidosComercial:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getPedidosComercial:', err);
            return [];
        }
    }

    /**
     * Lista los clientes que puede atender un dependiente (segun su tienda).
     * @param {number} dependienteUserId - ID del dependiente (usuarios.id)
     * @returns {Promise<Array<{id: number, nombre: string, codigo_usuario: string}>>}
     */
    async getClientesDependiente(dependienteUserId) {
        try {
            if (!this.client || dependienteUserId == null) return [];
            const id = typeof dependienteUserId === 'string' ? parseInt(dependienteUserId, 10) : dependienteUserId;
            if (isNaN(id)) return [];
            const { data, error } = await this.client.rpc('get_clientes_dependiente', {
                p_dependiente_user_id: id
            });
            if (error) {
                console.error('Error getClientesDependiente:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getClientesDependiente:', err);
            return [];
        }
    }

    /**
     * Lista clientes del dependiente ordenados por frecuencia de uso (mas representados primero).
     * Para rellenar la lista local del selector.
     * @param {number} dependienteUserId - ID del dependiente (usuarios.id)
     * @param {number} [limit=200] - Maximo de clientes a devolver
     * @returns {Promise<Array<{id: number, nombre: string, codigo_usuario: string, alias?: string, poblacion?: string}>>}
     */
    async getClientesDependientePorFrecuencia(dependienteUserId, limit) {
        try {
            if (!this.client || dependienteUserId == null) return [];
            const id = typeof dependienteUserId === 'string' ? parseInt(dependienteUserId, 10) : dependienteUserId;
            if (isNaN(id)) return [];
            const lim = (limit != null && !isNaN(limit)) ? Math.min(500, Math.max(1, parseInt(limit, 10))) : 200;
            const { data, error } = await this.client.rpc('get_clientes_dependiente_por_frecuencia', {
                p_dependiente_user_id: id,
                p_limit: lim
            });
            if (error) {
                console.error('Error getClientesDependientePorFrecuencia:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getClientesDependientePorFrecuencia:', err);
            return [];
        }
    }

    /**
     * Busca clientes globales para dependiente por texto (nombre, codigo, alias, poblacion).
     * Orden: frecuencia de ese dependiente y luego nombre.
     * @param {number} dependienteUserId - ID del dependiente (usuarios.id)
     * @param {string} query - Texto a buscar (puede ser vacio para devolver todos hasta limit)
     * @param {number} [limit=100] - Maximo de resultados
     * @returns {Promise<Array<{id: number, nombre: string, codigo_usuario: string, alias?: string, poblacion?: string}>>}
     */
    async buscarClientesDependiente(dependienteUserId, query, limit) {
        try {
            if (!this.client || dependienteUserId == null) return [];
            const id = typeof dependienteUserId === 'string' ? parseInt(dependienteUserId, 10) : dependienteUserId;
            if (isNaN(id)) return [];
            const q = (query != null && typeof query === 'string') ? query.trim() : '';
            const lim = (limit != null && !isNaN(limit)) ? Math.min(200, Math.max(1, parseInt(limit, 10))) : 100;
            const { data, error } = await this.client.rpc('buscar_clientes_dependiente', {
                p_dependiente_user_id: id,
                p_query: q,
                p_limit: lim
            });
            if (error) {
                console.error('Error buscarClientesDependiente:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('buscarClientesDependiente:', err);
            return [];
        }
    }

    /**
     * Registra que el dependiente ha elegido representar a un cliente (incrementa ranking).
     * Llamar en segundo plano al seleccionar cliente; no bloquea.
     * @param {number} dependienteUserId - ID del dependiente (usuarios.id)
     * @param {number} clienteUserId - ID del cliente representado (usuarios.id)
     * @returns {Promise<void>}
     */
    async registrarRepresentacionDependiente(dependienteUserId, clienteUserId) {
        try {
            if (!this.client || dependienteUserId == null || clienteUserId == null) return;
            const depId = typeof dependienteUserId === 'string' ? parseInt(dependienteUserId, 10) : dependienteUserId;
            const cliId = typeof clienteUserId === 'string' ? parseInt(clienteUserId, 10) : clienteUserId;
            if (isNaN(depId) || isNaN(cliId)) return;
            await this.client.rpc('registrar_representacion_dependiente', {
                p_dependiente_user_id: depId,
                p_cliente_user_id: cliId
            });
        } catch (err) {
            console.warn('registrarRepresentacionDependiente (no critico):', err);
        }
    }

    /**
     * Obtiene pedidos de clientes atendibles por el dependiente (vista agregada por tienda).
     * @param {number} dependienteUserId - ID del dependiente (usuarios.id)
     * @returns {Promise<Array>}
     */
    async getPedidosDependiente(dependienteUserId) {
        try {
            if (!this.client || dependienteUserId == null) return [];
            const id = typeof dependienteUserId === 'string' ? parseInt(dependienteUserId, 10) : dependienteUserId;
            if (isNaN(id)) return [];
            const { data, error } = await this.client.rpc('get_pedidos_dependiente', {
                p_dependiente_user_id: id
            });
            if (error) {
                console.error('Error getPedidosDependiente:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getPedidosDependiente:', err);
            return [];
        }
    }

    async getPrepedidosComercial(comercialNumero) {
        try {
            if (!this.client || comercialNumero == null) return [];
            const num = typeof comercialNumero === 'string' ? parseInt(comercialNumero, 10) : comercialNumero;
            if (isNaN(num)) return [];
            const { data, error } = await this.client.rpc('get_prepedidos_comercial', {
                p_comercial_numero: num
            });
            if (error) {
                console.error('Error getPrepedidosComercial:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getPrepedidosComercial:', err);
            return [];
        }
    }

    async getComercialIdByNumero(comercialNumero) {
        try {
            if (!this.client || comercialNumero == null) return null;
            const num = typeof comercialNumero === 'string' ? parseInt(comercialNumero, 10) : comercialNumero;
            if (isNaN(num)) return null;
            const { data, error } = await this.client
                .from('usuarios_comerciales')
                .select('id')
                .eq('numero', num)
                .limit(1)
                .maybeSingle();
            if (error) {
                console.error('getComercialIdByNumero:', error);
                return null;
            }
            return data && data.id != null ? Number(data.id) : null;
        } catch (err) {
            console.error('getComercialIdByNumero:', err);
            return null;
        }
    }

    async getPrepedidosDependiente(dependienteUserId) {
        try {
            if (!this.client || dependienteUserId == null) return [];
            const id = typeof dependienteUserId === 'string' ? parseInt(dependienteUserId, 10) : dependienteUserId;
            if (isNaN(id)) return [];
            const { data, error } = await this.client.rpc('get_prepedidos_dependiente', {
                p_dependiente_user_id: id
            });
            if (error) {
                console.error('Error getPrepedidosDependiente:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getPrepedidosDependiente:', err);
            return [];
        }
    }

    /**
     * Cambia la contraseña del usuario (verifica la actual con hash)
     * @param {number} userId - ID interno del usuario (solo validacion de consistencia)
     * @param {string} codigoUsuario - Codigo de usuario (estandar para identificar al usuario)
     * @param {string} passwordActual - Contraseña actual en texto
     * @param {string} passwordNueva - Contraseña nueva en texto
     * @returns {Promise<{success: boolean, message?: string}>}
     */
    async cambiarPassword(userId, codigoUsuario, passwordActual, passwordNueva) {
        try {
            if (!this.client || !codigoUsuario) {
                throw new Error('Cliente no inicializado o codigo de usuario no indicado');
            }
            const apiBase = typeof window !== 'undefined' && window.location && window.location.origin
                ? window.location.origin
                : '';
            const url = apiBase ? `${apiBase}/api/auth/change-password-user` : '/api/auth/change-password-user';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    codigo_usuario: codigoUsuario,
                    password_actual: passwordActual,
                    password_nueva: passwordNueva
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const detail = payload && payload.detail ? String(payload.detail) : '';
                return {
                    success: false,
                    message: detail ? ((payload.message || 'Error al cambiar contrasena') + ' (' + detail + ')') : (payload.message || 'Error al cambiar contrasena')
                };
            }
            return {
                success: !!payload.success,
                message: payload.message || null
            };
        } catch (err) {
            console.error('cambiarPassword:', err);
            return { success: false, message: (err && err.message) || 'Error al cambiar contrasena' };
        }
    }

    /**
     * Cambia la contrasena de un comercial verificando la actual.
     * Utiliza la RPC cambiar_password_comercial que actua sobre usuarios_comerciales.
     * @param {number} comercialId - ID del comercial (usuarios_comerciales.id)
     * @param {string} passwordActual - Contrasena actual en texto plano
     * @param {string} passwordNueva - Nueva contrasena en texto plano
     */
    async cambiarPasswordComercial(comercialId, passwordActual, passwordNueva) {
        try {
            if (!this.client || !comercialId) {
                throw new Error('Cliente no inicializado o comercial no indicado');
            }
            const hashActual = await this._hashPassword(passwordActual);
            const hashNueva = await this._hashPassword(passwordNueva);
            const { data, error } = await this.client.rpc('cambiar_password_comercial', {
                p_comercial_id: comercialId,
                p_password_actual_hash: hashActual,
                p_password_nueva_hash: hashNueva
            });
            if (error) throw error;
            if (data && data.length > 0) {
                const r = data[0];
                return { success: !!r.success, message: r.message || null };
            }
            return { success: false, message: 'Error desconocido' };
        } catch (err) {
            console.error('cambiarPasswordComercial:', err);
            return { success: false, message: (err && err.message) || 'Error al cambiar contrasena' };
        }
    }

    /**
     * Lista los operarios del usuario titular
     * @param {number} usuarioId - ID del usuario (titular)
     * @returns {Promise<Array<{id: number, codigo_operario: string, nombre_operario: string, activo: boolean}>>}
     */
    async getOperarios(usuarioId) {
        try {
            if (!this.client || !usuarioId) return [];
            const { data, error } = await this.client.rpc('listar_operarios', { p_usuario_id: usuarioId });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getOperarios:', err);
            return [];
        }
    }

    /**
     * Crea un operario para el usuario
     * @param {number} usuarioId - ID del titular
     * @param {string} codigoOperario - Código del operario (ej: 01)
     * @param {string} nombreOperario - Nombre a mostrar
     * @param {string} password - Contraseña en texto (se hasheará)
     * @returns {Promise<{success: boolean, operarioId?: number, message?: string}>}
     */
    async addOperario(usuarioId, codigoOperario, nombreOperario, password) {
        try {
            if (!this.client || !usuarioId) {
                throw new Error('Cliente no inicializado o usuario no indicado');
            }
            const passwordHash = await this._hashPassword(password);
            const { data, error } = await this.client.rpc('crear_operario', {
                p_usuario_id: usuarioId,
                p_codigo_operario: String(codigoOperario).trim(),
                p_nombre_operario: String(nombreOperario).trim(),
                p_password_hash: passwordHash
            });
            if (error) throw error;
            if (data && data.length > 0) {
                const r = data[0];
                return {
                    success: !!r.success,
                    operarioId: r.operario_id || null,
                    message: r.message || null
                };
            }
            return { success: false, message: 'Error desconocido' };
        } catch (err) {
            console.error('addOperario:', err);
            return { success: false, message: (err && err.message) || 'Error al crear operario' };
        }
    }

    /**
     * Elimina un operario del usuario
     * @param {number} usuarioId - ID del titular
     * @param {number} operarioId - ID del operario
     * @returns {Promise<{success: boolean, message?: string}>}
     */
    async removeOperario(usuarioId, operarioId) {
        try {
            if (!this.client || !usuarioId || !operarioId) {
                throw new Error('Datos incompletos');
            }
            const { data, error } = await this.client.rpc('eliminar_operario', {
                p_usuario_id: usuarioId,
                p_operario_id: operarioId
            });
            if (error) throw error;
            if (data && data.length > 0) {
                const r = data[0];
                return { success: !!r.success, message: r.message || null };
            }
            return { success: false, message: 'Error desconocido' };
        } catch (err) {
            console.error('removeOperario:', err);
            return { success: false, message: (err && err.message) || 'Error al eliminar operario' };
        }
    }

    /**
     * Crea una sesión de usuario en Supabase
     */
    async createUserSession(codigoUsuario) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { data, error } = await this.client.rpc(
                'crear_sesion_usuario',
                { p_codigo_usuario: codigoUsuario }
            );

            if (error) throw error;

            console.log('Sesion creada con ID:', data);
            return data; // ID de la sesión

        } catch (error) {
            console.error('Error al crear sesion:', error);
            return null;
        }
    }

    /**
     * Cierra la sesión de usuario
     */
    async closeUserSession(sessionId) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { data, error } = await this.client.rpc(
                'cerrar_sesion_usuario',
                { p_sesion_id: sessionId }
            );

            if (error) throw error;

            console.log('Sesion cerrada exitosamente');
            return true;

        } catch (error) {
            console.error('Error al cerrar sesion:', error);
            return false;
        }
    }

    /**
     * Cierra la sesion de Supabase Auth (JWT). Llamar al cerrar sesion en la app.
     */
    async signOutAuth() {
        try {
            if (this.client && this.client.auth) {
                await this.client.auth.signOut();
            }
        } catch (e) {
            console.warn('signOutAuth:', e);
        }
    }

    /**
     * Asegura que la sesion de Supabase Auth sea valida para escrituras (RLS).
     * Refresca el JWT si hace falta. Si no hay sesion o el refresh falla, devuelve ok: false.
     * @returns {Promise<{ok: boolean}>}
     */
    async ensureAuthSessionForWrite() {
        try {
            if (!this.client || !this.client.auth) return { ok: false };
            const { data: sessionData } = await this.client.auth.getSession();
            if (!sessionData?.session) return { ok: false };
            const { data: refreshData, error } = await this.client.auth.refreshSession();
            if (error || !refreshData?.session) return { ok: false };
            return { ok: true };
        } catch (e) {
            console.warn('ensureAuthSessionForWrite:', e);
            return { ok: false };
        }
    }

    /**
     * Asocia un carrito a una sesión de usuario
     */
    async associateCartToSession(sessionId, carritoCode) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { data, error } = await this.client.rpc(
                'asociar_carrito_a_sesion',
                { 
                    p_sesion_id: sessionId,
                    p_carrito_codigo: carritoCode
                }
            );

            if (error) throw error;

            console.log('Carrito asociado a sesion');
            return true;

        } catch (error) {
            console.error('Error al asociar carrito a sesion:', error);
            return false;
        }
    }

    /**
     * Obtiene el historial de compras de un usuario (versión legacy)
     * @deprecated Use getUserPurchaseHistoryOptimized for better performance
     */
    async getUserPurchaseHistory(userId, codigoFiltro = null, descripcionFiltro = null) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('Obteniendo historial de compras para usuario:', userId);

            const { data, error } = await this.client.rpc(
                'obtener_historial_usuario',
                {
                    p_usuario_id: userId,
                    p_codigo_filtro: codigoFiltro,
                    p_descripcion_filtro: descripcionFiltro
                }
            );

            if (error) throw error;

            console.log(`Historial obtenido: ${data ? data.length : 0} productos`);
            return data || [];

        } catch (error) {
            console.error('Error al obtener historial de compras:', error);
            return [];
        }
    }

    /**
     * Obtiene el historial de compras de un usuario (OPTIMIZADO)
     * Usa la tabla productos_comprados_usuario para consultas ultrarrápidas
     * Performance: 10-50x más rápido que getUserPurchaseHistory
     */
    async getUserPurchaseHistoryOptimized(userId, codigoFiltro = null, descripcionFiltro = null) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('⚡ Obteniendo historial optimizado para usuario:', userId);
            const startTime = performance.now();

            const { data, error } = await this.client.rpc(
                'buscar_productos_historial_usuario_optimizado',
                {
                    p_usuario_id: userId,
                    p_codigo: codigoFiltro,
                    p_descripcion: descripcionFiltro
                }
            );

            if (error) {
                console.warn('❌ Error en función optimizada, intentando fallback...', error);
                // Fallback to legacy function if optimized one doesn't exist yet
                return await this.getUserPurchaseHistory(userId, codigoFiltro, descripcionFiltro);
            }

            const queryTime = Math.round(performance.now() - startTime);
            console.log(`✅ Historial optimizado obtenido: ${data ? data.length : 0} productos en ${queryTime}ms`);
            
            return data || [];

        } catch (error) {
            console.error('Error al obtener historial optimizado:', error);
            // Fallback to legacy function
            console.log('🔄 Usando función legacy como fallback...');
            return await this.getUserPurchaseHistory(userId, codigoFiltro, descripcionFiltro);
        }
    }

    /**
     * Elimina un producto del historial de compras de un usuario
     */
    async deleteProductFromHistory(userId, codigoProducto) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log(`Eliminando producto ${codigoProducto} del historial del usuario ${userId}`);

            const { data, error } = await this.client.rpc(
                'eliminar_producto_historial',
                {
                    p_usuario_id: userId,
                    p_codigo_producto: codigoProducto
                }
            );

            if (error) throw error;

            console.log('Producto eliminado del historial');
            return true;

        } catch (error) {
            console.error('Error al eliminar producto del historial:', error);
            return false;
        }
    }

    /**
     * Crea un pedido remoto para un usuario y almacén específico.
     * @param {number} usuarioId - ID del usuario titular
     * @param {string} almacenDestino - Código del almacén destino
     * @param {string} [observaciones] - Observaciones del pedido (opcional)
     * @param {string} [nombreOperario] - Nombre del operario si el pedido lo hace un operario (opcional)
     */
    async crearPedidoRemoto(usuarioId, almacenDestino, observaciones, nombreOperario) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log(`Creando pedido remoto para usuario ${usuarioId} -> almacén ${almacenDestino}`);

            // Llamar a la función SQL para crear pedido remoto
            const { data, error } = await this.client.rpc(
                'crear_pedido_remoto',
                {
                    p_usuario_id: usuarioId,
                    p_almacen_destino: almacenDestino,
                    p_observaciones: observaciones != null ? String(observaciones).trim() || null : null,
                    p_nombre_operario: nombreOperario != null ? String(nombreOperario).trim() || null : null
                }
            );

            if (error) throw error;

            if (data && data.length > 0) {
                const result = data[0];
                
                if (result.success) {
                    console.log('Pedido remoto creado exitosamente:', result.codigo_qr);
                    return {
                        success: true,
                        carrito_id: result.carrito_id,
                        codigo_qr: result.codigo_qr,
                        codigo_cliente_usuario: result.codigo_cliente_usuario || null
                    };
                } else {
                    console.error('Error al crear pedido remoto:', result.message);
                    return {
                        success: false,
                        message: result.message
                    };
                }
            }

            return {
                success: false,
                message: 'No se recibio respuesta del servidor'
            };

        } catch (error) {
            console.error('Error al crear pedido remoto:', error);
            const msg = (error && (error.message || error.error_description || String(error))) ? String(error.message || error.error_description || error) : 'Error de conexion. Intenta de nuevo.';
            return {
                success: false,
                message: msg,
                is_connection_error: this.isNetworkError(error)
            };
        }
    }

    /**
     * Crea un pedido remoto "sin impresión automática" para checkout_pc.
     * Se inserta con estado en_preparacion/procesando y pc_id no-nulo para que checkout_pc no lo reclame para imprimir.
     * @param {number} usuarioId - ID del usuario titular
     * @param {string} almacenDestino - Código del almacén destino
     * @param {string} [observaciones] - Observaciones del pedido (opcional)
     * @param {string} [nombreOperario] - Nombre del operario si el pedido lo hace un operario (opcional)
     */
    async crearPedidoRemotoSinImprimir(usuarioId, almacenDestino, observaciones, nombreOperario) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { data, error } = await this.client.rpc(
                'crear_pedido_remoto_sin_imprimir',
                {
                    p_usuario_id: usuarioId,
                    p_almacen_destino: almacenDestino,
                    p_observaciones: observaciones != null ? String(observaciones).trim() || null : null,
                    p_nombre_operario: nombreOperario != null ? String(nombreOperario).trim() || null : null
                }
            );

            if (error) throw error;

            if (data && data.length > 0) {
                const result = data[0];
                if (result.success) {
                    return {
                        success: true,
                        carrito_id: result.carrito_id,
                        codigo_qr: result.codigo_qr,
                        codigo_cliente_usuario: result.codigo_cliente_usuario || null
                    };
                }

                return {
                    success: false,
                    message: result.message
                };
            }

            return {
                success: false,
                message: 'No se recibio respuesta del servidor'
            };
        } catch (error) {
            console.error('Error al crear pedido remoto sin imprimir:', error);
            const msg = (error && (error.message || error.error_description || String(error))) ? String(error.message || error.error_description || error) : 'Error de conexion. Intenta de nuevo.';
            return {
                success: false,
                message: msg,
                is_connection_error: this.isNetworkError(error)
            };
        }
    }

    async crearPrepedido(usuarioId, almacenDestino, observaciones, nombreOperario, cart) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }
            const productos = ((cart && Array.isArray(cart.productos)) ? cart.productos : [])
                .map((p) => ({
                    codigo_producto: p.codigo_producto || p.codigo,
                    descripcion_producto: p.descripcion_producto || p.descripcion || '',
                    cantidad: Number(p.cantidad || 0),
                    precio_unitario: Number(p.precio_unitario || p.pvp || 0)
                }))
                .filter((p) => p.codigo_producto && p.cantidad > 0);
            if (productos.length === 0) {
                return { success: false, message: 'El prepedido no tiene productos' };
            }

            const { data, error } = await this.client.rpc('crear_prepedido', {
                p_usuario_id: usuarioId,
                p_almacen_destino: almacenDestino || null,
                p_observaciones: observaciones != null ? String(observaciones).trim() || null : null,
                p_nombre_operario: nombreOperario != null ? String(nombreOperario).trim() || null : null,
                p_productos: productos
            });
            if (error) throw error;

            if (data && data.length > 0) {
                const result = data[0];
                if (result.success) {
                    return {
                        success: true,
                        prepedido_id: result.prepedido_id,
                        codigo_qr: result.codigo_qr
                    };
                }
                return { success: false, message: result.message || 'No se pudo guardar el prepedido' };
            }
            return { success: false, message: 'No se recibio respuesta del servidor' };
        } catch (error) {
            console.error('crearPrepedido:', error);
            return {
                success: false,
                message: 'Error de conexion. Intenta de nuevo.'
            };
        }
    }

    async actualizarPrepedido(prepedidoId, usuarioId, almacenDestino, observaciones, nombreOperario, cart) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }
            const productos = ((cart && Array.isArray(cart.productos)) ? cart.productos : [])
                .map((p) => ({
                    codigo_producto: p.codigo_producto || p.codigo,
                    descripcion_producto: p.descripcion_producto || p.descripcion || '',
                    cantidad: Number(p.cantidad || 0),
                    precio_unitario: Number(p.precio_unitario || p.pvp || 0)
                }))
                .filter((p) => p.codigo_producto && p.cantidad > 0);
            if (productos.length === 0) {
                return { success: false, message: 'El prepedido no tiene productos' };
            }

            const { data, error } = await this.client.rpc('actualizar_prepedido', {
                p_prepedido_id: prepedidoId,
                p_usuario_id: usuarioId,
                p_almacen_destino: almacenDestino || null,
                p_observaciones: observaciones != null ? String(observaciones).trim() || null : null,
                p_nombre_operario: nombreOperario != null ? String(nombreOperario).trim() || null : null,
                p_productos: productos
            });
            if (error) throw error;
            if (data && data.length > 0) {
                return {
                    success: !!data[0].success,
                    message: data[0].message || '',
                    prepedido_id: data[0].prepedido_id || prepedidoId
                };
            }
            return { success: false, message: 'No se recibio respuesta del servidor' };
        } catch (error) {
            console.error('actualizarPrepedido:', error);
            return { success: false, message: 'No se pudo actualizar el prepedido' };
        }
    }

    async getUserPrepedidos(usuarioId) {
        try {
            if (!this.client || usuarioId == null) return [];
            const id = typeof usuarioId === 'string' ? parseInt(usuarioId, 10) : usuarioId;
            if (isNaN(id)) return [];
            const { data, error } = await this.client.rpc('get_prepedidos_usuario', {
                p_usuario_id: id
            });
            if (error) {
                console.error('Error getUserPrepedidos:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getUserPrepedidos:', err);
            return [];
        }
    }

    async eliminarPrepedido(prepedidoId, usuarioId) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }
            const { data, error } = await this.client.rpc('eliminar_prepedido', {
                p_prepedido_id: prepedidoId,
                p_usuario_id: usuarioId
            });
            if (error) throw error;
            if (data && data.length > 0) {
                return {
                    success: !!data[0].success,
                    message: data[0].message || ''
                };
            }
            return { success: false, message: 'No se recibio respuesta del servidor' };
        } catch (error) {
            console.error('eliminarPrepedido:', error);
            return { success: false, message: 'No se pudo eliminar el prepedido' };
        }
    }

    async convertirPrepedidoAPedidoRemoto(prepedidoId, usuarioId, almacenDestino, observaciones, nombreOperario) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }
            const { data, error } = await this.client.rpc('convertir_prepedido_a_pedido_remoto', {
                p_prepedido_id: prepedidoId,
                p_usuario_id: usuarioId,
                p_almacen_destino: almacenDestino || null,
                p_observaciones: observaciones != null ? String(observaciones).trim() || null : null,
                p_nombre_operario: nombreOperario != null ? String(nombreOperario).trim() || null : null
            });
            if (error) throw error;
            if (data && data.length > 0) {
                const row = data[0];
                return {
                    success: !!row.success,
                    message: row.message || '',
                    carrito_id: row.carrito_id,
                    codigo_qr: row.codigo_qr,
                    codigo_cliente_usuario: row.codigo_cliente_usuario || null
                };
            }
            return { success: false, message: 'No se recibio respuesta del servidor' };
        } catch (error) {
            console.error('convertirPrepedidoAPedidoRemoto:', error);
            return { success: false, message: 'No se pudo aceptar el prepedido' };
        }
    }

    async crearPresupuesto(usuarioIdCliente, comercialId, almacenHabitual, observaciones, lineasPreparadas) {
        try {
            if (!this.client) throw new Error('Cliente de Supabase no inicializado');
            const raw = Array.isArray(lineasPreparadas) ? lineasPreparadas : [];
            const lineas = raw
                .map((p) => ({
                    codigo: p.codigo || p.codigo_producto || '',
                    descripcion: p.descripcion || p.descripcion_producto || '',
                    cantidad: Number(p.cantidad || 0),
                    precio_unitario: Number(p.precio_unitario != null ? p.precio_unitario : p.pvp || 0),
                    dto_pct: Number(p.dto_pct != null && p.dto_pct !== '' ? p.dto_pct : 0)
                }))
                .filter((l) => l.codigo && l.cantidad > 0);
            if (!lineas.length) {
                return { success: false, message: 'El presupuesto no tiene lineas' };
            }
            const { data, error } = await this.client.rpc('crear_presupuesto', {
                p_usuario_id_cliente: usuarioIdCliente,
                p_comercial_id: comercialId,
                p_almacen_habitual: almacenHabitual || null,
                p_observaciones: observaciones != null ? String(observaciones).trim() || null : null,
                p_lineas: lineas
            });
            if (error) throw error;
            if (Array.isArray(data) && data.length > 0) {
                const row = data[0];
                return {
                    success: !!row.success,
                    message: row.message || '',
                    presupuesto_id: row.presupuesto_id || null,
                    numero_presupuesto: row.numero_presupuesto || null
                };
            }
            return { success: false, message: 'No se recibio respuesta del servidor' };
        } catch (error) {
            console.error('crearPresupuesto:', error);
            return { success: false, message: 'No se pudo guardar el presupuesto' };
        }
    }

    async actualizarPresupuesto(presupuestoId, comercialId, almacenHabitual, observaciones, lineasPreparadas) {
        try {
            if (!this.client) throw new Error('Cliente de Supabase no inicializado');
            const raw = Array.isArray(lineasPreparadas) ? lineasPreparadas : [];
            const lineas = raw
                .map((p) => ({
                    codigo: p.codigo || p.codigo_producto || '',
                    descripcion: p.descripcion || p.descripcion_producto || '',
                    cantidad: Number(p.cantidad || 0),
                    precio_unitario: Number(p.precio_unitario != null ? p.precio_unitario : p.pvp || 0),
                    dto_pct: Number(p.dto_pct != null && p.dto_pct !== '' ? p.dto_pct : 0)
                }))
                .filter((l) => l.codigo && l.cantidad > 0);
            if (!lineas.length) {
                return { success: false, message: 'El presupuesto no tiene lineas' };
            }
            const { data, error } = await this.client.rpc('actualizar_presupuesto', {
                p_presupuesto_id: presupuestoId,
                p_comercial_id: comercialId,
                p_almacen_habitual: almacenHabitual || null,
                p_observaciones: observaciones != null ? String(observaciones).trim() || null : null,
                p_lineas: lineas
            });
            if (error) throw error;
            if (Array.isArray(data) && data.length > 0) {
                return { success: !!data[0].success, message: data[0].message || '', presupuesto_id: data[0].presupuesto_id || presupuestoId };
            }
            return { success: false, message: 'No se recibio respuesta del servidor' };
        } catch (error) {
            console.error('actualizarPresupuesto:', error);
            return { success: false, message: 'No se pudo actualizar el presupuesto' };
        }
    }

    async getPresupuestosUsuario(usuarioId) {
        try {
            if (!this.client || usuarioId == null) return [];
            const id = typeof usuarioId === 'string' ? parseInt(usuarioId, 10) : usuarioId;
            if (isNaN(id)) return [];
            const { data, error } = await this.client.rpc('get_presupuestos_usuario', { p_usuario_id: id });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error('getPresupuestosUsuario:', error);
            return [];
        }
    }

    async getPresupuestosComercial(comercialId) {
        try {
            if (!this.client || comercialId == null) return [];
            const id = typeof comercialId === 'string' ? parseInt(comercialId, 10) : comercialId;
            if (isNaN(id)) return [];
            const { data, error } = await this.client.rpc('get_presupuestos_comercial', { p_comercial_id: id });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error('getPresupuestosComercial:', error);
            return [];
        }
    }

    async getPresupuestosPorCreador(creadorUsuarioId) {
        try {
            if (!this.client || creadorUsuarioId == null) return [];
            const id = typeof creadorUsuarioId === 'string' ? parseInt(creadorUsuarioId, 10) : creadorUsuarioId;
            if (isNaN(id)) return [];
            const { data, error } = await this.client.rpc('get_presupuestos_por_creador', {
                p_creador_usuario_id: id
            });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error('getPresupuestosPorCreador:', error);
            return [];
        }
    }

    async getPresupuestoDetalle(presupuestoId) {
        try {
            if (!this.client || !presupuestoId) return null;
            const { data, error } = await this.client.rpc('get_presupuesto_detalle', { p_presupuesto_id: presupuestoId });
            if (error) throw error;
            return Array.isArray(data) && data.length ? data[0] : null;
        } catch (error) {
            console.error('getPresupuestoDetalle:', error);
            return null;
        }
    }

    async cambiarEstadoPresupuesto(presupuestoId, estado, comercialId) {
        try {
            if (!this.client || !presupuestoId || !estado) return { success: false, message: 'Datos incompletos' };
            const { data, error } = await this.client.rpc('cambiar_estado_presupuesto', {
                p_presupuesto_id: presupuestoId,
                p_estado: estado,
                p_comercial_id: comercialId || null
            });
            if (error) throw error;
            if (Array.isArray(data) && data.length > 0) return { success: !!data[0].success, message: data[0].message || '' };
            return { success: false, message: 'No se recibio respuesta del servidor' };
        } catch (error) {
            console.error('cambiarEstadoPresupuesto:', error);
            return { success: false, message: 'No se pudo cambiar el estado del presupuesto' };
        }
    }

    async eliminarPresupuesto(presupuestoId, comercialId) {
        try {
            if (!this.client || !presupuestoId) return { success: false, message: 'Presupuesto invalido' };
            const { data, error } = await this.client.rpc('eliminar_presupuesto', {
                p_presupuesto_id: presupuestoId,
                p_comercial_id: comercialId || null
            });
            if (error) throw error;
            if (Array.isArray(data) && data.length > 0) return { success: !!data[0].success, message: data[0].message || '' };
            return { success: false, message: 'No se recibio respuesta del servidor' };
        } catch (error) {
            console.error('eliminarPresupuesto:', error);
            return { success: false, message: 'No se pudo eliminar el presupuesto' };
        }
    }

    async generarPdfPresupuesto(presupuestoId) {
        try {
            const apiBase = typeof window !== 'undefined' && window.location && window.location.origin
                ? window.location.origin
                : '';
            const url = apiBase ? `${apiBase}/api/quotes/generate-pdf` : '/api/quotes/generate-pdf';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ presupuesto_id: presupuestoId })
            });
            if (!response.ok) {
                let msg = 'No se pudo generar el PDF';
                try {
                    const payload = await response.json();
                    msg = payload && payload.message ? payload.message : msg;
                } catch (_) {}
                return { success: false, message: msg };
            }
            const blob = await response.blob();
            const fileName = 'presupuesto-' + String(presupuestoId) + '.pdf';
            return { success: true, blob, fileName };
        } catch (error) {
            console.error('generarPdfPresupuesto:', error);
            return { success: false, message: 'Error de conexion al generar PDF' };
        }
    }

    /**
     * Actualiza el identificador de pedido ERP en un carrito/pedido remoto
     */
    async updatePedidoErp(carritoId, pedidoErp) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }
            const valor = pedidoErp != null ? String(pedidoErp) : null;
            const { error } = await this.client
                .from('carritos_clientes')
                .update({ pedido_erp: valor })
                .eq('id', carritoId);
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error al actualizar pedido_erp:', error);
            throw error;
        }
    }

    /**
     * Añade un producto a un pedido remoto
     */
    async addProductToRemoteOrder(carritoId, producto, cantidad) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            // Usar la función existente para añadir productos al carrito
            return await this.addProductToCart(carritoId, producto, cantidad);

        } catch (error) {
            console.error('Error al añadir producto a pedido remoto:', error);
            throw error;
        }
    }

    /**
     * Registra los productos del carrito en el historial de compras del usuario.
     * Usado tras crear un pedido remoto para que "Solo articulos que he comprado" los incluya.
     * @param {number} carritoId - ID del carrito/pedido remoto
     * @returns {Promise<boolean>}
     */
    async registrarHistorialDesdeCarrito(carritoId) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }
            const { data, error } = await this.client.rpc('registrar_historial_desde_carrito', {
                p_carrito_id: carritoId
            });
            if (error) throw error;
            return data === true || (Array.isArray(data) && data[0] === true);
        } catch (error) {
            console.error('Error al registrar historial desde carrito:', error);
            return false;
        }
    }

    /**
     * Marca un pedido remoto como enviado (después de añadir todos los productos)
     * IMPORTANTE: Esto actualiza ambos estados según el estándar definido
     */
    async marcarPedidoRemotoComoEnviado(carritoId) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log(`⚡ Marcando pedido ${carritoId} como ENVIADO`);

            // A1/A4: pedido enviado al ERP -> estado enviado, estado_procesamiento procesando
            const { data, error } = await this.client
                .from('carritos_clientes')
                .update({
                    estado: 'enviado',
                    estado_procesamiento: 'procesando'
                })
                .eq('id', carritoId)
                .eq('tipo_pedido', 'remoto')
                .select();

            if (error) throw error;

            console.log(`✅ Pedido ${carritoId} marcado como ENVIADO`);
            return true;

        } catch (error) {
            console.error('Error al marcar pedido como enviado:', error);
            throw error;
        }
    }

    /**
     * Actualiza el estado de procesamiento de un pedido remoto (error_erp o pendiente_erp).
     * @param {number} carritoId - ID del carrito
     * @param {string} estadoProcesamiento - 'error_erp' | 'pendiente_erp'
     */
    async updateCarritoEstadoProcesamiento(carritoId, estadoProcesamiento) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }
            // A2: error_erp -> estado cancelado; A3: pendiente_erp -> estado enviado
            const { error } = await this.client
                .from('carritos_clientes')
                .update({
                    estado_procesamiento: estadoProcesamiento,
                    estado: estadoProcesamiento === 'error_erp' ? 'cancelado' : 'enviado'
                })
                .eq('id', carritoId)
                .eq('tipo_pedido', 'remoto');
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error al actualizar estado procesamiento:', error);
            throw error;
        }
    }

    /**
     * Obtiene solo el estado_procesamiento de un carrito (consulta ligera).
     * Usado para evitar duplicar envios al ERP: solo enviar si es 'pendiente_erp'.
     * @param {string|number} carritoId - ID del carrito
     * @returns {Promise<string|null>} estado_procesamiento o null si error/no existe
     */
    async getCarritoEstadoProcesamiento(carritoId) {
        try {
            if (!this.client) return null;
            const { data, error } = await this.client
                .from('carritos_clientes')
                .select('estado_procesamiento')
                .eq('id', carritoId)
                .maybeSingle();
            if (error) return null;
            return (data && data.estado_procesamiento) ? data.estado_procesamiento : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Obtiene los pedidos remotos del usuario
     */
    async getUserRemoteOrders(usuarioId) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('🔍 Consultando pedidos para usuario_id:', usuarioId);

            // Obtener TODOS los pedidos del usuario (remotos y presenciales)
            // Filtrar por estado_procesamiento (más confiable que estado)
            const { data: pedidos, error } = await this.client
                .from('carritos_clientes')
                .select('*')
                .eq('usuario_id', usuarioId)
                .in('estado_procesamiento', ['procesando', 'completado', 'pendiente_erp'])
                .order('fecha_creacion', { ascending: false })
                .limit(50); // Limitar a los últimos 50 pedidos

            if (error) {
                console.error('❌ Error al obtener pedidos:', error);
                throw error;
            }

            console.log('✅ Pedidos obtenidos:', pedidos?.length || 0);
            if (pedidos && pedidos.length > 0) {
                console.log('📦 Tipos de pedidos:', pedidos.map(p => `${p.codigo_qr}: ${p.tipo_pedido} (${p.estado_procesamiento})`));
            }

            return pedidos || [];

        } catch (error) {
            console.error('❌ Error al obtener pedidos del usuario:', error);
            throw error;
        }
    }

    /**
     * Obtiene los productos de un pedido específico
     */
    async getOrderProducts(carritoId) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { data: productos, error } = await this.client
                .from('productos_carrito')
                .select('*')
                .eq('carrito_id', carritoId)
                .order('id', { ascending: true });

            if (error) {
                console.error('Error al obtener productos del pedido:', error);
                throw error;
            }

            return productos || [];

        } catch (error) {
            console.error('Error al obtener productos:', error);
            throw error;
        }
    }

    /**
     * Obtiene las ofertas disponibles para un producto según el grupo de cliente
     * Usa cache local primero para mejor rendimiento
     * @param {string} codigoArticulo - Código del artículo
     * @param {number} grupoCliente - Grupo de ofertas del cliente (usuarios.grupo_cliente; null = invitado, no ve ofertas)
     * @param {boolean} useCache - Si usar cache local (default: true)
     * @returns {Promise<Array>} - Lista de ofertas disponibles
     */
    async getOfertasProducto(codigoArticulo, grupoCliente = null, useCache = true) {
        try {
            // Si no hay grupo_cliente, el usuario es invitado y NO ve ofertas
            if (!grupoCliente) {
                console.log('Usuario invitado - no se buscan ofertas');
                return [];
            }

            // Intentar obtener desde cache primero
            let cacheMiss = false;
            if (useCache && window.cartManager && window.cartManager.db) {
                console.log('Buscando ofertas de ' + codigoArticulo + ' en cache (grupo: ' + grupoCliente + ')...');
                const ofertasCache = await window.cartManager.getOfertasProductoFromCache(codigoArticulo, grupoCliente);
                if (ofertasCache && ofertasCache.length > 0) {
                    console.log(`✅ ${ofertasCache.length} ofertas encontradas en cache para ${codigoArticulo}`);
                    return ofertasCache;
                } else {
                    cacheMiss = true;
                }
            }

            if (useCache && cacheMiss) {
                if (!this.shouldFallbackToSupabaseOnOfertasCacheMiss()) {
                    console.log(`Sin oferta en cache para ${codigoArticulo}; cache vigente, se evita consulta remota`);
                    return [];
                }
                console.log(`No se encontraron ofertas en cache para ${codigoArticulo}; consultando Supabase por estado de sync/cache`);
            }

            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            // Buscar ofertas que contengan este producto (precio = precio neto de oferta si existe)
            let query = this.client
                .from('ofertas_productos')
                .select(`
                    numero_oferta,
                    precio,
                    descuento_oferta,
                    unidades_minimas,
                    unidades_multiplo,
                    ofertas!inner(
                        numero_oferta,
                        tipo_oferta,
                        tipo_oferta_nombre,
                        titulo_descripcion,
                        descripcion_detallada,
                        activa
                    )
                `)
                .eq('codigo_articulo', codigoArticulo.toUpperCase())
                .eq('ofertas.activa', true);

            const { data: ofertasProducto, error } = await query;

            if (error) {
                console.error('Error al obtener ofertas del producto:', error);
                throw error;
            }

            if (!ofertasProducto || ofertasProducto.length === 0) {
                return [];
            }

            // Si hay grupo de cliente, filtrar por grupos
            if (grupoCliente !== null && grupoCliente !== undefined) {
                console.log('Filtrando ofertas para grupo: ' + grupoCliente);

                // Obtener ofertas asignadas a grupos del cliente
                const { data: ofertasGrupos, error: errorGrupos } = await this.client
                    .from('ofertas_grupos_asignaciones')
                    .select('numero_oferta, codigo_grupo, ofertas_grupos!inner(codigo_grupo)')
                    .eq('ofertas_grupos.codigo_grupo', grupoCliente.toString());

                if (!errorGrupos && ofertasGrupos && ofertasGrupos.length > 0) {
                    // Filtrar ofertas: solo las que están asignadas al grupo del cliente
                    const numerosOfertasGrupo = new Set(ofertasGrupos.map(og => og.numero_oferta));
                    const ofertasFiltradas = ofertasProducto.filter(op => numerosOfertasGrupo.has(op.numero_oferta));
                    console.log(ofertasFiltradas.length + ' ofertas visibles para el grupo ' + grupoCliente);
                    return ofertasFiltradas.map(op => ({
                        numero_oferta: op.numero_oferta,
                        precio: op.precio,
                        descuento_oferta: op.descuento_oferta,
                        unidades_minimas: op.unidades_minimas,
                        unidades_multiplo: op.unidades_multiplo,
                        tipo_oferta: op.ofertas.tipo_oferta,
                        tipo_oferta_nombre: op.ofertas.tipo_oferta_nombre,
                        titulo_descripcion: op.ofertas.titulo_descripcion,
                        descripcion_detallada: op.ofertas.descripcion_detallada
                    }));
                } else {
                    // Si el cliente tiene grupo pero no hay ofertas asignadas, no mostrar ninguna
                    console.log('Grupo ' + grupoCliente + ' no tiene ofertas asignadas');
                    return [];
                }
            }

            // Si no hay grupo de cliente (INVITADO), NO mostrar ofertas
            console.log('Usuario invitado - no se muestran ofertas');
            return [];

            /* CÓDIGO COMENTADO - Ya no devolvemos ofertas a invitados
            return ofertasProducto.map(op => ({
                numero_oferta: op.numero_oferta,
                descuento_oferta: op.descuento_oferta,
                unidades_minimas: op.unidades_minimas,
                unidades_multiplo: op.unidades_multiplo,
                tipo_oferta: op.ofertas.tipo_oferta,
                tipo_oferta_nombre: op.ofertas.tipo_oferta_nombre,
                titulo_descripcion: op.ofertas.titulo_descripcion,
                descripcion_detallada: op.ofertas.descripcion_detallada
            }));
            */

        } catch (error) {
            console.error('Error al obtener ofertas del producto:', error);
            return [];
        }
    }

    /**
     * Obtiene los intervalos escalonados de una oferta tipo INTERVALO
     * Usa cache local primero para mejor rendimiento
     * @param {string} numeroOferta - Número de la oferta
     * @param {boolean} useCache - Si usar cache local (default: true)
     * @returns {Promise<Array>} - Lista de intervalos ordenados
     */
    async getIntervalosOferta(numeroOferta, useCache = true) {
        try {
            // Intentar obtener desde cache primero
            if (useCache && window.cartManager) {
                const intervalosCache = await window.cartManager.getIntervalosOfertaFromCache(numeroOferta);
                if (intervalosCache && intervalosCache.length > 0) {
                    return intervalosCache;
                }
            }

            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { data: intervalos, error } = await this.client
                .from('ofertas_intervalos')
                .select('*')
                .eq('numero_oferta', numeroOferta)
                .order('desde_unidades', { ascending: true });

            if (error) {
                console.error('Error al obtener intervalos de oferta:', error);
                return [];
            }

            return intervalos || [];

        } catch (error) {
            console.error('Error al obtener intervalos:', error);
            return [];
        }
    }

    /**
     * Obtiene el tamaño del lote de una oferta tipo LOTE
     * Usa cache local primero para mejor rendimiento
     * @param {string} numeroOferta - Número de la oferta
     * @param {boolean} useCache - Si usar cache local (default: true)
     * @returns {Promise<number|null>} - Tamaño del lote o null si no está definido
     */
    async getLoteOferta(numeroOferta, useCache = true) {
        try {
            // Intentar obtener desde cache primero
            if (useCache && window.cartManager) {
                const loteCache = await window.cartManager.getLoteOfertaFromCache(numeroOferta);
                if (loteCache !== null) {
                    return loteCache;
                }
            }

            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const { data: detalles, error } = await this.client
                .from('ofertas_detalles')
                .select('valor')
                .eq('numero_oferta', numeroOferta)
                .eq('campo', 'unidades_lote')
                .single();

            if (error || !detalles) {
                return null;
            }

            return parseInt(detalles.valor) || null;

        } catch (error) {
            console.error('Error al obtener lote de oferta:', error);
            return null;
        }
    }

    /**
     * Descarga todas las ofertas y datos relacionados desde Supabase
     * y los guarda en cache local
     * Usa paginación para evitar el límite de 1000 registros por consulta
     */
    async downloadOfertas(onProgress = null) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            const ofertas = await this._downloadWithPagination('ofertas', onProgress, { activa: true });
            const ofertasProductos = await this._downloadWithPagination('ofertas_productos', onProgress);
            const ofertasIntervalos = await this._downloadWithPagination('ofertas_intervalos', onProgress);
            const ofertasDetalles = await this._downloadWithPagination('ofertas_detalles', onProgress);
            const ofertasGruposAsignaciones = await this._downloadWithPagination('ofertas_grupos_asignaciones', onProgress);

            if (window.cartManager) {
                await window.cartManager.saveOfertasToCache(ofertas || []);
                await window.cartManager.saveOfertasProductosToCache(ofertasProductos || []);
                await window.cartManager.saveOfertasIntervalosToCache(ofertasIntervalos || []);
                await window.cartManager.saveOfertasDetallesToCache(ofertasDetalles || []);
                await window.cartManager.saveOfertasGruposToCache(ofertasGruposAsignaciones || []);
            }

            this.markOfertasCacheComplete(localStorage.getItem('version_hash_local'));

            return {
                ofertas: ofertas || [],
                ofertasProductos: ofertasProductos || [],
                ofertasIntervalos: ofertasIntervalos || [],
                ofertasDetalles: ofertasDetalles || [],
                ofertasGruposAsignaciones: ofertasGruposAsignaciones || []
            };

        } catch (error) {
            console.error('Error al descargar ofertas:', error);
            throw error;
        }
    }

    // --- Conjuntos WC (Panel de Control, solo administrador) ---

    async getWcConjuntos() {
        try {
            if (!this.client) return [];
            const { data, error } = await this.client
                .from('wc_conjuntos')
                .select('*')
                .order('orden', { ascending: true })
                .order('nombre', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error('Error getWcConjuntos:', e);
            return [];
        }
    }

    async createWcConjunto(payload) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { data, error } = await this.client
                .from('wc_conjuntos')
                .insert([{
                    nombre: payload.nombre || '',
                    codigo: payload.codigo || null,
                    descripcion: payload.descripcion || null,
                    orden: payload.orden != null ? payload.orden : 0,
                    activo: payload.activo !== false,
                    tipo_instalacion: payload.tipo_instalacion || null,
                    adosado_pared: payload.adosado_pared === true
                }])
                .select()
                .single();
            if (error) throw error;
            return data;
        } catch (e) {
            console.error('Error createWcConjunto:', e);
            throw e;
        }
    }

    async updateWcConjunto(id, payload) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const body = {};
            if (payload.nombre !== undefined) body.nombre = payload.nombre;
            if (payload.codigo !== undefined) body.codigo = payload.codigo;
            if (payload.descripcion !== undefined) body.descripcion = payload.descripcion;
            if (payload.orden !== undefined) body.orden = payload.orden;
            if (payload.activo !== undefined) body.activo = payload.activo;
            if (payload.tipo_instalacion !== undefined) body.tipo_instalacion = payload.tipo_instalacion || null;
            if (payload.adosado_pared !== undefined) body.adosado_pared = payload.adosado_pared === true;
            body.updated_at = new Date().toISOString();
            const { data, error } = await this.client
                .from('wc_conjuntos')
                .update(body)
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            return data;
        } catch (e) {
            console.error('Error updateWcConjunto:', e);
            throw e;
        }
    }

    async deleteWcConjunto(id) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { error } = await this.client.from('wc_conjuntos').delete().eq('id', id);
            if (error) throw error;
        } catch (e) {
            console.error('Error deleteWcConjunto:', e);
            throw e;
        }
    }

    async getWcConjuntoTazas(conjuntoId) {
        try {
            if (!this.client) return [];
            const { data, error } = await this.client
                .from('wc_conjunto_tazas')
                .select('*')
                .eq('conjunto_id', conjuntoId)
                .order('orden', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error('Error getWcConjuntoTazas:', e);
            return [];
        }
    }

    async getWcConjuntoTanques(conjuntoId) {
        try {
            if (!this.client) return [];
            const { data, error } = await this.client
                .from('wc_conjunto_tanques')
                .select('*')
                .eq('conjunto_id', conjuntoId)
                .order('orden', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error('Error getWcConjuntoTanques:', e);
            return [];
        }
    }

    async getWcConjuntoAsientos(conjuntoId) {
        try {
            if (!this.client) return [];
            const { data, error } = await this.client
                .from('wc_conjunto_asientos')
                .select('*')
                .eq('conjunto_id', conjuntoId)
                .order('orden', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error('Error getWcConjuntoAsientos:', e);
            return [];
        }
    }

    /**
     * Devuelve los conjuntos WC (activos) en los que participa un producto dado por su codigo.
     * Un producto puede ser taza, tanque o asiento en varios conjuntos.
     * @param {string} productoCodigo - codigo del producto (productos.codigo)
     * @returns {Promise<Array<{id: string, nombre: string, codigo?: string, ...}>>}
     */
    async getWcConjuntosByProductoCodigo(productoCodigo) {
        try {
            if (!this.client || !productoCodigo) return [];
            const codigo = String(productoCodigo).trim();
            const [tazas, tanques, asientos] = await Promise.all([
                this.client.from('wc_conjunto_tazas').select('conjunto_id').eq('producto_codigo', codigo),
                this.client.from('wc_conjunto_tanques').select('conjunto_id').eq('producto_codigo', codigo),
                this.client.from('wc_conjunto_asientos').select('conjunto_id').eq('producto_codigo', codigo)
            ]);
            const ids = new Set();
            (tazas.data || []).forEach(r => { if (r && r.conjunto_id) ids.add(r.conjunto_id); });
            (tanques.data || []).forEach(r => { if (r && r.conjunto_id) ids.add(r.conjunto_id); });
            (asientos.data || []).forEach(r => { if (r && r.conjunto_id) ids.add(r.conjunto_id); });
            if (ids.size === 0) return [];
            const { data, error } = await this.client
                .from('wc_conjuntos')
                .select('*')
                .in('id', Array.from(ids))
                .eq('activo', true)
                .order('orden', { ascending: true })
                .order('nombre', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error('Error getWcConjuntosByProductoCodigo:', e);
            return [];
        }
    }

    async addWcConjuntoTaza(conjuntoId, productoCodigo, orden) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { error } = await this.client.from('wc_conjunto_tazas').insert([{
                conjunto_id: conjuntoId,
                producto_codigo: String(productoCodigo).trim(),
                orden: orden != null ? orden : 0
            }]);
            if (error) throw error;
        } catch (e) {
            console.error('Error addWcConjuntoTaza:', e);
            throw e;
        }
    }

    async addWcConjuntoTanque(conjuntoId, productoCodigo, orden) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { error } = await this.client.from('wc_conjunto_tanques').insert([{
                conjunto_id: conjuntoId,
                producto_codigo: String(productoCodigo).trim(),
                orden: orden != null ? orden : 0
            }]);
            if (error) throw error;
        } catch (e) {
            console.error('Error addWcConjuntoTanque:', e);
            throw e;
        }
    }

    async addWcConjuntoAsiento(conjuntoId, productoCodigo, orden) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { error } = await this.client.from('wc_conjunto_asientos').insert([{
                conjunto_id: conjuntoId,
                producto_codigo: String(productoCodigo).trim(),
                orden: orden != null ? orden : 0
            }]);
            if (error) throw error;
        } catch (e) {
            console.error('Error addWcConjuntoAsiento:', e);
            throw e;
        }
    }

    async removeWcConjuntoTaza(id) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { error } = await this.client.from('wc_conjunto_tazas').delete().eq('id', id);
            if (error) throw error;
        } catch (e) {
            console.error('Error removeWcConjuntoTaza:', e);
            throw e;
        }
    }

    async removeWcConjuntoTanque(id) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { error } = await this.client.from('wc_conjunto_tanques').delete().eq('id', id);
            if (error) throw error;
        } catch (e) {
            console.error('Error removeWcConjuntoTanque:', e);
            throw e;
        }
    }

    async removeWcConjuntoAsiento(id) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { error } = await this.client.from('wc_conjunto_asientos').delete().eq('id', id);
            if (error) throw error;
        } catch (e) {
            console.error('Error removeWcConjuntoAsiento:', e);
            throw e;
        }
    }

    // --- Recambios de productos (Panel de Control, solo administrador) ---

    /**
     * Recambios (hijos) de un producto dado por codigo. "Este producto tiene estos recambios."
     * @param {string} productoPadreCodigo - codigo del producto padre
     * @returns {Promise<Array<{id: string, producto_padre_codigo: string, producto_recambio_codigo: string}>>}
     */
    async getRecambiosDeProducto(productoPadreCodigo) {
        try {
            if (!this.client || !productoPadreCodigo) return [];
            const codigo = String(productoPadreCodigo).trim();
            const { data, error } = await this.client
                .from('producto_recambios')
                .select('*')
                .eq('producto_padre_codigo', codigo);
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error('Error getRecambiosDeProducto:', e);
            return [];
        }
    }

    /**
     * Productos (padres) para los que un producto es recambio. "Este recambio sirve para estos productos."
     * @param {string} productoRecambioCodigo - codigo del producto recambio
     * @returns {Promise<Array<{id: string, producto_padre_codigo: string, producto_recambio_codigo: string}>>}
     */
    async getPadresDeRecambio(productoRecambioCodigo) {
        try {
            if (!this.client || !productoRecambioCodigo) return [];
            const codigo = String(productoRecambioCodigo).trim();
            const { data, error } = await this.client
                .from('producto_recambios')
                .select('*')
                .eq('producto_recambio_codigo', codigo);
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error('Error getPadresDeRecambio:', e);
            return [];
        }
    }

    /**
     * Anade una relacion recambio: producto_padre_codigo -> producto_recambio_codigo
     */
    async addRecambio(productoPadreCodigo, productoRecambioCodigo) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const padre = String(productoPadreCodigo).trim();
            const recambio = String(productoRecambioCodigo).trim();
            if (!padre || !recambio) throw new Error('Codigos obligatorios');

            const { ok } = await this.ensureAuthSessionForWrite();
            if (!ok) {
                const err = new Error('SESSION_EXPIRED');
                err.code = 'SESSION_EXPIRED';
                throw err;
            }

            let result = await this.client.from('producto_recambios').insert([{
                producto_padre_codigo: padre,
                producto_recambio_codigo: recambio
            }]);
            if (result.error && result.error.code === '42501') {
                const refresh = await this.client.auth.refreshSession();
                if (!refresh.error && refresh.data?.session) {
                    result = await this.client.from('producto_recambios').insert([{
                        producto_padre_codigo: padre,
                        producto_recambio_codigo: recambio
                    }]);
                }
                if (result.error && result.error.code === '42501') {
                    const err = new Error('SESSION_EXPIRED');
                    err.code = 'SESSION_EXPIRED';
                    throw err;
                }
            }
            if (result.error) throw result.error;
        } catch (e) {
            if (e && (e.code === 'SESSION_EXPIRED' || e.message === 'SESSION_EXPIRED')) throw e;
            console.error('Error addRecambio:', e);
            throw e;
        }
    }

    /**
     * Elimina una relacion recambio por id
     */
    async removeRecambio(id) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');

            const { ok } = await this.ensureAuthSessionForWrite();
            if (!ok) {
                const err = new Error('SESSION_EXPIRED');
                err.code = 'SESSION_EXPIRED';
                throw err;
            }

            let result = await this.client.from('producto_recambios').delete().eq('id', id);
            if (result.error && result.error.code === '42501') {
                const refresh = await this.client.auth.refreshSession();
                if (!refresh.error && refresh.data?.session) {
                    result = await this.client.from('producto_recambios').delete().eq('id', id);
                }
                if (result.error && result.error.code === '42501') {
                    const err = new Error('SESSION_EXPIRED');
                    err.code = 'SESSION_EXPIRED';
                    throw err;
                }
            }
            if (result.error) throw result.error;
        } catch (e) {
            if (e && (e.code === 'SESSION_EXPIRED' || e.message === 'SESSION_EXPIRED')) throw e;
            console.error('Error removeRecambio:', e);
            throw e;
        }
    }

    /**
     * Actualiza el alias de un cliente desde la vista del comercial.
     * @param {number} clienteId - ID del cliente (usuarios.id)
     * @param {string|null} nuevoAlias - Nuevo alias, o null/vacio para borrarlo
     * @returns {Promise<{success: boolean, message?: string}>}
     */
    async actualizarAliasCliente(clienteId, nuevoAlias) {
        try {
            if (!this.client || !clienteId) throw new Error('Datos incompletos');
            const valor = nuevoAlias && String(nuevoAlias).trim() ? String(nuevoAlias).trim() : null;
            const { error } = await this.client
                .from('usuarios')
                .update({ alias: valor, fecha_actualizacion: new Date().toISOString() })
                .eq('id', clienteId);
            if (error) throw error;
            return { success: true };
        } catch (err) {
            console.error('actualizarAliasCliente:', err);
            return { success: false, message: (err && err.message) || 'Error al actualizar alias' };
        }
    }

    /**
     * Lista proveedores para el desplegable de Solicitar articulo nuevo.
     * @returns {Promise<Array<{codigo_proveedor: string, nombre_proveedor: string}>>}
     */
    async getProveedores() {
        try {
            if (!this.client) return [];
            const { data, error } = await this.client
                .from('proveedores')
                .select('codigo_proveedor, nombre_proveedor')
                .order('nombre_proveedor', { ascending: true });
            if (error) {
                console.error('Error getProveedores:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getProveedores:', err);
            return [];
        }
    }

    async getEmpresasPorAlmacen() {
        try {
            if (!this.client) return [];
            const { data, error } = await this.client
                .from('empresas_por_almacen')
                .select('almacen, razon_social, cif, direccion, cp, poblacion, provincia, telefono, email, web, logo_url, logo_pdf_ancho_pt, logo_pdf_alto_pt, logo_pdf_offset_x_pt, logo_pdf_offset_y_pt, condiciones_comerciales, texto_cabecera, updated_at')
                .order('almacen', { ascending: true });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error('getEmpresasPorAlmacen:', error);
            return [];
        }
    }

    async upsertEmpresaPorAlmacen(payload) {
        try {
            if (!this.client || !payload || !payload.almacen) return { success: false, message: 'Datos incompletos' };
            const logoPdfPt = function (v) {
                if (v == null || String(v).trim() === '') return null;
                const n = parseInt(String(v).trim(), 10);
                if (!Number.isFinite(n) || n <= 0) return null;
                return Math.min(200, Math.max(20, n));
            };
            const logoPdfOffsetX = function (v) {
                if (v == null || String(v).trim() === '') return null;
                const n = parseInt(String(v).trim(), 10);
                if (!Number.isFinite(n)) return null;
                return Math.min(160, Math.max(-80, n));
            };
            const logoPdfOffsetY = function (v) {
                if (v == null || String(v).trim() === '') return null;
                const n = parseInt(String(v).trim(), 10);
                if (!Number.isFinite(n)) return null;
                return Math.min(100, Math.max(-40, n));
            };
            const row = {
                almacen: String(payload.almacen).trim(),
                razon_social: payload.razon_social ? String(payload.razon_social).trim() : '',
                cif: payload.cif ? String(payload.cif).trim() : '',
                direccion: payload.direccion ? String(payload.direccion).trim() : '',
                cp: payload.cp ? String(payload.cp).trim() : '',
                poblacion: payload.poblacion ? String(payload.poblacion).trim() : '',
                provincia: payload.provincia ? String(payload.provincia).trim() : '',
                telefono: payload.telefono ? String(payload.telefono).trim() : null,
                email: payload.email ? String(payload.email).trim() : null,
                web: payload.web ? String(payload.web).trim() : null,
                logo_url: payload.logo_url ? String(payload.logo_url).trim() : null,
                logo_pdf_ancho_pt: logoPdfPt(payload.logo_pdf_ancho_pt),
                logo_pdf_alto_pt: logoPdfPt(payload.logo_pdf_alto_pt),
                logo_pdf_offset_x_pt: logoPdfOffsetX(payload.logo_pdf_offset_x_pt),
                logo_pdf_offset_y_pt: logoPdfOffsetY(payload.logo_pdf_offset_y_pt),
                condiciones_comerciales: payload.condiciones_comerciales ? String(payload.condiciones_comerciales).trim() : null,
                texto_cabecera:
                    payload.texto_cabecera != null && String(payload.texto_cabecera).trim() !== ''
                        ? String(payload.texto_cabecera).trim()
                        : null
            };
            const { error } = await this.client.from('empresas_por_almacen').upsert([row], { onConflict: 'almacen' });
            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error('upsertEmpresaPorAlmacen:', error);
            return { success: false, message: 'No se pudo guardar la empresa por almacen' };
        }
    }

    /**
     * Una fila de empresas_por_almacen por codigo de almacen (exacto).
     * @param {string} almacen
     * @returns {Promise<object|null>}
     */
    async getEmpresaPorAlmacen(almacen) {
        try {
            if (!this.client || almacen == null || String(almacen).trim() === '') return null;
            const a = String(almacen).trim();
            const { data, error } = await this.client
                .from('empresas_por_almacen')
                .select('almacen, razon_social, cif, direccion, cp, poblacion, provincia, telefono, email, web, logo_url, logo_pdf_ancho_pt, logo_pdf_alto_pt, logo_pdf_offset_x_pt, logo_pdf_offset_y_pt, condiciones_comerciales, texto_cabecera, updated_at')
                .eq('almacen', a)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        } catch (error) {
            console.error('getEmpresaPorAlmacen:', error);
            return null;
        }
    }

    async getAppConfigGlobal() {
        try {
            if (!this.client) return null;
            const { data, error } = await this.client
                .from('app_config_global')
                .select('id, whatsapp_soporte_errores, updated_at')
                .eq('id', 1)
                .maybeSingle();
            if (error) throw error;
            return data || { id: 1, whatsapp_soporte_errores: null };
        } catch (error) {
            console.error('getAppConfigGlobal:', error);
            return null;
        }
    }

    async upsertAppConfigGlobal(payload) {
        try {
            if (!this.client) return { success: false, message: 'Cliente no inicializado' };
            const row = {
                id: 1,
                whatsapp_soporte_errores:
                    payload && payload.whatsapp_soporte_errores
                        ? String(payload.whatsapp_soporte_errores).trim()
                        : null,
                updated_at: new Date().toISOString()
            };
            const { error } = await this.client.from('app_config_global').upsert([row], { onConflict: 'id' });
            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error('upsertAppConfigGlobal:', error);
            return { success: false, message: 'No se pudo guardar la configuracion global' };
        }
    }

    /**
     * Sube logo de empresa al bucket logos_empresa; primera carpeta = almacen (RLS).
     * @param {string} almacen
     * @param {File|Blob} file
     * @returns {Promise<{ success: boolean, message?: string, publicUrl?: string|null }>}
     */
    async uploadLogoEmpresa(almacen, file) {
        try {
            if (!this.client || !file || almacen == null || String(almacen).trim() === '') {
                return { success: false, message: 'Datos incompletos', publicUrl: null };
            }
            const { ok } = await this.ensureAuthSessionForWrite();
            if (!ok) {
                return { success: false, message: 'Sesion expirada o no autenticado', publicUrl: null };
            }
            const folder = String(almacen).trim().replace(/\//g, '_');
            const mime = (file.type && String(file.type).trim()) || 'application/octet-stream';
            const extMap = {
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/png': 'png',
                'image/webp': 'webp',
                'image/gif': 'gif'
            };
            const ext = extMap[mime.toLowerCase()] || 'png';
            const path = folder + '/logo_' + Date.now() + '.' + ext;
            let up = await this.client.storage.from('logos_empresa').upload(path, file, {
                upsert: true,
                contentType: mime.indexOf('image/') === 0 ? mime : 'image/png',
                cacheControl: '3600'
            });
            if (up.error) {
                const refresh = await this.client.auth.refreshSession();
                if (!refresh.error && refresh.data && refresh.data.session) {
                    up = await this.client.storage.from('logos_empresa').upload(path, file, {
                        upsert: true,
                        contentType: mime.indexOf('image/') === 0 ? mime : 'image/png',
                        cacheControl: '3600'
                    });
                }
            }
            if (up.error) {
                console.error('uploadLogoEmpresa:', up.error);
                return { success: false, message: up.error.message || 'Error al subir el logo', publicUrl: null };
            }
            const { data: urlData } = this.client.storage.from('logos_empresa').getPublicUrl(path);
            const publicUrl = urlData && urlData.publicUrl ? urlData.publicUrl : null;
            return { success: true, publicUrl: publicUrl };
        } catch (err) {
            console.error('uploadLogoEmpresa:', err);
            return { success: false, message: 'Error al subir el logo', publicUrl: null };
        }
    }

    /**
     * Lista todos los alias de proveedores (para combobox de busqueda).
     * @returns {Promise<Array<{codigo_proveedor: string, alias: string}>>}
     */
    async getProveedoresAlias() {
        try {
            if (!this.client) return [];
            const { data, error } = await this.client
                .from('proveedores_alias')
                .select('codigo_proveedor, alias');
            if (error) {
                console.error('Error getProveedoresAlias:', error);
                return [];
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('getProveedoresAlias:', err);
            return [];
        }
    }

    /**
     * Anade un alias a un proveedor (solo ADMINISTRACION por RLS).
     * @param {string} codigoProveedor
     * @param {string} alias - texto del alias (se guarda tal cual; la busqueda es case-insensitive)
     * @returns {Promise<boolean>}
     */
    async addProveedorAlias(codigoProveedor, alias) {
        try {
            if (!this.client || !codigoProveedor || !alias) return false;
            const a = String(alias).trim();
            if (!a) return false;
            const { error } = await this.client
                .from('proveedores_alias')
                .insert([{ codigo_proveedor: codigoProveedor, alias: a }]);
            if (error) {
                if (error.code === '23505') return true;
                throw error;
            }
            return true;
        } catch (err) {
            console.error('addProveedorAlias:', err);
            return false;
        }
    }

    /**
     * Elimina un alias de un proveedor (solo ADMINISTRACION por RLS).
     * @param {string} codigoProveedor
     * @param {string} alias - texto exacto del alias a borrar
     * @returns {Promise<boolean>}
     */
    async removeProveedorAlias(codigoProveedor, alias) {
        try {
            if (!this.client || !codigoProveedor || !alias) return false;
            const { error } = await this.client
                .from('proveedores_alias')
                .delete()
                .eq('codigo_proveedor', codigoProveedor)
                .eq('alias', String(alias).trim());
            if (error) throw error;
            return true;
        } catch (err) {
            console.error('removeProveedorAlias:', err);
            return false;
        }
    }

    /**
     * Crea una solicitud de articulo nuevo (solo Dependiente/Comercial; RLS aplica).
     * @param {Object} payload - { codigo_proveedor, descripcion, ref_proveedor?, tarifa?, pagina?, precio, observaciones?, auth_uid, user_id?, comercial_id? }
     * @returns {Promise<{id: string, ...}|null>} Fila insertada con id, o null si error
     */
    async crearSolicitudArticuloNuevo(payload) {
        try {
            if (!this.client) throw new Error('Cliente no inicializado');
            const { data, error } = await this.client
                .from('solicitudes_articulos_nuevos')
                .insert([{
                    codigo_proveedor: payload.codigo_proveedor,
                    descripcion: String(payload.descripcion || '').trim(),
                    ref_proveedor: payload.ref_proveedor ? String(payload.ref_proveedor).trim() : null,
                    tarifa: payload.tarifa ? String(payload.tarifa).trim() : null,
                    pagina: payload.pagina != null && payload.pagina !== '' ? parseInt(payload.pagina, 10) : null,
                    precio: parseFloat(payload.precio),
                    observaciones: payload.observaciones ? String(payload.observaciones).trim() : null,
                    auth_uid: payload.auth_uid,
                    user_id: payload.user_id != null ? payload.user_id : null,
                    comercial_id: payload.comercial_id != null ? payload.comercial_id : null
                }])
                .select()
                .single();
            if (error) throw error;
            return data;
        } catch (err) {
            console.error('crearSolicitudArticuloNuevo:', err);
            throw err;
        }
    }

    /**
     * Sube una foto para una solicitud de articulo nuevo al bucket de Supabase Storage
     * "solicitudes-articulos-fotos". Ruta en el bucket: {solicitudId}/{nombre_archivo}.
     * Devuelve la URL publica para guardar en foto_url de la fila.
     * @param {string} solicitudId - UUID de la solicitud
     * @param {File} file - Archivo de imagen (image/*)
     * @returns {Promise<string|null>} URL publica o null si error
     */
    async subirFotoSolicitudArticulo(solicitudId, file) {
        try {
            if (!this.client || !solicitudId || !file) return null;
            const bucket = 'solicitudes-articulos-fotos';
            const ext = (file.name && file.name.split('.').pop()) ? file.name.split('.').pop().toLowerCase() : 'jpg';
            const safeName = file.name && file.name.replace(/[^a-zA-Z0-9._-]/g, '_') ? file.name.replace(/[^a-zA-Z0-9._-]/g, '_') : 'foto.' + ext;
            const path = solicitudId + '/' + safeName;
            const uploadOptions = { upsert: true };
            if (file.type && file.type.startsWith('image/')) {
                uploadOptions.contentType = file.type;
            }
            const { data, error } = await this.client.storage
                .from(bucket)
                .upload(path, file, uploadOptions);
            if (error) {
                console.error('Error subirFotoSolicitudArticulo:', error);
                return null;
            }
            const { data: urlData } = this.client.storage.from(bucket).getPublicUrl(path);
            return urlData && urlData.publicUrl ? urlData.publicUrl : null;
        } catch (err) {
            console.error('subirFotoSolicitudArticulo:', err);
            return null;
        }
    }

    /**
     * Obtiene una URL firmada para mostrar la foto de una solicitud (bucket publico o privado).
     * Si el bucket es privado, getPublicUrl no funciona; esta funcion devuelve una URL valida por 1 hora.
     * Algunas versiones del API devuelven la URL base y el token por separado; se construye la URL completa.
     * @param {string} fotoUrl - URL publica almacenada (ej. .../object/public/solicitudes-articulos-fotos/UUID/nombre.jpg)
     * @returns {Promise<string|null>} URL firmada con token o null si error
     */
    async getSolicitudFotoSignedUrl(fotoUrl) {
        try {
            if (!this.client || !fotoUrl || typeof fotoUrl !== 'string') return null;
            const bucket = 'solicitudes-articulos-fotos';
            const idx = fotoUrl.indexOf('solicitudes-articulos-fotos/');
            if (idx === -1) return null;
            const path = fotoUrl.substring(idx + bucket.length + 1).split('?')[0];
            if (!path) return null;
            const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, 3600);
            if (error || !data) return null;
            let url = data.signedUrl || data.signedURL;
            if (!url) return null;
            if (url.indexOf('token=') === -1 && (data.token || data.signedUrlToken)) {
                const token = data.token || data.signedUrlToken;
                url = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(token);
            }
            if (url.indexOf('token=') === -1) return null;
            return url;
        } catch (err) {
            console.error('getSolicitudFotoSignedUrl:', err);
            return null;
        }
    }

    /**
     * Actualiza la URL de la foto en una solicitud de articulo nuevo (solo el creador por RLS).
     * @param {string} solicitudId - UUID de la solicitud
     * @param {string} fotoUrl - URL publica de la imagen
     * @returns {Promise<boolean>}
     */
    async updateSolicitudArticuloFotoUrl(solicitudId, fotoUrl) {
        try {
            if (!this.client || !solicitudId) return false;
            const { error } = await this.client
                .from('solicitudes_articulos_nuevos')
                .update({ foto_url: fotoUrl })
                .eq('id', solicitudId);
            if (error) throw error;
            return true;
        } catch (err) {
            console.error('updateSolicitudArticuloFotoUrl:', err);
            return false;
        }
    }

    /**
     * Conteo de solicitudes de articulos nuevos con estado pendiente (para panel ADMINISTRACION).
     * Requiere JWT con app_metadata.es_administracion = true.
     * @returns {Promise<number>}
     */
    async getSolicitudesPendientesCount() {
        try {
            if (!this.client) return 0;
            const { count, error } = await this.client
                .from('solicitudes_articulos_nuevos')
                .select('id', { count: 'exact', head: true })
                .eq('estado', 'pendiente');
            if (error) {
                console.error('getSolicitudesPendientesCount:', error);
                return 0;
            }
            return count != null ? count : 0;
        } catch (err) {
            console.error('getSolicitudesPendientesCount:', err);
            return 0;
        }
    }

    /**
     * Lista solicitudes de articulos nuevos (para panel ADMINISTRACION).
     * @param {string|null} filtroEstado - opcional: 'pendiente', 'aprobado', 'rechazado' o null para todas
     * @returns {Promise<Array>}
     */
    async getSolicitudesArticulosNuevos(filtroEstado = null) {
        try {
            if (!this.client) return [];
            let query = this.client
                .from('solicitudes_articulos_nuevos')
                .select('id, codigo_proveedor, descripcion, ref_proveedor, tarifa, pagina, precio, foto_url, created_at, estado')
                .order('created_at', { ascending: false });
            if (filtroEstado) {
                query = query.eq('estado', filtroEstado);
            }
            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('getSolicitudesArticulosNuevos:', err);
            return [];
        }
    }

    /**
     * Actualiza el estado de una solicitud de articulo nuevo (panel ADMINISTRACION).
     * @param {string} id - UUID de la solicitud
     * @param {string} estado - 'aprobado' o 'rechazado'
     * @returns {Promise<boolean>}
     */
    async updateSolicitudArticuloEstado(id, estado) {
        try {
            if (!this.client || !id || !estado) return false;
            const { error } = await this.client
                .from('solicitudes_articulos_nuevos')
                .update({ estado: estado })
                .eq('id', id);
            if (error) throw error;
            return true;
        } catch (err) {
            console.error('updateSolicitudArticuloEstado:', err);
            return false;
        }
    }

    /**
     * Actualiza el estado de una solicitud de articulo nuevo (panel ADMINISTRACION).
     * @param {string} id - UUID de la solicitud
     * @param {string} estado - 'aprobado' o 'rechazado'
     * @returns {Promise<boolean>}
     */
    async updateSolicitudArticuloEstado(id, estado) {
        try {
            if (!this.client || !id || !estado) return false;
            const { error } = await this.client
                .from('solicitudes_articulos_nuevos')
                .update({ estado: estado })
                .eq('id', id);
            if (error) throw error;
            return true;
        } catch (err) {
            console.error('updateSolicitudArticuloEstado:', err);
            return false;
        }
    }

    /**
     * Elimina la foto de una solicitud del bucket Supabase Storage (bucket solicitudes-articulos-fotos).
     * La ruta se extrae de la URL publica (todo lo que va despues de "solicitudes-articulos-fotos/").
     * @param {string} fotoUrl - URL publica de la imagen (ej. .../object/public/solicitudes-articulos-fotos/UUID/nombre.jpg)
     * @returns {Promise<boolean>}
     */
    async eliminarFotoSolicitudArticulo(fotoUrl) {
        try {
            if (!this.client || !fotoUrl || typeof fotoUrl !== 'string') return false;
            const bucket = 'solicitudes-articulos-fotos';
            const idx = fotoUrl.indexOf('solicitudes-articulos-fotos/');
            if (idx === -1) return false;
            const path = fotoUrl.substring(idx + bucket.length + 1);
            if (!path) return false;
            const { error } = await this.client.storage.from(bucket).remove([path]);
            if (error) {
                console.error('Error eliminarFotoSolicitudArticulo:', error);
                return false;
            }
            return true;
        } catch (err) {
            console.error('eliminarFotoSolicitudArticulo:', err);
            return false;
        }
    }

    /**
     * Crea el producto en el catalogo desde una solicitud completada (solo ADMINISTRACION; RPC).
     * @param {string} codigo - Codigo del producto (SKU)
     * @param {string} descripcion - Descripcion del producto
     * @param {number} pvp - PVP (IVA no incluido)
     * @param {string|null} codigoProveedor - Codigo del fabricante/proveedor (opcional)
     * @returns {Promise<{ success: boolean, message?: string }>}
     */
    async crearProductoDesdeSolicitud(codigo, descripcion, pvp, codigoProveedor) {
        try {
            if (!this.client || !codigo || descripcion == null) {
                return { success: false, message: 'Datos insuficientes' };
            }
            const { data, error } = await this.client.rpc('crear_producto_desde_solicitud', {
                p_codigo: String(codigo).trim(),
                p_descripcion: String(descripcion).trim(),
                p_pvp: Number(pvp),
                p_codigo_proveedor: codigoProveedor ? String(codigoProveedor).trim() : null
            });
            if (error) {
                const msg = (error.message || '').trim();
                return { success: false, message: msg || 'Error al crear el producto' };
            }
            return (data && data.success) ? { success: true } : { success: false, message: 'Error desconocido' };
        } catch (err) {
            console.error('crearProductoDesdeSolicitud:', err);
            return { success: false, message: (err && err.message) || 'Error al crear el producto' };
        }
    }

    /**
     * Actualiza la respuesta de Administracion: estado, codigo_producto, foto_url y opcionalmente los campos editables.
     * Usado al completar la solicitud o al guardar cambios de los datos confirmados por administracion.
     * @param {string} id - UUID de la solicitud
     * @param {Object} payload - { estado?, codigo_producto?, foto_url?, codigo_proveedor?, descripcion?, ref_proveedor?, tarifa?, pagina?, precio?, observaciones? }
     * @returns {Promise<boolean>}
     */
    async updateSolicitudArticuloRespuesta(id, payload) {
        try {
            if (!this.client || !id || !payload) return false;
            const update = {};
            if (payload.estado !== undefined) update.estado = payload.estado;
            if (payload.codigo_producto !== undefined) update.codigo_producto = payload.codigo_producto != null ? String(payload.codigo_producto).trim() : null;
            if (payload.hasOwnProperty('foto_url')) update.foto_url = payload.foto_url;
            if (payload.hasOwnProperty('codigo_proveedor')) update.codigo_proveedor = payload.codigo_proveedor != null ? String(payload.codigo_proveedor).trim() : null;
            if (payload.hasOwnProperty('descripcion')) update.descripcion = payload.descripcion != null ? String(payload.descripcion).trim() : '';
            if (payload.hasOwnProperty('ref_proveedor')) update.ref_proveedor = payload.ref_proveedor != null ? String(payload.ref_proveedor).trim() : null;
            if (payload.hasOwnProperty('tarifa')) update.tarifa = payload.tarifa != null ? String(payload.tarifa).trim() : null;
            if (payload.hasOwnProperty('pagina')) update.pagina = payload.pagina !== '' && payload.pagina != null ? (typeof payload.pagina === 'number' ? payload.pagina : parseInt(payload.pagina, 10)) : null;
            if (payload.hasOwnProperty('precio')) update.precio = payload.precio !== '' && payload.precio != null ? (typeof payload.precio === 'number' ? payload.precio : parseFloat(payload.precio)) : null;
            if (payload.hasOwnProperty('observaciones')) update.observaciones = payload.observaciones != null ? String(payload.observaciones).trim() : null;
            if (Object.keys(update).length === 0) return true;
            const { error } = await this.client
                .from('solicitudes_articulos_nuevos')
                .update(update)
                .eq('id', id);
            if (error) throw error;
            return true;
        } catch (err) {
            console.error('updateSolicitudArticuloRespuesta:', err);
            return false;
        }
    }

    /**
     * Obtiene una solicitud de articulo nuevo por id (panel ADMINISTRACION).
     * @param {string} id - UUID de la solicitud
     * @returns {Promise<object|null>}
     */
    async getSolicitudArticuloNuevoById(id) {
        try {
            if (!this.client || !id) return null;
            const { data, error } = await this.client
                .from('solicitudes_articulos_nuevos')
                .select('*')
                .eq('id', id)
                .single();
            if (error) return null;
            return data;
        } catch (err) {
            console.error('getSolicitudArticuloNuevoById:', err);
            return null;
        }
    }

    /**
     * Descarga la tabla stock_almacen_articulo completa y la agrupa por codigo_articulo.
     * Devuelve un array listo para guardar en IndexedDB con saveStockToStorage():
     *   [ { codigo_articulo, stock_global, por_almacen: { ALMX: N, ... } }, ... ]
     */
    /**
     * Devuelve el hash actual de stock desde stock_meta (fila id=1).
     * Retorna null si la tabla no existe o no hay datos.
     */
    async getStockHash() {
        try {
            if (!this.client) return null;
            const { data, error } = await this.client
                .from('stock_meta')
                .select('hash')
                .eq('id', 1)
                .maybeSingle();
            if (error) return null;
            return data?.hash || null;
        } catch (e) {
            return null;
        }
    }

    async downloadStock(onProgress = null) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('Descargando stock desde Supabase...');

            const rawRows = await this._downloadWithPagination('stock_almacen_articulo', onProgress);

            if (!rawRows || rawRows.length === 0) {
                console.log('No hay datos de stock en Supabase');
                return [];
            }

            // Agrupar por codigo_articulo
            const mapa = new Map();
            for (const row of rawRows) {
                const art = (row.codigo_articulo || '').toUpperCase().trim();
                const alm = (row.codigo_almacen  || '').toUpperCase().trim();
                const qty = parseInt(row.stock, 10) || 0;

                if (!art || !alm) continue;

                if (!mapa.has(art)) {
                    mapa.set(art, { codigo_articulo: art, stock_global: 0, por_almacen: {} });
                }
                const entry = mapa.get(art);
                entry.stock_global += qty;
                entry.por_almacen[alm] = (entry.por_almacen[alm] || 0) + qty;
            }

            const resultado = Array.from(mapa.values());
            console.log(
                `Stock descargado: ${rawRows.length} filas -> ${resultado.length} articulos con stock`
            );
            return resultado;

        } catch (error) {
            console.error('Error al descargar stock:', error);
            throw error;
        }
    }

    // --- Familias pantalla Inicio: bucket publico fotos_familias (admin) ---

    getPublicUrlFotosFamilias(storagePath) {
        const p = String(storagePath || '').trim().replace(/^\/+/, '');
        if (!p || !this.client) {
            return '';
        }
        const { data } = this.client.storage.from('fotos_familias').getPublicUrl(p);
        return data && data.publicUrl ? data.publicUrl : '';
    }

    async getAllFamiliasRows() {
        if (!this.client) {
            return [];
        }
        const pageSize = 1000;
        let from = 0;
        const all = [];
        while (true) {
            const { data, error } = await this.client
                .from('familias')
                .select('*')
                .order('CODIGO')
                .range(from, from + pageSize - 1);
            if (error) {
                throw error;
            }
            const chunk = data || [];
            all.push(...chunk);
            if (chunk.length < pageSize) {
                break;
            }
            from += pageSize;
        }
        return all;
    }

    async updateFamiliaInicioUi(codigoFamilia, fields) {
        if (!this.client) {
            throw new Error('Cliente no inicializado');
        }
        const { ok } = await this.ensureAuthSessionForWrite();
        if (!ok) {
            const err = new Error('SESSION_EXPIRED');
            err.code = 'SESSION_EXPIRED';
            throw err;
        }
        const cod = String(codigoFamilia || '').trim();
        if (!cod) {
            throw new Error('Codigo familia vacio');
        }
        const patch = {};
        if (fields.titulo_inicio !== undefined) {
            patch.titulo_inicio = String(fields.titulo_inicio).trim() || null;
        }
        if (fields.imagen_storage_path !== undefined) {
            patch.imagen_storage_path = String(fields.imagen_storage_path).trim() || null;
        }
        if (fields.activo_inicio !== undefined) {
            patch.activo_inicio = fields.activo_inicio !== false;
        }
        if (Object.keys(patch).length === 0) {
            return { ok: true, fecha_actualizacion: null };
        }
        const run = async () =>
            this.client.from('familias').update(patch).eq('CODIGO', cod).select('fecha_actualizacion').maybeSingle();
        let { data, error } = await run();
        if (error && error.code === '42501') {
            const refresh = await this.client.auth.refreshSession();
            if (!refresh.error && refresh.data && refresh.data.session) {
                const r2 = await run();
                data = r2.data;
                error = r2.error;
            }
        }
        if (error) {
            throw error;
        }
        return {
            ok: true,
            fecha_actualizacion: data && data.fecha_actualizacion != null ? data.fecha_actualizacion : null,
        };
    }

    async uploadFotosFamiliaJpeg(storagePath, blob) {
        if (!this.client) {
            throw new Error('Cliente no inicializado');
        }
        const { ok } = await this.ensureAuthSessionForWrite();
        if (!ok) {
            const err = new Error('SESSION_EXPIRED');
            err.code = 'SESSION_EXPIRED';
            throw err;
        }
        const path = String(storagePath || '').trim().replace(/^\/+/, '');
        if (!path) {
            throw new Error('Ruta de imagen vacia');
        }
        let up = await this.client.storage.from('fotos_familias').upload(path, blob, {
            upsert: true,
            contentType: 'image/jpeg',
            cacheControl: '60',
        });
        if (up.error) {
            const refresh = await this.client.auth.refreshSession();
            if (!refresh.error && refresh.data && refresh.data.session) {
                up = await this.client.storage.from('fotos_familias').upload(path, blob, {
                    upsert: true,
                    contentType: 'image/jpeg',
                    cacheControl: '60',
                });
            }
        }
        if (up.error) {
            throw up.error;
        }
        return path;
    }

    async deleteFotosFamiliaObject(storagePath) {
        if (!this.client) {
            throw new Error('Cliente no inicializado');
        }
        const { ok } = await this.ensureAuthSessionForWrite();
        if (!ok) {
            const err = new Error('SESSION_EXPIRED');
            err.code = 'SESSION_EXPIRED';
            throw err;
        }
        const path = String(storagePath || '').trim().replace(/^\/+/, '');
        if (!path) {
            return;
        }
        const del = await this.client.storage.from('fotos_familias').remove([path]);
        if (del.error) {
            throw del.error;
        }
    }
}

// Crear instancia global
window.supabaseClient = new SupabaseClient();

