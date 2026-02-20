-- Migracion: Usuario de Supabase Auth por operario (login operarios en la app)
-- Ejecutar en el SQL Editor de Supabase DESPUES de migration_perfil_operarios.sql y migration_login_operarios.sql
--
-- Problema: La API de login devuelve email "84845-01@labels.auth" para el operario, pero solo
-- creaba/actualizaba el usuario de Auth del TITULAR (usuarios.auth_user_id). El cliente hace
-- signInWithPassword con ese email y falla porque no existe ese usuario en Auth.
--
-- Solucion: Guardar en cada operario su propio auth_user_id (Supabase Auth UUID). La API crea
-- o actualiza un usuario de Auth con email "titular-operario@labels.auth" y guarda el id aqui.

ALTER TABLE usuarios_operarios
ADD COLUMN IF NOT EXISTS auth_user_id UUID;

COMMENT ON COLUMN usuarios_operarios.auth_user_id IS
'UUID del usuario en Supabase Auth para este operario (email titular-operario@labels.auth).';

CREATE INDEX IF NOT EXISTS idx_usuarios_operarios_auth_user_id ON usuarios_operarios(auth_user_id)
WHERE auth_user_id IS NOT NULL;
