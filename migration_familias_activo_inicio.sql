-- =============================================================================
-- Familias: toggle de visibilidad en Inicio > Catalogo por familia
-- Solo controla la aparicion en el arbol de Inicio.
-- =============================================================================

ALTER TABLE familias
    ADD COLUMN IF NOT EXISTS activo_inicio BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE familias
SET activo_inicio = TRUE
WHERE activo_inicio IS NULL;

COMMENT ON COLUMN familias.activo_inicio IS
    'Controla si la familia aparece en Inicio > Catalogo por familia (TRUE visible, FALSE oculta).';
