-- Migracion: total_lineas en carritos_clientes (numero de filas en productos_carrito)
-- Complementa total_productos (suma de unidades) para validar impresion completa en checkout_pc.

ALTER TABLE carritos_clientes
    ADD COLUMN IF NOT EXISTS total_lineas INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN carritos_clientes.total_lineas IS
    'Numero de filas en productos_carrito (COUNT), distinto de total_productos que es SUM(cantidad)';

-- Backfill pedidos existentes
UPDATE carritos_clientes cc
SET total_lineas = COALESCE((
    SELECT COUNT(*)::INTEGER
    FROM productos_carrito pc
    WHERE pc.carrito_id = cc.id
), 0);

CREATE OR REPLACE FUNCTION actualizar_totales_carrito()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE carritos_clientes
    SET
        total_productos = (
            SELECT COALESCE(SUM(cantidad), 0)
            FROM productos_carrito
            WHERE carrito_id = COALESCE(NEW.carrito_id, OLD.carrito_id)
        ),
        total_lineas = (
            SELECT COUNT(*)::INTEGER
            FROM productos_carrito
            WHERE carrito_id = COALESCE(NEW.carrito_id, OLD.carrito_id)
        ),
        total_importe = (
            SELECT COALESCE(SUM(subtotal), 0.0)
            FROM productos_carrito
            WHERE carrito_id = COALESCE(NEW.carrito_id, OLD.carrito_id)
        )
    WHERE id = COALESCE(NEW.carrito_id, OLD.carrito_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- reclamar_pedido_remoto: devolver total_lineas al checkout remoto
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
