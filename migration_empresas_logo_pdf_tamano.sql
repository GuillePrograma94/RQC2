-- Tamano del logo en el PDF de presupuesto (puntos PDF; opcional, NULL = usar predeterminado en generate-pdf.js)
-- Ejecutar en Supabase despues de empresas_por_almacen existente.

ALTER TABLE empresas_por_almacen
    ADD COLUMN IF NOT EXISTS logo_pdf_ancho_pt INTEGER NULL,
    ADD COLUMN IF NOT EXISTS logo_pdf_alto_pt INTEGER NULL;

COMMENT ON COLUMN empresas_por_almacen.logo_pdf_ancho_pt IS 'Ancho del logo en presupuesto PDF (pt). NULL = predeterminado de la app.';
COMMENT ON COLUMN empresas_por_almacen.logo_pdf_alto_pt IS 'Alto del logo en presupuesto PDF (pt). NULL = predeterminado de la app.';
