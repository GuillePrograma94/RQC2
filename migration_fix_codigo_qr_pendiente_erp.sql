-- Corrige pedidos con codigo_qr NULL por bug en sendRemoteOrder (marcaba error_erp antes de pendiente_erp).
-- Tambien corrige RPC get_pedidos_pendiente_erp_admin (casts TEXT para columnas character).

-- 1) Reparar codigo_qr en carritos activos sin codigo
DO $$
DECLARE
    r RECORD;
    v_codigo_qr TEXT;
BEGIN
    FOR r IN
        SELECT cc.id
        FROM carritos_clientes cc
        WHERE cc.codigo_qr IS NULL
          AND cc.estado NOT IN ('completado', 'cancelado')
          AND cc.estado_procesamiento IN ('pendiente_erp', 'procesando', 'pendiente')
    LOOP
        v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
        WHILE EXISTS (
            SELECT 1 FROM carritos_clientes c
            WHERE c.codigo_qr IS NOT NULL
              AND TRIM(c.codigo_qr::TEXT) = v_codigo_qr
        ) LOOP
            v_codigo_qr := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
        END LOOP;
        UPDATE carritos_clientes
        SET codigo_qr = v_codigo_qr
        WHERE id = r.id;
    END LOOP;
END;
$$;

-- 2) RPC admin con casts TEXT (evita error 42804)
DROP FUNCTION IF EXISTS get_pedidos_pendiente_erp_admin();

CREATE OR REPLACE FUNCTION get_pedidos_pendiente_erp_admin()
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
    cliente_nombre          TEXT,
    cliente_codigo_usuario  TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE(((auth.jwt() -> 'app_metadata') ->> 'es_administrador')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    RETURN QUERY
    SELECT
        cc.id,
        cc.usuario_id,
        NULLIF(TRIM(cc.codigo_qr::TEXT), '') AS codigo_qr,
        cc.tipo_pedido::TEXT,
        cc.estado::TEXT,
        cc.estado_procesamiento::TEXT,
        cc.almacen_destino::TEXT,
        cc.fecha_creacion,
        cc.total_productos,
        cc.total_importe,
        cc.observaciones::TEXT,
        cc.nombre_operario::TEXT,
        cc.pedido_erp::TEXT,
        cc.codigo_cliente_usuario::TEXT,
        u.nombre::TEXT AS cliente_nombre,
        u.codigo_usuario::TEXT AS cliente_codigo_usuario
    FROM carritos_clientes cc
    JOIN usuarios u ON u.id = cc.usuario_id
    WHERE cc.estado_procesamiento = 'pendiente_erp'
    ORDER BY cc.fecha_creacion ASC
    LIMIT 500;
END;
$$;

COMMENT ON FUNCTION get_pedidos_pendiente_erp_admin() IS
'Panel administrador: pedidos pendiente_erp. codigo_qr como TEXT (TRIM).';

GRANT EXECUTE ON FUNCTION get_pedidos_pendiente_erp_admin() TO authenticated;
