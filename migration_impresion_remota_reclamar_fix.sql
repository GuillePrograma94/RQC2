-- Migracion: evitar que checkout_pc imprima pedidos remotos antes de estar listos
-- 1) crear_pedido_remoto: estado_procesamiento pendiente hasta que la app termine de cargar lineas y ERP
-- 2) reclamar_pedido_remoto: solo pedidos con lineas y pedido_erp; timeout recupera reclamaciones atascadas (pc_id ocupado)

DROP FUNCTION IF EXISTS crear_pedido_remoto(INTEGER, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION crear_pedido_remoto(
    p_usuario_id INTEGER,
    p_almacen_destino TEXT,
    p_observaciones TEXT DEFAULT NULL,
    p_nombre_operario TEXT DEFAULT NULL
)
RETURNS TABLE (
    carrito_id INTEGER,
    codigo_qr TEXT,
    codigo_cliente_usuario TEXT,
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_codigo_qr TEXT;
    v_carrito_id INTEGER;
    v_codigo_cliente_usuario TEXT;
BEGIN
    v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    WHILE EXISTS (
        SELECT 1 FROM carritos_clientes c
        WHERE c.codigo_qr = v_codigo_qr
          AND c.estado IS NOT NULL
          AND c.estado NOT IN ('completado', 'cancelado')
    ) LOOP
        v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    END LOOP;

    SELECT codigo_usuario INTO v_codigo_cliente_usuario
    FROM usuarios
    WHERE id = p_usuario_id;

    INSERT INTO carritos_clientes (
        codigo_qr,
        estado,
        tipo_pedido,
        almacen_destino,
        estado_procesamiento,
        usuario_id,
        codigo_cliente_usuario,
        observaciones,
        nombre_operario,
        fecha_creacion
    ) VALUES (
        v_codigo_qr,
        'enviado',
        'remoto',
        p_almacen_destino,
        'pendiente',
        p_usuario_id,
        v_codigo_cliente_usuario,
        NULLIF(trim(coalesce(p_observaciones, '')), ''),
        NULLIF(trim(coalesce(p_nombre_operario, '')), ''),
        NOW()
    )
    RETURNING id INTO v_carrito_id;

    RETURN QUERY
    SELECT
        v_carrito_id,
        v_codigo_qr,
        v_codigo_cliente_usuario,
        TRUE,
        'Pedido remoto creado exitosamente'::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT
        NULL::INTEGER,
        NULL::TEXT,
        NULL::TEXT,
        FALSE,
        SQLERRM::TEXT;
END;
$$;

COMMENT ON FUNCTION crear_pedido_remoto(INTEGER, TEXT, TEXT, TEXT) IS
'Crea pedido remoto en pendiente hasta cargar lineas y ERP; marcarPedidoRemotoEnviado pasa a procesando para checkout_pc.';

GRANT EXECUTE ON FUNCTION crear_pedido_remoto(INTEGER, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS reclamar_pedido_remoto(TEXT, TEXT);

CREATE FUNCTION reclamar_pedido_remoto(
    p_almacen TEXT,
    p_pc_id TEXT
)
RETURNS TABLE (
    carrito_id INTEGER,
    codigo_qr TEXT,
    total_productos INTEGER,
    total_lineas INTEGER,
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
    v_total_lineas INTEGER;
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
          AND c2.estado = 'enviado'
          AND COALESCE(c2.total_productos, 0) > 0
          AND NULLIF(TRIM(COALESCE(c2.pedido_erp, '')), '') IS NOT NULL
          AND COALESCE(c2.pc_id, '') <> 'NO_IMPRIMIR'
          AND NOT (
              c2.estado = 'en_preparacion'
              AND NULLIF(TRIM(COALESCE(c2.pc_id, '')), '') IS NOT NULL
          )
          AND (
              (c2.estado_procesamiento = 'procesando' AND c2.pc_id IS NULL)
              OR (c2.estado_procesamiento = 'enviado' AND c2.pc_id IS NULL)
              OR (
                  c2.estado_procesamiento = 'procesando'
                  AND c2.timestamp_proceso < NOW() - INTERVAL '1 minute' * v_timeout_minutos
              )
          )
        ORDER BY c2.fecha_creacion ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING
        c.id,
        c.codigo_qr,
        c.total_productos,
        c.total_lineas,
        c.total_importe,
        c.fecha_creacion,
        c.usuario_id,
        c.pedido_erp
    INTO
        v_carrito_id,
        v_codigo_qr,
        v_total_productos,
        v_total_lineas,
        v_total_importe,
        v_fecha_creacion,
        v_usuario_id,
        v_pedido_erp;

    IF v_carrito_id IS NULL THEN
        RETURN QUERY SELECT
            NULL::INTEGER,
            NULL::TEXT,
            NULL::INTEGER,
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
        v_total_lineas,
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

COMMENT ON FUNCTION reclamar_pedido_remoto(TEXT, TEXT) IS
'Reclama pedido remoto listo para imprimir: requiere total_productos>0, pedido_erp y estado=enviado (aun no confirmado impreso). Timeout solo recupera enviado atascado; en_preparacion no se reimprime.';
