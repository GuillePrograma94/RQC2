# Donde viene y donde se usa `grupo_cliente` en scan_client_mobile

## Origen en base de datos

- **Tabla:** `usuarios`
- **Columna:** `grupo_cliente` (INTEGER, nullable)
- **Migracion:** `setup_usuarios_codigo_cliente.sql` añade la columna como `codigo_cliente`; `migration_rename_codigo_cliente_a_grupo_cliente.sql` la renombra a `grupo_cliente`.

Segun el comentario en la migracion:

> Codigo numerico del grupo de ofertas del cliente. Coincide con `codigo_grupo` en `ofertas_grupos` para que el cliente vea las ofertas asignadas a ese grupo.

Es decir: **`grupo_cliente` es un codigo numerico (INTEGER) en la tabla `usuarios`**, distinto de:
- `usuarios.id` (PK)
- `usuarios.codigo_usuario` (TEXT, codigo con el que hace login, ej. "79280")

---

## Como llega a la app

1. **RPC** `verificar_login_usuario` (en `migration_login_operarios.sql`):
   - Devuelve `grupo_cliente` en el resultado.
   - Valor: `v_user.grupo_cliente` (siempre del registro **titular** en `usuarios`).
   - Titular: el propio usuario; operario: el titular asociado (`usuarios_operarios.usuario_id = usuarios.id`).

2. **supabase.js** – `loginUser()`:
   - Si el login tiene exito, devuelve `grupo_cliente: loginResult.grupo_cliente || null`.

3. **app.js** – tras login:
   - Se guarda en `this.currentUser.grupo_cliente` (y tambien en sesion/localStorage al llamar a `saveUserSession`).

---

## Donde se referencia en scan_client_mobile

| Archivo | Uso |
|---------|-----|
| **migration_login_operarios.sql** | La RPC devuelve `grupo_cliente` (viene de `usuarios.grupo_cliente`). |
| **js/supabase.js** | Incluye `grupo_cliente` en la respuesta de login; `getOfertasProducto(codigoArticulo, grupoCliente, ...)` usa ese valor (si no hay grupo_cliente no se buscan ofertas). |
| **js/app.js** | `currentUser.grupo_cliente` se usa en: (1) ofertas – `getOfertasProducto(..., grupoCliente, ...)` y filtros "solo articulos que he comprado"; (2) payload ERP – fallback cuando no hay `codigo_usuario_titular` en `buildErpOrderPayload` y `buildErpPayloadFromOfflineItem`; (3) `user_snapshot` al guardar pedidos offline. |
| **migration_perfil_operarios.sql** | Comentario: operarios comparten "mismo grupo_cliente" que el titular. |

El payload al ERP sigue enviando la clave `codigo_cliente` (contrato de la API); el valor puede venir de `codigo_usuario_titular` o de `grupo_cliente` como respaldo.

---

## Resumen

- **Origen:** columna `usuarios.grupo_cliente` (INTEGER), rellenada al dar de alta/editar usuarios.
- **Entrada en la app:** RPC de login → `loginResult.grupo_cliente` → `currentUser.grupo_cliente`.
- **Uso principal:** ofertas (match con grupos) y, como respaldo, codigo en el payload al ERP cuando no existe `codigo_usuario_titular`.
