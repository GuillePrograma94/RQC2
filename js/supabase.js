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

            // Obtener versión remota de Supabase
            const { data: versionRemota, error } = await this.client
                .from('version_control')
                .select('*')
                .order('fecha_actualizacion', { ascending: false })
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
     * Descarga datos con paginación automática
     */
    async _downloadWithPagination(tableName, onProgress = null) {
        const allData = [];
        const pageSize = 1000;
        let page = 0;
        let hasMore = true;

        console.log(`📥 Iniciando descarga de ${tableName}...`);

        while (hasMore) {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            
            console.log(`📦 Descargando ${tableName} página ${page + 1} (registros ${from}-${to})...`);

            const { data, error, count } = await this.client
                .from(tableName)
                .select('*', { count: 'exact' })
                .range(from, to)
                .order(tableName === 'productos' ? 'codigo' : 'codigo_secundario');

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

            // Verificar si el producto ya existe en el carrito
            const { data: existing, error: errorCheck } = await this.client
                .from('productos_carrito')
                .select('*')
                .eq('carrito_id', carritoId)
                .eq('codigo_producto', producto.codigo)
                .single();

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
     * Obtiene el historial de compras de un usuario
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
}

// Crear instancia global
window.supabaseClient = new SupabaseClient();

