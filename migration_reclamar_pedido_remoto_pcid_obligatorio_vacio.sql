-- Migracion: reclamar_pedido_remoto solo cuando pc_id esta vacio
-- Regla requerida: NO imprimir si pc_id no está vacío.
-- Incluye también la rama de timeout.

DROP FUNCTION IF EXISTS reclamar_pedido_remoto(TEXT, TEXT);

CREATE FUNCTION reclamar_pedido_remoto(
    p_almacen TEXT,
    p_pc_id TEXT
)
RETURNS TABLE (
    carrito_id INTEGER,
    codigo_qr TEXT,
    total_productos INTEGER,
    total_importe DECIMAL(10,2),
    usuario_nombre TEXT,
    fecha_creacion TIMESTAMP WITH TIME ZONE,
    pedido_erp TEXT,
    success BOOLEAN,
    error_message TEXT
) 
LANGUAGE plpgsql
AS $$
DECLARE
    v_carrito_id INTEGER;
    v_codigo_qr TEXT;
    v_total_productos INTEGER;
    v_total_importe DECIMAL(10,2);
    v_fecha_creacion TIMESTAMP WITH TIME ZONE;
    v_usuario_id INTEGER;
    v_pedido_erp TEXT;
    v_usuario_nombre TEXT;
    v_timeout_minutos INTEGER := 10;
BEGIN
    UPDATE carritos_clientes c
    SET 
        estado_procesamiento = 'procesando',
        pc_id = p_pc_id,
        timestamp_proceso = NOW()
    WHERE c.id = (
        SELECT c2.id 
        FROM carritos_clientes c2
        WHERE c2.tipo_pedido = 'remoto'
          AND c2.almacen_destino = p_almacen
          AND (
              (c2.estado_procesamiento = 'procesando' AND c2.estado = 'enviado' AND c2.pc_id IS NULL)
              OR (c2.estado_procesamiento = 'enviado' AND c2.pc_id IS NULL)
              OR (
                  c2.estado_procesamiento = 'procesando'
                  AND c2.timestamp_proceso < NOW() - INTERVAL '1 minute' * v_timeout_minutos
                  AND c2.pc_id IS NULL
              )
              OR (c2.estado = 'en_preparacion' AND c2.estado_procesamiento = 'procesando' AND c2.pc_id IS NULL)
          )
        ORDER BY c2.fecha_creacion ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING 
        c.id,
        c.codigo_qr,
        c.total_productos,
        c.total_importe,
        c.fecha_creacion,
        c.usuario_id,
        c.pedido_erp
    INTO 
        v_carrito_id,
        v_codigo_qr,
        v_total_productos,
        v_total_importe,
        v_fecha_creacion,
        v_usuario_id,
        v_pedido_erp;
    
    IF v_carrito_id IS NULL THEN
        RETURN QUERY SELECT 
            NULL::INTEGER,
            NULL::TEXT,
            NULL::INTEGER,
            NULL::DECIMAL(10,2),
            NULL::TEXT,
            NULL::TIMESTAMP WITH TIME ZONE,
            NULL::TEXT,
            FALSE,
            'No hay pedidos pendientes'::TEXT;
        RETURN;
    END IF;
    
    IF v_usuario_id IS NOT NULL THEN
        SELECT COALESCE(u.nombre, 'Cliente') INTO v_usuario_nombre
        FROM usuarios u
        WHERE u.id = v_usuario_id;
    END IF;
    
    IF v_usuario_nombre IS NULL THEN
        v_usuario_nombre := 'Cliente';
    END IF;
    
    RETURN QUERY 
    SELECT 
        v_carrito_id,
        v_codigo_qr,
        v_total_productos,
        v_total_importe,
        v_usuario_nombre,
        v_fecha_creacion,
        v_pedido_erp,
        TRUE,
        NULL::TEXT;
    
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        NULL::INTEGER,
        NULL::TEXT,
        NULL::INTEGER,
        NULL::DECIMAL(10,2),
        NULL::TEXT,
        NULL::TIMESTAMP WITH TIME ZONE,
        NULL::TEXT,
        FALSE,
        SQLERRM::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION reclamar_pedido_remoto(TEXT, TEXT) TO anon, authenticated, service_role;

