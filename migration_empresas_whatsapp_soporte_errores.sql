-- Campo de WhatsApp para reporte de errores desde movil/iPhone.
-- Se configura por almacen en empresas_por_almacen desde Panel de Control.

ALTER TABLE empresas_por_almacen
ADD COLUMN IF NOT EXISTS whatsapp_soporte_errores TEXT;

COMMENT ON COLUMN empresas_por_almacen.whatsapp_soporte_errores IS
'Telefono WhatsApp de soporte para recibir reportes de errores desde scan_client_mobile.';

