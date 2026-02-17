-- Migracion: Renombrar columna codigo_cliente a grupo_cliente en usuarios
-- Ejecutar en el SQL Editor de Supabase (despues de setup_usuarios_codigo_cliente.sql).
-- El campo sigue siendo el codigo numerico para match con ofertas_grupos.codigo_grupo.

-- Renombrar columna
ALTER TABLE usuarios
RENAME COLUMN codigo_cliente TO grupo_cliente;

-- Indice: eliminar el antiguo y crear el nuevo
DROP INDEX IF EXISTS idx_usuarios_codigo_cliente;
CREATE INDEX IF NOT EXISTS idx_usuarios_grupo_cliente ON usuarios(grupo_cliente)
WHERE grupo_cliente IS NOT NULL;

-- Comentario
COMMENT ON COLUMN usuarios.grupo_cliente IS
'Codigo numerico del grupo de ofertas del cliente. Coincide con codigo_grupo en ofertas_grupos para que el cliente vea las ofertas asignadas a ese grupo.';
