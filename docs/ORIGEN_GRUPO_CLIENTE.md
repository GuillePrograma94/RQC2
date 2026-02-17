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
| **js/app.js** | `currentUser.grupo_cliente` se usa en ofertas y en `user_snapshot`. Para el ERP solo se usa `codigo_usuario_titular` (sin fallbacks). |
| **migration_perfil_operarios.sql** | Comentario: operarios comparten "mismo grupo_cliente" que el titular. |

---

## Codigo de cliente en el JSON al ERP

El payload al ERP lleva la clave `codigo_cliente` (contrato de la API). El valor viene **solo** de `usuarios.codigo_usuario` del titular, que la app recibe en el login como `codigo_usuario_titular`. No se usan fallbacks (grupo_cliente no es codigo de cliente; lo que el usuario escribio al login tampoco se usa como respaldo).

| Caso | Quien hace login | Valor enviado en `codigo_cliente` |
|------|------------------|-----------------------------------|
| **1 – Cliente (titular)** | El propio cliente (codigo sin guion) | `usuarios.codigo_usuario` de ese usuario |
| **2 – Operario** | Un operario (codigo con guion, ej. 79280-23) | `usuarios.codigo_usuario` del **titular** (no del operario) |

En ambos casos el origen en BD es la misma columna: **tabla `usuarios`, columna `codigo_usuario`** (la fila es siempre la del titular).

---

## Resumen

- **Origen:** columna `usuarios.grupo_cliente` (INTEGER), rellenada al dar de alta/editar usuarios.
- **Entrada en la app:** RPC de login → `loginResult.grupo_cliente` → `currentUser.grupo_cliente`.
- **Uso:** ofertas (match con grupos). No se usa para el codigo de cliente del ERP; para el ERP solo se usa `codigo_usuario_titular` = `usuarios.codigo_usuario` del titular.
