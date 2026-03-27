-- Migracion: Prepedidos compartidos por cliente (scan_client_mobile)
-- Fecha: 2026-03-27
-- Objetivo:
-- 1) Guardar carritos como prepedido (carritos_clientes + productos_carrito)
-- 2) Listar prepedidos por cliente y vistas agregadas de comercial/dependiente
-- 3) Permitir eliminar prepedido
-- 4) Convertir prepedido a pedido remoto listo para envio ERP

DROP FUNCTION IF EXISTS crear_prepedido(INTEGER, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS get_prepedidos_usuario(INTEGER);
DROP FUNCTION IF EXISTS get_prepedidos_comercial(INTEGER);
DROP FUNCTION IF EXISTS get_prepedidos_dependiente(INTEGER);
DROP FUNCTION IF EXISTS eliminar_prepedido(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS actualizar_prepedido(INTEGER, INTEGER, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS convertir_prepedido_a_pedido_remoto(INTEGER, INTEGER, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION crear_prepedido(
    p_usuario_id INTEGER,
    p_almacen_destino TEXT,
    p_observaciones TEXT,
    p_nombre_operario TEXT,
    p_productos JSONB
)
RETURNS TABLE (
    prepedido_id INTEGER,
    codigo_qr TEXT,
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_codigo_qr TEXT;
    v_prepedido_id INTEGER;
    v_producto JSONB;
    v_codigo_cliente_usuario TEXT;
BEGIN
    IF p_usuario_id IS NULL THEN
        RETURN QUERY SELECT NULL::INTEGER, NULL::TEXT, FALSE, 'Usuario no valido'::TEXT;
        RETURN;
    END IF;

    IF p_productos IS NULL OR jsonb_typeof(p_productos) <> 'array' OR jsonb_array_length(p_productos) = 0 THEN
        RETURN QUERY SELECT NULL::INTEGER, NULL::TEXT, FALSE, 'El prepedido no tiene productos'::TEXT;
        RETURN;
    END IF;

    SELECT codigo_usuario INTO v_codigo_cliente_usuario
    FROM usuarios
    WHERE id = p_usuario_id;

    v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    WHILE EXISTS (SELECT 1 FROM carritos_clientes WHERE carritos_clientes.codigo_qr = v_codigo_qr) LOOP
        v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    END LOOP;

    INSERT INTO carritos_clientes (
        codigo_qr,
        estado,
        tipo_pedido,
        almacen_destino,
        estado_procesamiento,
        usuario_id,
        fecha_creacion,
        observaciones,
        nombre_operario,
        codigo_cliente_usuario,
        total_productos,
        total_importe
    ) VALUES (
        v_codigo_qr,
        'activo',
        'remoto',
        p_almacen_destino,
        'pendiente',
        p_usuario_id,
        NOW(),
        NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
        NULLIF(TRIM(COALESCE(p_nombre_operario, '')), ''),
        v_codigo_cliente_usuario,
        0,
        0
    )
    RETURNING id INTO v_prepedido_id;

    FOR v_producto IN SELECT * FROM jsonb_array_elements(p_productos)
    LOOP
        INSERT INTO productos_carrito (
            carrito_id,
            codigo_producto,
            descripcion_producto,
            cantidad,
            precio_unitario,
            subtotal
        ) VALUES (
            v_prepedido_id,
            COALESCE(v_producto->>'codigo_producto', ''),
            COALESCE(v_producto->>'descripcion_producto', ''),
            COALESCE((v_producto->>'cantidad')::INTEGER, 0),
            COALESCE((v_producto->>'precio_unitario')::NUMERIC, 0),
            COALESCE((v_producto->>'cantidad')::INTEGER, 0) * COALESCE((v_producto->>'precio_unitario')::NUMERIC, 0)
        );
    END LOOP;

    UPDATE carritos_clientes
    SET
        total_productos = COALESCE((
            SELECT SUM(pc.cantidad) FROM productos_carrito pc WHERE pc.carrito_id = v_prepedido_id
        ), 0),
        total_importe = COALESCE((
            SELECT SUM(pc.subtotal) FROM productos_carrito pc WHERE pc.carrito_id = v_prepedido_id
        ), 0)
    WHERE id = v_prepedido_id;

    RETURN QUERY SELECT v_prepedido_id, v_codigo_qr, TRUE, 'Prepedido guardado correctamente'::TEXT;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::INTEGER, NULL::TEXT, FALSE, SQLERRM::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION get_prepedidos_usuario(p_usuario_id INTEGER)
RETURNS TABLE (
    id                      INTEGER,
    usuario_id              INTEGER,
    codigo_qr               TEXT,
    tipo_pedido             TEXT,
    estado                  TEXT,
    estado_procesamiento    TEXT,
    almacen_destino         TEXT,
    fecha_creacion          TIMESTAMPTZ,
    total_productos         INTEGER,
    total_importe           NUMERIC,
    observaciones           TEXT,
    nombre_operario         TEXT,
    pedido_erp              TEXT,
    codigo_cliente_usuario  TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        cc.id,
        cc.usuario_id,
        cc.codigo_qr,
        cc.tipo_pedido,
        cc.estado,
        cc.estado_procesamiento,
        cc.almacen_destino,
        cc.fecha_creacion,
        cc.total_productos,
        cc.total_importe,
        cc.observaciones,
        cc.nombre_operario,
        cc.pedido_erp,
        cc.codigo_cliente_usuario
    FROM carritos_clientes cc
    WHERE cc.usuario_id = p_usuario_id
      AND cc.tipo_pedido = 'remoto'
      AND cc.estado = 'activo'
      AND cc.estado_procesamiento = 'pendiente'
    ORDER BY cc.fecha_creacion DESC
    LIMIT 300;
$$;

CREATE OR REPLACE FUNCTION get_prepedidos_comercial(p_comercial_numero INTEGER)
RETURNS TABLE (
    id                      INTEGER,
    usuario_id              INTEGER,
    codigo_qr               TEXT,
    tipo_pedido             TEXT,
    estado                  TEXT,
    estado_procesamiento    TEXT,
    almacen_destino         TEXT,
    fecha_creacion          TIMESTAMPTZ,
    total_productos         INTEGER,
    total_importe           NUMERIC,
    observaciones           TEXT,
    nombre_operario         TEXT,
    pedido_erp              TEXT,
    codigo_cliente_usuario  TEXT,
    cliente_nombre          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        cc.id,
        cc.usuario_id,
        cc.codigo_qr,
        cc.tipo_pedido,
        cc.estado,
        cc.estado_procesamiento,
        cc.almacen_destino,
        cc.fecha_creacion,
        cc.total_productos,
        cc.total_importe,
        cc.observaciones,
        cc.nombre_operario,
        cc.pedido_erp,
        cc.codigo_cliente_usuario,
        u.nombre AS cliente_nombre
    FROM carritos_clientes cc
    JOIN usuarios u ON u.id = cc.usuario_id
    WHERE u.comercial_asignado = p_comercial_numero
      AND cc.tipo_pedido = 'remoto'
      AND cc.estado = 'activo'
      AND cc.estado_procesamiento = 'pendiente'
    ORDER BY cc.fecha_creacion DESC
    LIMIT 300;
$$;

CREATE OR REPLACE FUNCTION get_prepedidos_dependiente(p_dependiente_user_id INTEGER)
RETURNS TABLE (
    id                      INTEGER,
    usuario_id              INTEGER,
    codigo_qr               TEXT,
    tipo_pedido             TEXT,
    estado                  TEXT,
    estado_procesamiento    TEXT,
    almacen_destino         TEXT,
    fecha_creacion          TIMESTAMPTZ,
    total_productos         INTEGER,
    total_importe           NUMERIC,
    observaciones           TEXT,
    nombre_operario         TEXT,
    pedido_erp              TEXT,
    codigo_cliente_usuario  TEXT,
    cliente_nombre          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        cc.id,
        cc.usuario_id,
        cc.codigo_qr,
        cc.tipo_pedido,
        cc.estado,
        cc.estado_procesamiento,
        cc.almacen_destino,
        cc.fecha_creacion,
        cc.total_productos,
        cc.total_importe,
        cc.observaciones,
        cc.nombre_operario,
        cc.pedido_erp,
        cc.codigo_cliente_usuario,
        u.nombre AS cliente_nombre
    FROM usuarios_dependientes ud
    JOIN usuarios u ON u.almacen_habitual = ud.almacen_tienda
    JOIN carritos_clientes cc ON cc.usuario_id = u.id
    WHERE ud.usuario_id = p_dependiente_user_id
      AND ud.activo = TRUE
      AND (u.activo IS NULL OR u.activo = TRUE)
      AND COALESCE(u.tipo, 'CLIENTE') IN ('CLIENTE', 'ADMINISTRADOR')
      AND cc.tipo_pedido = 'remoto'
      AND cc.estado = 'activo'
      AND cc.estado_procesamiento = 'pendiente'
    ORDER BY cc.fecha_creacion DESC
    LIMIT 300;
$$;

CREATE OR REPLACE FUNCTION eliminar_prepedido(
    p_prepedido_id INTEGER,
    p_usuario_id INTEGER
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INTEGER := 0;
BEGIN
    DELETE FROM productos_carrito
    WHERE carrito_id = p_prepedido_id
      AND EXISTS (
          SELECT 1
          FROM carritos_clientes cc
          WHERE cc.id = p_prepedido_id
            AND cc.tipo_pedido = 'remoto'
            AND cc.estado = 'activo'
            AND cc.estado_procesamiento = 'pendiente'
            AND (p_usuario_id IS NULL OR cc.usuario_id = p_usuario_id)
      );

    DELETE FROM carritos_clientes cc
    WHERE cc.id = p_prepedido_id
      AND cc.tipo_pedido = 'remoto'
      AND cc.estado = 'activo'
      AND cc.estado_procesamiento = 'pendiente'
      AND (p_usuario_id IS NULL OR cc.usuario_id = p_usuario_id);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 0 THEN
        RETURN QUERY SELECT FALSE, 'No se encontro el prepedido o no se puede eliminar'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, 'Prepedido eliminado correctamente'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION actualizar_prepedido(
    p_prepedido_id INTEGER,
    p_usuario_id INTEGER,
    p_almacen_destino TEXT,
    p_observaciones TEXT,
    p_nombre_operario TEXT,
    p_productos JSONB
)
RETURNS TABLE (
    prepedido_id INTEGER,
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_producto JSONB;
BEGIN
    IF p_productos IS NULL OR jsonb_typeof(p_productos) <> 'array' OR jsonb_array_length(p_productos) = 0 THEN
        RETURN QUERY SELECT NULL::INTEGER, FALSE, 'El prepedido no tiene productos'::TEXT;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM carritos_clientes cc
        WHERE cc.id = p_prepedido_id
          AND cc.tipo_pedido = 'remoto'
          AND cc.estado = 'activo'
          AND cc.estado_procesamiento = 'pendiente'
          AND (p_usuario_id IS NULL OR cc.usuario_id = p_usuario_id)
    ) THEN
        RETURN QUERY SELECT NULL::INTEGER, FALSE, 'No se encontro el prepedido o no se puede editar'::TEXT;
        RETURN;
    END IF;

    UPDATE carritos_clientes
    SET
        almacen_destino = COALESCE(NULLIF(TRIM(COALESCE(p_almacen_destino, '')), ''), almacen_destino),
        observaciones = NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
        nombre_operario = NULLIF(TRIM(COALESCE(p_nombre_operario, '')), '')
    WHERE id = p_prepedido_id;

    DELETE FROM productos_carrito
    WHERE carrito_id = p_prepedido_id;

    FOR v_producto IN SELECT * FROM jsonb_array_elements(p_productos)
    LOOP
        INSERT INTO productos_carrito (
            carrito_id,
            codigo_producto,
            descripcion_producto,
            cantidad,
            precio_unitario,
            subtotal
        ) VALUES (
            p_prepedido_id,
            COALESCE(v_producto->>'codigo_producto', ''),
            COALESCE(v_producto->>'descripcion_producto', ''),
            COALESCE((v_producto->>'cantidad')::INTEGER, 0),
            COALESCE((v_producto->>'precio_unitario')::NUMERIC, 0),
            COALESCE((v_producto->>'cantidad')::INTEGER, 0) * COALESCE((v_producto->>'precio_unitario')::NUMERIC, 0)
        );
    END LOOP;

    UPDATE carritos_clientes
    SET
        total_productos = COALESCE((
            SELECT SUM(pc.cantidad) FROM productos_carrito pc WHERE pc.carrito_id = p_prepedido_id
        ), 0),
        total_importe = COALESCE((
            SELECT SUM(pc.subtotal) FROM productos_carrito pc WHERE pc.carrito_id = p_prepedido_id
        ), 0)
    WHERE id = p_prepedido_id;

    RETURN QUERY SELECT p_prepedido_id, TRUE, 'Prepedido actualizado correctamente'::TEXT;
END;
$$;

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
        v_carrito.codigo_qr,
        COALESCE(v_codigo_cliente_usuario, v_carrito.codigo_cliente_usuario),
        TRUE,
        'Prepedido aceptado correctamente'::TEXT;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_carritos_prepedidos_usuario_fecha
ON carritos_clientes(usuario_id, fecha_creacion DESC)
WHERE tipo_pedido = 'remoto' AND estado = 'activo' AND estado_procesamiento = 'pendiente';
