-- Migracion: RPC marcar_pedido_impreso con estados unificados
-- Cuando checkout_pc imprime un pedido remoto: estado = en_preparacion, estado_procesamiento = procesando
-- Acepta estado = 'enviado' (primera impresion) y estado = 'en_preparacion' (reclamado ya en preparacion; solo actualiza pc_id/timestamp)

DROP FUNCTION IF EXISTS marcar_pedido_impreso(INTEGER, TEXT);

CREATE OR REPLACE FUNCTION marcar_pedido_impreso(
    p_carrito_id INTEGER,
    p_pc_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    -- Este PC reclamo el pedido (pc_id = p_pc_id o aun NULL): confirmar impresion
    -- Si estado = enviado -> pasar a en_preparacion; si ya en_preparacion -> solo actualizar pc_id y timestamp
    UPDATE carritos_clientes
    SET estado = CASE WHEN estado = 'enviado' THEN 'en_preparacion' ELSE estado END,
        estado_procesamiento = 'procesando',
        pc_id = p_pc_id,
        timestamp_proceso = NOW()
    WHERE id = p_carrito_id
      AND (pc_id = p_pc_id OR pc_id IS NULL)
      AND estado_procesamiento = 'procesando'
      AND estado IN ('enviado', 'en_preparacion');

    RETURN FOUND;

EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION marcar_pedido_impreso(INTEGER, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION marcar_pedido_impreso IS 'Marca pedido remoto como impreso en caja: estado=en_preparacion, estado_procesamiento=procesando. Acepta enviado (transicion) o en_preparacion (solo pc_id/timestamp).';
