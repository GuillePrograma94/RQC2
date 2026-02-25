-- Migration: Añadir columnas alias y poblacion a la tabla usuarios
-- Ejecutar en el SQL Editor de Supabase.
-- Fecha: 2026-02-25

-- ============================================
-- NUEVAS COLUMNAS EN usuarios
-- ============================================

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS alias TEXT,
    ADD COLUMN IF NOT EXISTS poblacion TEXT;

COMMENT ON COLUMN usuarios.alias IS 'Alias o nombre comercial del cliente (visible para el comercial que le representa)';
COMMENT ON COLUMN usuarios.poblacion IS 'Poblacion / municipio del cliente (para filtrar en la seleccion de clientes)';

-- ============================================
-- ACTUALIZAR RPC get_clientes_asignados_comercial
-- Incluye los nuevos campos alias y poblacion
-- ============================================

DROP FUNCTION IF EXISTS get_clientes_asignados_comercial(INTEGER);

CREATE OR REPLACE FUNCTION get_clientes_asignados_comercial(p_comercial_numero INTEGER)
RETURNS TABLE (
    id INTEGER,
    nombre TEXT,
    codigo_usuario TEXT,
    almacen_habitual TEXT,
    grupo_cliente INTEGER,
    alias TEXT,
    poblacion TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        u.id,
        u.nombre,
        u.codigo_usuario,
        u.almacen_habitual,
        u.grupo_cliente,
        u.alias,
        u.poblacion
    FROM usuarios u
    WHERE u.comercial_asignado = p_comercial_numero
      AND (u.activo IS NULL OR u.activo = TRUE)
    ORDER BY u.nombre;
$$;

COMMENT ON FUNCTION get_clientes_asignados_comercial(INTEGER) IS
'Devuelve los clientes asignados al comercial (comercial_asignado = p_comercial_numero), con almacen_habitual, grupo_cliente, alias y poblacion. Para scan_client_mobile.';
