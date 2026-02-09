-- Migration: anadir columna pedido_erp a carritos_clientes
-- La respuesta del ERP devuelve "pedido": "string"; se guarda aqui.
-- Ejecutar en Supabase: SQL Editor

ALTER TABLE public.carritos_clientes
ADD COLUMN IF NOT EXISTS pedido_erp TEXT;

COMMENT ON COLUMN public.carritos_clientes.pedido_erp IS 'Identificador del pedido devuelto por el ERP al crear el pedido';
