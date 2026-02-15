-- ============================================================
-- Migración: Registrar en historial al crear pedido remoto
-- Problema: Al generar un pedido remoto, los artículos no se
--           guardaban en historial_compras_usuario ("Solo artículos que he comprado").
-- Solución: Función que registra todos los productos del carrito
--           en el historial del usuario (mismo concepto que confirmar_compra_carrito).
-- ============================================================
-- Requisitos: setup_historial_compras.sql (tabla y registrar_producto_en_historial)
--             setup_pedidos_remotos.sql (carritos_clientes.usuario_id, productos_carrito)
-- ============================================================

CREATE OR REPLACE FUNCTION registrar_historial_desde_carrito(p_carrito_id INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_usuario_id INTEGER;
    v_producto RECORD;
BEGIN
    -- Obtener usuario_id del carrito (pedidos remotos tienen usuario_id)
    SELECT usuario_id INTO v_usuario_id
    FROM carritos_clientes
    WHERE id = p_carrito_id;

    IF v_usuario_id IS NULL THEN
        RETURN TRUE;
    END IF;

    -- Registrar cada producto distinto del carrito en el historial del usuario
    FOR v_producto IN
        SELECT DISTINCT codigo_producto
        FROM productos_carrito
        WHERE carrito_id = p_carrito_id
    LOOP
        PERFORM registrar_producto_en_historial(v_usuario_id, v_producto.codigo_producto);
    END LOOP;

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION registrar_historial_desde_carrito(INTEGER) IS
'Registra en historial_compras_usuario todos los productos de un carrito para el usuario asociado. Usado al crear pedido remoto para que "Solo articulos que he comprado" incluya esos productos.';
