-- Migracion: Perfil de usuario, cambio de contrasena y operarios
-- Ejecutar en el SQL Editor de Supabase
-- Permite al titular cambiar su contrasena y gestionar operarios que pueden acceder a su cuenta

-- ============================================
-- 1. CAMBIO DE CONTRASENA
-- ============================================
CREATE OR REPLACE FUNCTION cambiar_password_usuario(
    p_user_id INTEGER,
    p_password_actual_hash TEXT,
    p_password_nueva_hash TEXT
)
RETURNS TABLE (success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_user_id IS NULL OR p_password_actual_hash IS NULL OR p_password_nueva_hash IS NULL OR trim(p_password_nueva_hash) = '' THEN
        RETURN QUERY SELECT FALSE, 'Datos incompletos'::TEXT;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM usuarios
        WHERE id = p_user_id AND activo = TRUE AND password_hash = p_password_actual_hash
    ) THEN
        RETURN QUERY SELECT FALSE, 'Contrasena actual incorrecta'::TEXT;
        RETURN;
    END IF;

    UPDATE usuarios
    SET password_hash = p_password_nueva_hash,
        fecha_actualizacion = NOW()
    WHERE id = p_user_id;

    RETURN QUERY SELECT TRUE, 'Contrasena actualizada'::TEXT;
END;
$$;

COMMENT ON FUNCTION cambiar_password_usuario IS 'Permite al usuario cambiar su contrasena verificando la actual (hash SHA-256)';

-- ============================================
-- 2. TABLA USUARIOS_OPERARIOS
-- ============================================
-- Operarios son usuarios secundarios que pueden acceder a la cuenta del titular (mismo codigo_cliente, pedidos, etc.)
CREATE TABLE IF NOT EXISTS usuarios_operarios (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo_operario TEXT NOT NULL,
    nombre_operario TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(usuario_id, codigo_operario)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_operarios_usuario ON usuarios_operarios(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_operarios_activo ON usuarios_operarios(activo);

COMMENT ON TABLE usuarios_operarios IS 'Operarios que pueden acceder a la cuenta del usuario titular';

-- RLS
ALTER TABLE usuarios_operarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura operarios propio usuario" ON usuarios_operarios;
CREATE POLICY "Permitir lectura operarios propio usuario"
    ON usuarios_operarios FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir insercion operarios propio usuario" ON usuarios_operarios;
CREATE POLICY "Permitir insercion operarios propio usuario"
    ON usuarios_operarios FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizacion operarios propio usuario" ON usuarios_operarios;
CREATE POLICY "Permitir actualizacion operarios propio usuario"
    ON usuarios_operarios FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir eliminacion operarios propio usuario" ON usuarios_operarios;
CREATE POLICY "Permitir eliminacion operarios propio usuario"
    ON usuarios_operarios FOR DELETE USING (true);

-- ============================================
-- 3. RPC LISTAR OPERARIOS
-- ============================================
CREATE OR REPLACE FUNCTION listar_operarios(p_usuario_id INTEGER)
RETURNS TABLE (
    id INTEGER,
    codigo_operario TEXT,
    nombre_operario TEXT,
    activo BOOLEAN,
    fecha_creacion TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT o.id, o.codigo_operario, o.nombre_operario, o.activo, o.fecha_creacion
    FROM usuarios_operarios o
    WHERE o.usuario_id = p_usuario_id
    ORDER BY o.fecha_creacion DESC;
$$;

-- ============================================
-- 4. RPC CREAR OPERARIO
-- ============================================
CREATE OR REPLACE FUNCTION crear_operario(
    p_usuario_id INTEGER,
    p_codigo_operario TEXT,
    p_nombre_operario TEXT,
    p_password_hash TEXT
)
RETURNS TABLE (success BOOLEAN, operario_id INTEGER, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id INTEGER;
BEGIN
    IF p_usuario_id IS NULL OR trim(coalesce(p_codigo_operario, '')) = '' OR trim(coalesce(p_nombre_operario, '')) = '' OR trim(coalesce(p_password_hash, '')) = '' THEN
        RETURN QUERY SELECT FALSE, NULL::INTEGER, 'Datos incompletos'::TEXT;
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM usuarios_operarios WHERE usuario_id = p_usuario_id AND codigo_operario = trim(p_codigo_operario)) THEN
        RETURN QUERY SELECT FALSE, NULL::INTEGER, 'Ya existe un operario con ese codigo'::TEXT;
        RETURN;
    END IF;

    INSERT INTO usuarios_operarios (usuario_id, codigo_operario, nombre_operario, password_hash)
    VALUES (p_usuario_id, trim(p_codigo_operario), trim(p_nombre_operario), p_password_hash)
    RETURNING usuarios_operarios.id INTO v_id;

    RETURN QUERY SELECT TRUE, v_id, 'Operario creado'::TEXT;
END;
$$;

-- ============================================
-- 5. RPC ELIMINAR OPERARIO
-- ============================================
CREATE OR REPLACE FUNCTION eliminar_operario(
    p_usuario_id INTEGER,
    p_operario_id INTEGER
)
RETURNS TABLE (success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_usuario_id IS NULL OR p_operario_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Datos incompletos'::TEXT;
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM usuarios_operarios WHERE id = p_operario_id AND usuario_id = p_usuario_id) THEN
        RETURN QUERY SELECT FALSE, 'Operario no encontrado'::TEXT;
        RETURN;
    END IF;

    DELETE FROM usuarios_operarios WHERE id = p_operario_id AND usuario_id = p_usuario_id;
    RETURN QUERY SELECT TRUE, 'Operario eliminado'::TEXT;
END;
$$;
