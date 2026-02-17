-- Anadir codigo_cliente_usuario a carritos_clientes y devolverlo al crear pedido remoto.
-- El codigo que se envia al ERP viene de este campo (usuarios.codigo_usuario del titular al crear el carrito).

-- 1. Columna en carritos_clientes
ALTER TABLE carritos_clientes
ADD COLUMN IF NOT EXISTS codigo_cliente_usuario TEXT;

COMMENT ON COLUMN carritos_clientes.codigo_cliente_usuario IS
'Codigo de cliente (usuarios.codigo_usuario del titular) al crear el pedido. Se envia en el JSON al ERP.';

CREATE INDEX IF NOT EXISTS idx_carritos_codigo_cliente_usuario ON carritos_clientes(codigo_cliente_usuario)
WHERE codigo_cliente_usuario IS NOT NULL;

-- 2. Actualizar crear_pedido_remoto: guardar y devolver codigo_cliente_usuario
-- (PostgreSQL no permite cambiar el tipo de retorno con CREATE OR REPLACE; hay que hacer DROP antes.)
DROP FUNCTION IF EXISTS crear_pedido_remoto(INTEGER, TEXT);

CREATE OR REPLACE FUNCTION crear_pedido_remoto(
    p_usuario_id INTEGER,
    p_almacen_destino TEXT
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
        fecha_creacion
    ) VALUES (
        v_codigo_qr,
        'enviado',
        'remoto',
        p_almacen_destino,
        'procesando',
        p_usuario_id,
        v_codigo_cliente_usuario,
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
'Crea un carrito/pedido remoto. Guarda usuarios.codigo_usuario en codigo_cliente_usuario para el JSON al ERP.';
