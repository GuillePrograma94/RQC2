-- Migracion: crear_pedido_remoto_sin_imprimir
-- Crea un pedido remoto DEPENDIENTE en estado "en_preparacion" para que checkout_pc
-- pueda entregarlo, pero sin impresión automática.
--
-- Estrategia:
-- - estado = 'en_preparacion'
-- - estado_procesamiento = 'procesando'
-- - pc_id con valor fijo para que checkout_pc no lo reclame para imprimir

CREATE OR REPLACE FUNCTION crear_pedido_remoto_sin_imprimir(
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
        SELECT 1 FROM carritos_clientes WHERE carritos_clientes.codigo_qr = v_codigo_qr
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
        pc_id,
        timestamp_proceso,
        fecha_creacion
    ) VALUES (
        v_codigo_qr,
        'en_preparacion',
        'remoto',
        p_almacen_destino,
        'procesando',
        p_usuario_id,
        v_codigo_cliente_usuario,
        NULLIF(trim(coalesce(p_observaciones, '')), ''),
        NULLIF(trim(coalesce(p_nombre_operario, '')), ''),
        'NO_IMPRIMIR',
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
        'Pedido remoto sin impresion creado exitosamente'::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT
        NULL::INTEGER,
        NULL::TEXT,
        NULL::TEXT,
        FALSE,
        SQLERRM::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION crear_pedido_remoto_sin_imprimir(INTEGER, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

