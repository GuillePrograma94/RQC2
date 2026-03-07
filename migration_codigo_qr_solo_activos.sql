-- Considerar codigo_qr como "libre" solo si no existe en un carrito no finalizado.
-- OPCIONAL: Si usas migration_codigo_qr_null_al_finalizar.sql (trigger que anula codigo_qr
-- al pasar a completado/cancelado), no necesitas esta migracion: el WHILE simple
-- (EXISTS ... WHERE codigo_qr = v_codigo_qr) ya basta porque las finalizadas tienen codigo_qr NULL.
-- Ver docs/ANALISIS_PEDIDOS_CODIGO_QR.md

-- Actualizar crear_pedido_remoto (version con observaciones y nombre_operario)
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
    v_usuario_nombre TEXT;
    v_codigo_cliente_usuario TEXT;
BEGIN
    v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    -- Solo considerar "ocupado" si existe un carrito NO finalizado con ese codigo
    WHILE EXISTS (
        SELECT 1 FROM carritos_clientes c
        WHERE c.codigo_qr = v_codigo_qr
          AND c.estado IS NOT NULL
          AND c.estado NOT IN ('completado', 'cancelado')
    ) LOOP
        v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    END LOOP;

    SELECT nombre, codigo_usuario INTO v_usuario_nombre, v_codigo_cliente_usuario
    FROM usuarios WHERE id = p_usuario_id;

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
        'procesando',
        p_usuario_id,
        v_codigo_cliente_usuario,
        NULLIF(trim(coalesce(p_observaciones, '')), ''),
        NULLIF(trim(coalesce(p_nombre_operario, '')), ''),
        NOW()
    )
    RETURNING id INTO v_carrito_id;

    RETURN QUERY SELECT
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
'Crea pedido remoto. Genera codigo_qr unico solo entre carritos no finalizados (estado NOT IN completado,cancelado).';
