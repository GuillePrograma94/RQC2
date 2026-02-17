# Login de operarios

## Requisito en base de datos

Para que el login de **operarios** (codigo `titular-operario`, ej. `84845-12`) funcione, la funcion `verificar_login_usuario` en Supabase **debe ser la version que incluye operarios**.

- **Archivo correcto:** `scan_client_mobile/migration_login_operarios.sql`
- **Archivo que rompe operarios:** `user_management/fix_verificar_login_codigo_cliente.sql` (version legacy, solo titulares)

Si en la base de datos esta aplicada la version legacy, el login con codigo tipo `84845-12` falla con "credenciales incorrectas" porque esa version solo busca en `usuarios.codigo_usuario` (no existe un usuario con codigo `84845-12`; el operario esta en `usuarios_operarios`).

## Solucion si el login de operario deja de funcionar

1. Abrir el SQL Editor de Supabase.
2. Ejecutar **completo** el contenido de `scan_client_mobile/migration_login_operarios.sql`.
3. Comprobar login con codigo titular (ej. `84845`) y con codigo operario (ej. `84845-12`).

No ejecutar `user_management/fix_verificar_login_codigo_cliente.sql` si se usan operarios; ese script reemplaza la funcion por una version que no contempla operarios.

---

## Vista de operario en el menú

En el menú lateral (hamburguesa), cuando la sesión es de un **operario**:

- Se muestra el **nombre de la empresa** (titular) en grande.
- Debajo, en texto más pequeño, el **nombre del operario**.
- El bloque es solo informativo (vista), no lleva a Mi perfil; el operario no accede al menú de usuario de la empresa (perfil, contraseña, operarios). Sigue pudiendo usar "Mis Pedidos" y "Cerrar sesión".

Para ello la RPC `verificar_login_usuario` devuelve además `nombre_titular` (nombre del usuario titular / empresa), que la app guarda en sesión y usa en la vista del menú.
