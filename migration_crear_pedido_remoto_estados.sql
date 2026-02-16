-- Actualizar crear_pedido_remoto para usar estados unificados (ESTADOS_PEDIDOS_ESCENARIOS.md)
-- A1: pedido creado y enviado al ERP OK -> estado = enviado, estado_procesamiento = procesando

CREATE OR REPLACE FUNCTION crear_pedido_remoto(
    p_usuario_id INTEGER,
    p_almacen_destino TEXT
)
RETURNS TABLE (
    carrito_id INTEGER,
    codigo_qr TEXT,
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_codigo_qr TEXT;
    v_carrito_id INTEGER;
    v_usuario_nombre TEXT;
BEGIN
    v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    WHILE EXISTS (SELECT 1 FROM carritos_clientes WHERE carritos_clientes.codigo_qr = v_codigo_qr) LOOP
        v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    END LOOP;

    SELECT nombre INTO v_usuario_nombre FROM usuarios WHERE id = p_usuario_id;

    INSERT INTO carritos_clientes (
        codigo_qr,
        estado,
        tipo_pedido,
        almacen_destino,
        estado_procesamiento,
        usuario_id,
        fecha_creacion
    ) VALUES (
        v_codigo_qr,
        'enviado',
        'remoto',
        p_almacen_destino,
        'procesando',
        p_usuario_id,
        NOW()
    )
    RETURNING id INTO v_carrito_id;

    RETURN QUERY SELECT v_carrito_id, v_codigo_qr, TRUE, 'Pedido remoto creado exitosamente'::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::INTEGER, NULL::TEXT, FALSE, SQLERRM::TEXT;
END;
$$;
