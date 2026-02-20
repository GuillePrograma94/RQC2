# Login de operarios

## Requisitos en base de datos

Para que el login de **operarios** (codigo `titular-operario`, ej. `84845-12`) funcione:

1. **Verificar credenciales:** La funcion `verificar_login_usuario` debe ser la version que incluye operarios.
   - **Archivo correcto:** `scan_client_mobile/migration_login_operarios.sql`
   - **Archivo que rompe operarios:** `user_management/fix_verificar_login_codigo_cliente.sql` (version legacy, solo titulares)

2. **Supabase Auth (signInWithPassword en la app):** Cada operario debe tener su propio usuario en Auth (email `84845-01@labels.auth`). La API de login crea/actualiza ese usuario y guarda el UUID en `usuarios_operarios.auth_user_id`.
   - **Migracion necesaria:** Ejecutar `scan_client_mobile/migration_auth_operarios.sql` (añade la columna `auth_user_id` a `usuarios_operarios`). Sin ella, el login del operario falla con "Invalid login credentials" al hacer signInWithPassword.

Si en la base de datos esta aplicada la version legacy, el login con codigo tipo `84845-12` falla con "credenciales incorrectas" porque esa version solo busca en `usuarios.codigo_usuario` (no existe un usuario con codigo `84845-12`; el operario esta en `usuarios_operarios`).

## Solucion si el login de operario deja de funcionar

1. Abrir el SQL Editor de Supabase.
2. Ejecutar **completo** el contenido de `scan_client_mobile/migration_login_operarios.sql`.
3. Ejecutar **completo** el contenido de `scan_client_mobile/migration_auth_operarios.sql` (columna `auth_user_id` en `usuarios_operarios` para que la API cree el usuario de Auth del operario).
4. Comprobar login con codigo titular (ej. `84845`) y con codigo operario (ej. `84845-12`). Si el error es "Invalid login credentials" en signInWithPassword, falta la migracion de Auth (punto 3) o redesplegar la API en Vercel con el login.js actualizado.

No ejecutar `user_management/fix_verificar_login_codigo_cliente.sql` si se usan operarios; ese script reemplaza la funcion por una version que no contempla operarios.

---

## Vista de operario en el menú

En el menú lateral (hamburguesa), cuando la sesión es de un **operario**:

- Se muestra el **nombre de la empresa** (titular) en grande.
- Debajo, en texto más pequeño, el **nombre del operario**.
- El bloque es solo informativo (vista), no lleva a Mi perfil; el operario no accede al menú de usuario de la empresa (perfil, contraseña, operarios). Sigue pudiendo usar "Mis Pedidos" y "Cerrar sesión".

Para ello la RPC `verificar_login_usuario` devuelve además `nombre_titular` (nombre del usuario titular / empresa), que la app guarda en sesión y usa en la vista del menú.

---

## Registro de sesiones (log de inicios de sesión)

Tras el login, la app llama a `crear_sesion_usuario` para registrar la sesión en la tabla `sesiones_usuario` (tracking / auditoría). La versión original de `crear_sesion_usuario` solo buscaba en `usuarios.codigo_usuario`; como los operarios entran con código compuesto (ej. `84845-12`), la creación de sesión fallaba y **los operarios no quedaban registrados** en el log.

- **Migración que lo corrige:** `scan_client_mobile/migration_sesiones_operarios.sql`
- Qué hace: añade la columna opcional `sesiones_usuario.codigo_login` y reemplaza `crear_sesion_usuario` para que acepte código titular o operario; si es operario (con guión), resuelve el `usuario_id` del titular y crea la sesión con ese id, guardando en `codigo_login` el código usado (ej. `84845` o `84845-12`) para distinguir en el log.

**Pasos para que el log de sesiones incluya a operarios:**

1. En Supabase, SQL Editor, ejecutar **completo** el contenido de `scan_client_mobile/migration_sesiones_operarios.sql`.
2. A partir de ahí, tanto titulares como operarios quedarán registrados en `sesiones_usuario`; en consultas de auditoría se puede usar `codigo_login` para ver si la sesión la inició un titular o un operario.
