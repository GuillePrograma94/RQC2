-- Correccion de enfoque: el WhatsApp de soporte es global para la app.
-- Este campo por empresa/almacen deja de utilizarse.

ALTER TABLE empresas_por_almacen
DROP COLUMN IF EXISTS whatsapp_soporte_errores;

