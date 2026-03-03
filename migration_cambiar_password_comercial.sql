-- Migracion: Cambio de contrasena para comerciales
-- Ejecutar en el SQL Editor de Supabase.
-- Permite que un comercial cambie su propia contrasena verificando la actual.
-- La contrasena se almacena en usuarios_comerciales.password_hash (SHA-256 hex).

CREATE OR REPLACE FUNCTION cambiar_password_comercial(
    p_comercial_id INTEGER,
    p_password_actual_hash TEXT,
    p_password_nueva_hash TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM usuarios_comerciales
        WHERE id = p_comercial_id
          AND password_hash = p_password_actual_hash
    ) THEN
        RETURN QUERY SELECT FALSE, 'Contrasena actual incorrecta'::TEXT;
        RETURN;
    END IF;

    UPDATE usuarios_comerciales
    SET password_hash = p_password_nueva_hash
    WHERE id = p_comercial_id;

    RETURN QUERY SELECT TRUE, 'Contrasena actualizada correctamente'::TEXT;
END;
$$;

COMMENT ON FUNCTION cambiar_password_comercial IS
'Cambia la contrasena de un comercial verificando primero la actual. Usa SHA-256 hex igual que el resto de usuarios.';
