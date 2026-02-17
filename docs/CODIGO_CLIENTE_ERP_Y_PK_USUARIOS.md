# Codigo de cliente al ERP y posible PK de usuarios

## Codigo de cliente en el JSON al ERP

- **Origen:** al crear el pedido (RPC `crear_pedido_remoto`) se guarda en **carritos_clientes.codigo_cliente_usuario** el valor de **usuarios.codigo_usuario** del titular (p_usuario_id).
- **Uso:** al montar el JSON para el ERP se usa **result.codigo_cliente_usuario** (devuelto por la RPC); la app ya no deriva el codigo desde currentUser. Flujo: crearPedidoRemoto -> RPC guarda y devuelve codigo_cliente_usuario -> buildErpOrderPayload(..., result.codigo_cliente_usuario). Titular: p_usuario_id suyo; operario: p_usuario_id del titular; en ambos se guarda usuarios.codigo_usuario en el carrito. “lo que escribio el usuario” 
**Dos casos:** 1) Titular: p_usuario_id es el suyo; en el carrito se guarda su codigo_usuario. 2) Operario: p_usuario_id es el del titular; en el carrito se guarda el codigo_usuario del titular.

---

## Usar `codigo_usuario` como clave de la tabla usuarios

Hoy:
- `usuarios.id` (INTEGER, PK) es la clave interna.
- `usuarios.codigo_usuario` (TEXT, UNIQUE) es el codigo con el que se hace login y el que se envia al ERP.

Si se quiere que “desaparezca” `id` y que la clave sea `codigo_usuario`:

### Ventajas
- Una sola nocion de “identificador de usuario”: el codigo con el que entra y el que va al ERP.
- Se evita la confusion entre “id” y “codigo de cliente”.

### Alcance del cambio

**Base de datos:** todas las tablas que referencian a `usuarios` usan hoy `usuario_id INTEGER REFERENCES usuarios(id)`:

| Tabla | Columna actual | Cambio |
|-------|----------------|--------|
| `sesiones_usuario` | `usuario_id` INTEGER → usuarios(id) | Pasar a `codigo_usuario` TEXT → usuarios(codigo_usuario) |
| `usuarios_operarios` | `usuario_id` INTEGER → usuarios(id) | Pasar a `codigo_usuario_titular` TEXT → usuarios(codigo_usuario) |
| `carritos_clientes` | `usuario_id` INTEGER (nullable) | Pasar a `codigo_usuario` TEXT (nullable) → usuarios(codigo_usuario) |
| `historial_compras_usuario` | `usuario_id` INTEGER → usuarios(id) | Pasar a `codigo_usuario` TEXT → usuarios(codigo_usuario) |

Ademas:
- Eliminar columna `usuarios.id` y definir PK en `usuarios.codigo_usuario`.
- Actualizar todas las RPCs que reciben `p_usuario_id INTEGER` para que reciban `p_codigo_usuario TEXT` y usen ese valor en inserciones/actualizaciones y en FKs.
- Migrar datos existentes: para cada fila con `usuario_id = X`, asignar el `codigo_usuario` del usuario con `id = X` antes de cambiar FKs y tipos.

**App (scan_client_mobile y demas):**
- Donde ahora se usa `currentUser.user_id` (integer) para llamadas a Supabase (crear pedido, operarios, historial, sesiones, etc.), pasar `currentUser.codigo_usuario_titular` (string).
- RPCs como `crear_pedido_remoto`, `listar_operarios`, `cambiar_password_usuario`, `get_comercial_por_usuario`, etc., pasarían a recibir `p_codigo_usuario` en lugar de `p_usuario_id`.
- Cache de pedidos/historial, filtros por usuario, etc., tendrían que keyar por `codigo_usuario` en lugar de por `user_id`.

**Resumen:** es un cambio grande pero coherente. Requiere:
1. Migracion SQL que redefina PK de `usuarios`, cambie FKs y tipos, migre datos y actualice RPCs.
2. Cambio en toda la app para usar `codigo_usuario_titular` como identificador de usuario en lugar de `user_id`.

Si quieres seguir con este diseño, el siguiente paso seria escribir la migracion SQL concreta y el listado de cambios en la app (archivos y llamadas a modificar).
