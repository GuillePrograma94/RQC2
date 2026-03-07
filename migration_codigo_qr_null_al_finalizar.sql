-- Anular carritos_clientes.codigo_qr cuando el pedido pasa a completado o cancelado.
-- Asi el codigo queda libre para nuevos pedidos y la unicidad se comprueba solo contra filas con codigo no nulo.
-- Ver docs/ANALISIS_PEDIDOS_CODIGO_QR.md

-- 1. Permitir NULL en codigo_qr (por si la tabla se creo con NOT NULL)
ALTER TABLE carritos_clientes
ALTER COLUMN codigo_qr DROP NOT NULL;

-- 2. Funcion que anula codigo_qr al finalizar
CREATE OR REPLACE FUNCTION carritos_clientes_clear_codigo_qr_on_finalized()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.estado IN ('completado', 'cancelado') THEN
        NEW.codigo_qr := NULL;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION carritos_clientes_clear_codigo_qr_on_finalized() IS
'Trigger: al pasar estado a completado o cancelado, anula codigo_qr para liberar el codigo.';

-- 3. Trigger BEFORE UPDATE
DROP TRIGGER IF EXISTS trg_carritos_clear_codigo_qr ON carritos_clientes;

CREATE TRIGGER trg_carritos_clear_codigo_qr
    BEFORE UPDATE ON carritos_clientes
    FOR EACH ROW
    WHEN (
        OLD.estado IS DISTINCT FROM NEW.estado
        AND NEW.estado IN ('completado', 'cancelado')
    )
    EXECUTE PROCEDURE carritos_clientes_clear_codigo_qr_on_finalized();

-- 4. Datos existentes: anular codigo_qr en filas ya finalizadas
UPDATE carritos_clientes
SET codigo_qr = NULL
WHERE estado IN ('completado', 'cancelado')
  AND codigo_qr IS NOT NULL;
