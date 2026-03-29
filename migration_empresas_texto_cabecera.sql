-- Migracion: texto de cabecera de app por almacen
-- Fecha: 2026-03-29
-- Objetivo: permitir personalizar el titulo principal (#headerTitle) por fila de empresas_por_almacen

ALTER TABLE empresas_por_almacen
    ADD COLUMN IF NOT EXISTS texto_cabecera TEXT NULL;

COMMENT ON COLUMN empresas_por_almacen.texto_cabecera IS 'Texto mostrado en la cabecera principal de la app; si NULL o vacio, se usa BATMAR.';
