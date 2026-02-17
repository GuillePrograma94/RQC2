-- Anadir observaciones y nombre_operario a carritos_clientes.
-- Permite guardar las observaciones del pedido y el nombre del operario si el pedido lo hizo un operario.
-- Ejecutar despues de migration_carrito_codigo_cliente_usuario.sql (crear_pedido_remoto con codigo_cliente_usuario).

-- 1. Columnas en carritos_clientes
ALTER TABLE carritos_clientes
ADD COLUMN IF NOT EXISTS observaciones TEXT;

ALTER TABLE carritos_clientes
ADD COLUMN IF NOT EXISTS nombre_operario TEXT;

COMMENT ON COLUMN carritos_clientes.observaciones IS
'Observaciones del pedido (ej. RECOGER EN ALMACEN X, ENVIAR EN RUTA, texto libre).';

COMMENT ON COLUMN carritos_clientes.nombre_operario IS
'Nombre del operario que realizo el pedido, si aplica; NULL si lo hizo el titular.';

-- 2. Actualizar crear_pedido_remoto: aceptar observaciones y nombre_operario, guardarlos en el carrito
DROP FUNCTION IF EXISTS crear_pedido_remoto(INTEGER, TEXT);

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
    WHILE EXISTS (SELECT 1 FROM carritos_clientes WHERE carritos_clientes.codigo_qr = v_codigo_qr) LOOP
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

COMMENT ON FUNCTION crear_pedido_remoto IS
'Crea un carrito/pedido remoto. Guarda codigo_cliente_usuario, observaciones y nombre_operario (si aplica).';
