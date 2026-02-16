-- Migracion: RPC marcar_pedido_impreso con estados unificados
-- Cuando checkout_pc imprime un pedido remoto: estado = en_preparacion, estado_procesamiento = procesando
-- Segun docs/ESTADOS_PEDIDOS_ESCENARIOS.md (nota A: "Cuando checkout_pc lo imprime...")

DROP FUNCTION IF EXISTS marcar_pedido_impreso(INTEGER, TEXT);

CREATE OR REPLACE FUNCTION marcar_pedido_impreso(
    p_carrito_id INTEGER,
    p_pc_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    -- Solo si este PC lo estaba procesando: pasar a en_preparacion (impreso en caja)
    UPDATE carritos_clientes
    SET estado = 'en_preparacion',
        estado_procesamiento = 'procesando',
        pc_id = p_pc_id
    WHERE id = p_carrito_id
      AND (pc_id = p_pc_id OR pc_id IS NULL)
      AND estado_procesamiento = 'procesando'
      AND estado = 'enviado';

    RETURN FOUND;

EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION marcar_pedido_impreso(INTEGER, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION marcar_pedido_impreso IS 'Marca pedido remoto como impreso en caja: estado=en_preparacion, estado_procesamiento=procesando';
