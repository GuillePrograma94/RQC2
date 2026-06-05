-- Migracion: crear_pedido_presencial_tienda
-- Pedido presencial generado por dependiente/administrador desde scan_client_mobile (TiendaPC).

CREATE OR REPLACE FUNCTION crear_pedido_presencial_tienda(
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
        fecha_confirmacion,
        fecha_creacion
    ) VALUES (
        v_codigo_qr,
        'en_preparacion',
        'presencial',
        p_almacen_destino,
        'procesando',
        p_usuario_id,
        v_codigo_cliente_usuario,
        NULLIF(trim(coalesce(p_observaciones, '')), ''),
        NULLIF(trim(coalesce(p_nombre_operario, '')), ''),
        NOW(),
        NOW()
    )
    RETURNING id INTO v_carrito_id;

    RETURN QUERY
    SELECT
        v_carrito_id,
        v_codigo_qr,
        v_codigo_cliente_usuario,
        TRUE,
        'Pedido presencial tienda creado exitosamente'::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT
        NULL::INTEGER,
        NULL::TEXT,
        NULL::TEXT,
        FALSE,
        SQLERRM::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION crear_pedido_presencial_tienda(INTEGER, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION crear_pedido_presencial_tienda IS
'Crea pedido presencial desde TiendaPC (dependiente/admin). No entra en cola de tickets remotos.';
