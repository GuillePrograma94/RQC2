-- Columna opcional para guardar codigo de albaran ERP en pedidos presenciales tienda.

ALTER TABLE carritos_clientes
    ADD COLUMN IF NOT EXISTS albaran_erp TEXT;

COMMENT ON COLUMN carritos_clientes.albaran_erp IS 'Codigo de albaran devuelto por ERP en pedidos PRESENCIAL (tienda staff).';
