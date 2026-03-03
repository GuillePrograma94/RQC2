-- RPC: get_pedidos_comercial
-- Devuelve todos los pedidos de los clientes asignados a un comercial en una sola consulta.
-- Sustituye el patron N+1 (getClientesAsignadosComercial + getUserRemoteOrders por cada cliente).
-- Orden: COMPLETADO siempre al final; dentro de cada grupo, mas recientes primero.
-- Ejecutar en el SQL Editor de Supabase.

DROP FUNCTION IF EXISTS get_pedidos_comercial(INTEGER);

CREATE OR REPLACE FUNCTION get_pedidos_comercial(p_comercial_numero INTEGER)
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
      AND cc.estado_procesamiento IN ('procesando', 'completado', 'pendiente_erp')
    ORDER BY
        CASE WHEN cc.estado_procesamiento = 'completado' THEN 1 ELSE 0 END ASC,
        cc.fecha_creacion DESC
    LIMIT 300;
$$;

COMMENT ON FUNCTION get_pedidos_comercial(INTEGER) IS
'Devuelve los pedidos de todos los clientes asignados al comercial (comercial_asignado = p_comercial_numero).
Incluye cliente_nombre para mostrarlo en la tarjeta. Ordenados: COMPLETADO al final, resto por fecha DESC.
Limite 300 pedidos totales. Para scan_client_mobile.';
