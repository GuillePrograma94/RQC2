-- Desplazamiento del logo en el PDF respecto al punto base (margen superior izquierdo del area util).
-- No afecta a la posicion del titulo, fecha, CIF ni CLIENTE (layout fijo).
-- Ejecutar en Supabase despues de migration_empresas_logo_pdf_tamano.sql (o con empresas_por_almacen ya existente).

ALTER TABLE empresas_por_almacen
    ADD COLUMN IF NOT EXISTS logo_pdf_offset_x_pt INTEGER NULL,
    ADD COLUMN IF NOT EXISTS logo_pdf_offset_y_pt INTEGER NULL;

COMMENT ON COLUMN empresas_por_almacen.logo_pdf_offset_x_pt IS 'Desplazamiento horizontal del logo en PDF (pt) desde margen izquierdo. NULL = 0.';
COMMENT ON COLUMN empresas_por_almacen.logo_pdf_offset_y_pt IS 'Desplazamiento vertical del logo en PDF (pt) desde margen superior. NULL = 0.';
