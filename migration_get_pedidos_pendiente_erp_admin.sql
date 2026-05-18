-- RPC: get_pedidos_pendiente_erp_admin
-- Lista todos los pedidos con estado_procesamiento = pendiente_erp (fallo de envio al ERP).
-- Solo usuarios con JWT app_metadata.es_administrador = true.
-- Ejecutar en el SQL Editor de Supabase.

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
        cc.total_importe::NUMERIC,
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
'Panel de control administrador: pedidos guardados en Supabase pendientes de envio al ERP.
Ordenados del mas antiguo al mas reciente. Limite 500.';

GRANT EXECUTE ON FUNCTION get_pedidos_pendiente_erp_admin() TO authenticated;
