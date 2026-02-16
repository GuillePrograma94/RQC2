/**
 * Cliente de Supabase para Scan as You Shop
 * Maneja la conexión con la base de datos en la nube
 */

class SupabaseClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
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

            // Obtener versión remota de Supabase (ordenar por ID en lugar de fecha para evitar problemas con zonas horarias)
            const { data: versionRemota, error } = await this.client
                .from('version_control')
                .select('*')
                .order('id', { ascending: false })
                .limit(1);

            if (error) throw error;

            if (!versionRemota || versionRemota.length === 0) {
                console.log('📊 No hay información de versión en Supabase');
                return { necesitaActualizacion: true, versionRemota: null };
            }

            const infoRemota = versionRemota[0];

            // Obtener hash local guardado
            const versionLocalHash = localStorage.getItem('version_hash_local');
            
            if (!versionLocalHash) {
                console.log('📊 Primera sincronización - necesita descargar datos');
                return { necesitaActualizacion: true, versionRemota: infoRemota };
            }

            // Comparar hashes
            const versionRemotaHash = infoRemota.version_hash || '';
            const necesitaActualizacion = versionLocalHash !== versionRemotaHash;

            console.log('📊 Verificación de versión:', {
                versionLocal: versionLocalHash.substring(0, 8) + '...',
                versionRemota: versionRemotaHash.substring(0, 8) + '...',
                necesitaActualizacion: necesitaActualizacion
            });

            return { necesitaActualizacion, versionRemota: infoRemota };

        } catch (error) {
            console.error('❌ Error al verificar actualización:', error);
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
                console.log('✅ Hash local actualizado:', versionRemota.version_hash.substring(0, 8) + '...');
            }
        } catch (error) {
            console.error('❌ Error al actualizar versión local:', error);
        }
    }

    /**
     * Descarga el catálogo de productos con paginación
     */
    async downloadProducts(onProgress = null) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('📥 Descargando productos desde Supabase...');

            // Descargar productos con paginación
            const productos = await this._downloadWithPagination('productos', onProgress);
            
            // Descargar códigos secundarios con paginación
            const codigosSecundarios = await this._downloadWithPagination('codigos_secundarios', onProgress);

            console.log(`✅ Productos descargados: ${productos.length}`);
            console.log(`✅ Códigos secundarios descargados: ${codigosSecundarios.length}`);

            return {
                productos: productos || [],
                codigosSecundarios: codigosSecundarios || []
            };

        } catch (error) {
            console.error('❌ Error al descargar productos:', error);
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

            console.log(`🔍 Llamando a obtener_estadisticas_cambios con hash: ${versionHashLocal?.substring(0, 16)}...`);

            const { data, error } = await this.client.rpc(
                'obtener_estadisticas_cambios',
                { p_version_hash_local: versionHashLocal }
            );

            if (error) {
                console.error('❌ Error al obtener estadísticas:', error);
                console.error('   Código:', error.code);
                console.error('   Mensaje:', error.message);
                console.error('   Detalles:', error.details);
                console.error('   Hint:', error.hint);
                console.warn('⚠️ Verifica que la función obtener_estadisticas_cambios existe en Supabase');
                return null; // Fallback a sincronización completa
            }

            console.log('📊 Respuesta de estadísticas:', data);

            return data && data.length > 0 ? data[0] : null;

        } catch (error) {
            console.error('❌ Error al obtener estadísticas de cambios:', error);
            console.error('   Stack:', error.stack);
            return null;
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

            console.log('⚡ Descargando cambios incrementales desde versión:', versionHashLocal?.substring(0, 8) + '...');

            // Obtener productos modificados
            const { data: productosData, error: productosError } = await this.client.rpc(
                'obtener_productos_modificados',
                { p_version_hash_local: versionHashLocal }
            );

            if (productosError) {
                console.error('❌ Error al obtener productos modificados:', productosError);
                throw productosError;
            }

            // Obtener códigos secundarios modificados
            const { data: codigosData, error: codigosError } = await this.client.rpc(
                'obtener_codigos_secundarios_modificados',
                { p_version_hash_local: versionHashLocal }
            );

            if (codigosError) {
                console.error('❌ Error al obtener códigos modificados:', codigosError);
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

            console.log(`✅ Cambios descargados: ${productos.length} productos, ${codigosSecundarios.length} códigos`);

            return {
                productos: productos,
                codigosSecundarios: codigosSecundarios,
                isIncremental: true
            };

        } catch (error) {
            console.error('❌ Error en sincronización incremental:', error);
            // Fallback a sincronización completa
            console.log('🔄 Fallback a sincronización completa...');
            return await this.downloadProducts(onProgress);
        }
    }

    /**
     * Descarga datos con paginación automática
     */
    async _downloadWithPagination(tableName, onProgress = null, filters = {}) {
        const allData = [];
        const pageSize = 1000;
        let page = 0;
        let hasMore = true;

        console.log(`📥 Iniciando descarga de ${tableName}...`);

        while (hasMore) {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            
            console.log(`📦 Descargando ${tableName} página ${page + 1} (registros ${from}-${to})...`);

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
            } else {
                query = query.order('id');
            }
            
            const { data, error, count } = await query;

            if (error) {
                console.error(`❌ Error en ${tableName}:`, error);
                throw error;
            }

            if (data && data.length > 0) {
                allData.push(...data);
                page++;
                
                console.log(`✅ ${tableName}: ${allData.length} de ${count || '?'} registros descargados`);
                
                // Reportar progreso
                if (onProgress) {
                    onProgress({
                        table: tableName,
                        loaded: allData.length,
                        total: count,
                        batch: data.length
                    });
                }
                
                // Si recibimos menos datos que el tamaño de página, hemos terminado
                hasMore = data.length === pageSize;
            } else {
                hasMore = false;
            }
        }

        console.log(`🎉 Descarga completada: ${tableName} - Total: ${allData.length} registros`);
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
                .single();

            if (producto) {
                return producto;
            }

            // Buscar en códigos secundarios
            const { data: codigoSec, error: errorCodigo } = await this.client
                .from('codigos_secundarios')
                .select('*, productos(*)')
                .eq('codigo_secundario', codigo)
                .single();

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

    /**
     * Verifica las credenciales de login de un usuario
     */
    async loginUser(codigoUsuario, password) {
        try {
            if (!this.client) {
                throw new Error('Cliente de Supabase no inicializado');
            }

            console.log('Intentando login para usuario:', codigoUsuario);

            // Hash de la contraseña
            const passwordHash = await this._hashPassword(password);

            // Llamar a la función SQL de verificación
            const { data, error } = await this.client.rpc(
                'verificar_login_usuario',
                {
                    p_codigo_usuario: codigoUsuario,
                    p_password_hash: passwordHash
                }
            );

            if (error) {
                console.error('Error en RPC:', error);
                throw error;
            }

            if (data && data.length > 0) {
                const loginResult = data[0];
                
                if (loginResult.success) {
                    console.log('Login exitoso:', loginResult.user_name);
                    return {
                        success: true,
                        user_id: loginResult.user_id,
                        user_name: loginResult.user_name,
                        codigo_usuario: codigoUsuario,
                        codigo_cliente: loginResult.codigo_cliente || null,
                        almacen_habitual: loginResult.almacen_habitual || null
                    };
                }
            }

            console.log('Login fallido: credenciales incorrectas');
            return {
                success: false,
                message: 'Usuario o contrasena incorrectos'
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
     * Crea un pedido remoto para un usuario y almacén específico
     */
    async crearPedidoRemoto(usuarioId, almacenDestino) {
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
                    p_almacen_destino: almacenDestino
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
                        codigo_qr: result.codigo_qr
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
            return {
                success: false,
                message: 'Error de conexion. Intenta de nuevo.'
            };
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

            // Actualizar ambos estados según estándar
            const { data, error } = await this.client
                .from('carritos_clientes')
                .update({
                    estado: 'enviado',
                    estado_procesamiento: 'enviado'
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
                .in('estado_procesamiento', ['enviado', 'procesando', 'impreso', 'completado']) // Solo pedidos que ya fueron enviados o procesados
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
     * Obtiene las ofertas disponibles para un producto según el código de cliente
     * Usa cache local primero para mejor rendimiento
     * @param {string} codigoArticulo - Código del artículo
     * @param {number} codigoCliente - Código del cliente (opcional, si es null se muestran todas las ofertas)
     * @param {boolean} useCache - Si usar cache local (default: true)
     * @returns {Promise<Array>} - Lista de ofertas disponibles
     */
    async getOfertasProducto(codigoArticulo, codigoCliente = null, useCache = true) {
        try {
            // Si no hay codigo_cliente, el usuario es invitado y NO ve ofertas
            if (!codigoCliente) {
                console.log('🚫 Usuario invitado - no se buscan ofertas');
                return [];
            }

            // Intentar obtener desde cache primero
            if (useCache && window.cartManager && window.cartManager.db) {
                console.log(`🔍 Buscando ofertas de ${codigoArticulo} en cache (cliente: ${codigoCliente})...`);
                const ofertasCache = await window.cartManager.getOfertasProductoFromCache(codigoArticulo, codigoCliente);
                if (ofertasCache && ofertasCache.length > 0) {
                    console.log(`✅ ${ofertasCache.length} ofertas encontradas en cache para ${codigoArticulo}`);
                    return ofertasCache;
                } else {
                    console.log(`⚠️ No se encontraron ofertas en cache para ${codigoArticulo} - buscando en Supabase...`);
                }
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

            // Si hay código de cliente, filtrar por grupos
            if (codigoCliente !== null && codigoCliente !== undefined) {
                console.log(`🔍 Filtrando ofertas para cliente con código: ${codigoCliente}`);
                
                // Obtener ofertas asignadas a grupos del cliente
                const { data: ofertasGrupos, error: errorGrupos } = await this.client
                    .from('ofertas_grupos_asignaciones')
                    .select('numero_oferta, codigo_grupo, ofertas_grupos!inner(codigo_grupo)')
                    .eq('ofertas_grupos.codigo_grupo', codigoCliente.toString());

                if (!errorGrupos && ofertasGrupos && ofertasGrupos.length > 0) {
                    // Filtrar ofertas: solo las que están asignadas al grupo del cliente
                    const numerosOfertasGrupo = new Set(ofertasGrupos.map(og => og.numero_oferta));
                    const ofertasFiltradas = ofertasProducto.filter(op => numerosOfertasGrupo.has(op.numero_oferta));
                    console.log(`✅ ${ofertasFiltradas.length} ofertas visibles para el cliente ${codigoCliente}`);
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
                    console.log(`⚠️ Cliente ${codigoCliente} no tiene ofertas asignadas`);
                    return [];
                }
            }

            // Si no hay código de cliente (INVITADO), NO mostrar ofertas
            console.log('🚫 Usuario invitado - no se muestran ofertas');
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

            console.log('📥 Descargando datos de ofertas desde Supabase con paginación...');

            // Descargar ofertas activas con TODOS los campos usando paginación
            console.log('📥 Descargando tabla ofertas...');
            const ofertas = await this._downloadWithPagination('ofertas', onProgress, { activa: true });

            // Log de muestra para verificar que se descargan los campos de título y descripción
            if (ofertas && ofertas.length > 0) {
                const primeraOferta = ofertas[0];
                console.log('📋 Muestra de campos descargados en ofertas:', {
                    numero_oferta: primeraOferta.numero_oferta,
                    tiene_titulo: !!primeraOferta.titulo_descripcion,
                    tiene_descripcion: !!primeraOferta.descripcion_detallada,
                    tipo_oferta: primeraOferta.tipo_oferta
                });
            }

            // Descargar productos en ofertas con paginación
            console.log('📥 Descargando tabla ofertas_productos...');
            const ofertasProductos = await this._downloadWithPagination('ofertas_productos', onProgress);

            // Descargar intervalos con paginación
            console.log('📥 Descargando tabla ofertas_intervalos...');
            const ofertasIntervalos = await this._downloadWithPagination('ofertas_intervalos', onProgress);
            
            // Log detallado de intervalos descargados
            if (ofertasIntervalos && ofertasIntervalos.length > 0) {
                console.log('📋 Muestra de intervalos descargados:', ofertasIntervalos.slice(0, 3));
                console.log('📋 Campos del primer intervalo:', Object.keys(ofertasIntervalos[0]));
            } else {
                console.log('⚠️ No se descargaron intervalos');
            }

            // Descargar detalles con paginación
            console.log('📥 Descargando tabla ofertas_detalles...');
            const ofertasDetalles = await this._downloadWithPagination('ofertas_detalles', onProgress);

            // Descargar asignaciones de grupos con paginación
            console.log('📥 Descargando tabla ofertas_grupos_asignaciones...');
            const ofertasGruposAsignaciones = await this._downloadWithPagination('ofertas_grupos_asignaciones', onProgress);
            
            // Log detallado de asignaciones descargadas
            if (ofertasGruposAsignaciones && ofertasGruposAsignaciones.length > 0) {
                console.log('📋 Muestra de asignaciones descargadas:', ofertasGruposAsignaciones.slice(0, 5));
            } else {
                console.log('⚠️ No se descargaron asignaciones de grupos');
            }

            // Guardar en cache local
            if (window.cartManager) {
                console.log('💾 Guardando ofertas en cache local...');
                await window.cartManager.saveOfertasToCache(ofertas || []);
                await window.cartManager.saveOfertasProductosToCache(ofertasProductos || []);
                await window.cartManager.saveOfertasIntervalosToCache(ofertasIntervalos || []);
                await window.cartManager.saveOfertasDetallesToCache(ofertasDetalles || []);
                await window.cartManager.saveOfertasGruposToCache(ofertasGruposAsignaciones || []);
            }

            console.log('✅ ========================================');
            console.log(`✅ Ofertas descargadas: ${ofertas?.length || 0}`);
            console.log(`✅ Productos en ofertas: ${ofertasProductos?.length || 0}`);
            console.log(`✅ Intervalos: ${ofertasIntervalos?.length || 0}`);
            console.log(`✅ Detalles: ${ofertasDetalles?.length || 0}`);
            console.log(`✅ Asignaciones de grupos: ${ofertasGruposAsignaciones?.length || 0}`);
            console.log('✅ ========================================');

            return {
                ofertas: ofertas || [],
                ofertasProductos: ofertasProductos || [],
                ofertasIntervalos: ofertasIntervalos || [],
                ofertasDetalles: ofertasDetalles || [],
                ofertasGruposAsignaciones: ofertasGruposAsignaciones || []
            };

        } catch (error) {
            console.error('❌ Error al descargar ofertas:', error);
            throw error;
        }
    }
}

// Crear instancia global
window.supabaseClient = new SupabaseClient();

