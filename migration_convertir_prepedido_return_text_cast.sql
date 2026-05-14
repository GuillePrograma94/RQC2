-- Corrige error 42804 al aceptar prepedido: codigo_qr en BD puede ser character(n)
-- y la funcion declara RETURNS codigo_qr TEXT; Postgres exige coincidencia exacta.
-- Ejecutar en Supabase SQL Editor (proyecto ya desplegado).

CREATE OR REPLACE FUNCTION convertir_prepedido_a_pedido_remoto(
    p_prepedido_id INTEGER,
    p_usuario_id INTEGER,
    p_almacen_destino TEXT,
    p_observaciones TEXT,
    p_nombre_operario TEXT
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
    v_carrito RECORD;
    v_codigo_cliente_usuario TEXT;
BEGIN
    SELECT *
    INTO v_carrito
    FROM carritos_clientes cc
    WHERE cc.id = p_prepedido_id
      AND cc.tipo_pedido = 'remoto'
      AND cc.estado = 'activo'
      AND cc.estado_procesamiento = 'pendiente'
      AND (p_usuario_id IS NULL OR cc.usuario_id = p_usuario_id)
    LIMIT 1;

    IF v_carrito IS NULL THEN
        RETURN QUERY SELECT NULL::INTEGER, NULL::TEXT, NULL::TEXT, FALSE, 'Prepedido no disponible para aceptar'::TEXT;
        RETURN;
    END IF;

    SELECT codigo_usuario INTO v_codigo_cliente_usuario
    FROM usuarios
    WHERE id = v_carrito.usuario_id;

    UPDATE carritos_clientes
    SET
        almacen_destino = COALESCE(NULLIF(TRIM(COALESCE(p_almacen_destino, '')), ''), v_carrito.almacen_destino),
        observaciones = COALESCE(NULLIF(TRIM(COALESCE(p_observaciones, '')), ''), v_carrito.observaciones),
        nombre_operario = COALESCE(NULLIF(TRIM(COALESCE(p_nombre_operario, '')), ''), v_carrito.nombre_operario),
        codigo_cliente_usuario = COALESCE(v_codigo_cliente_usuario, v_carrito.codigo_cliente_usuario),
        estado = 'enviado',
        estado_procesamiento = 'procesando'
    WHERE id = p_prepedido_id;

    RETURN QUERY SELECT
        v_carrito.id,
        v_carrito.codigo_qr::TEXT,
        COALESCE(v_codigo_cliente_usuario, v_carrito.codigo_cliente_usuario)::TEXT,
        TRUE,
        'Prepedido aceptado correctamente'::TEXT;
END;
$$;
