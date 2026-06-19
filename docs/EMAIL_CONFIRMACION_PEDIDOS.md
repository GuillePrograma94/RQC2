# Email de confirmacion de pedido (scan_client_mobile)

Cuando un cliente (o un comercial/dependiente en su nombre) envia un **pedido remoto** desde la app, se puede enviar automaticamente un correo de confirmacion al cliente. El **comercial asignado** recibe copia (CC) para verificar el contenido del pedido.

---

## Requisitos previos

### 1. Migracion SQL

Ejecutar en Supabase SQL Editor:

`scan_client_mobile/migration_usuarios_email_confirmacion_pedido.sql`

Anade:

- `usuarios.email` — email del cliente
- `carritos_clientes.email_confirmacion_enviado_at` — evita reenvios duplicados

### 2. Emails en base de datos

| Entidad | Campo | Donde configurarlo |
|---------|-------|-------------------|
| Cliente | `usuarios.email` | Panel de usuarios, Excel masivo o Supabase |
| Comercial (CC) | `usuarios_comerciales.email` | Tab Comerciales del panel (ya existia) |
| Remitente / reply | `empresas_por_almacen.email` | Panel administracion app (Empresa por almacen) |

Si el cliente no tiene email, **no se envia correo** (el pedido sigue funcionando con normalidad).

### 3. Variables en Vercel

| Variable | Obligatoria | Descripcion |
|----------|-------------|-------------|
| `RESEND_API_KEY` | Si | API key de [Resend](https://resend.com) |
| `SUPABASE_URL` | Si | Ya usada por otras APIs |
| `SUPABASE_SERVICE_ROLE_KEY` | Si | Ya usada por login/ERP |
| `ORDER_EMAIL_FROM` | Recomendada | Ej: `Pedidos BATMAR <pedidos@tudominio.com>` |
| `ORDER_EMAIL_REPLY_TO` | Opcional | Email de respuesta (si no, usa `empresas_por_almacen.email`) |

Si no se define `ORDER_EMAIL_FROM`, se usa `razon_social + email` de `empresas_por_almacen` del almacen destino del pedido.

El dominio del remitente debe estar verificado en Resend.

---

## Flujo

1. Pedido remoto enviado correctamente al ERP (`sendRemoteOrder`, aceptar prepedido, cola offline o reintento ERP).
2. La app llama en segundo plano a `POST /api/orders/send-confirmation-email` con `{ carrito_id }`.
3. La API serverless (service role):
   - Lee carrito, lineas, cliente y comercial asignado
   - Comprueba que no se haya enviado antes (`email_confirmacion_enviado_at`)
   - Envia HTML con resumen del pedido (mismos datos que la tarjeta de pedido en la app)
   - **To:** email del cliente
   - **CC:** email del comercial (si existe y es distinto del cliente)
4. Marca `email_confirmacion_enviado_at` en el carrito.

El envio **no bloquea** la UI ni impide completar el pedido si falla.

---

## Contenido del email

- Cliente, almacen destino, fecha, codigo QR, pedido ERP (si ya existe)
- Observaciones y operario (si aplica)
- Tabla de productos (codigo, descripcion, unidades, importe)
- Base imponible y total con IVA 21%

---

## Archivos

| Archivo | Rol |
|---------|-----|
| `api/orders/send-confirmation-email.js` | Endpoint Vercel |
| `api/orders/order-email.js` | Plantilla HTML y envio Resend |
| `js/supabase.js` | `sendOrderConfirmationEmail(carritoId)` |
| `js/app.js` | `notifyOrderConfirmationEmail` tras pedido OK |
| `js/offline-order-queue.js` | Email tras procesar cola offline |
| `js/erp-retry-queue.js` | Email tras reintento ERP exitoso |

---

## Panel de usuarios

En `user_management/panel_usuarios.html` y `panel_usuarios_directo.html` hay campo **Email** al crear/editar clientes.

Scripts masivos (`Generar_Clientes_Masivo.py`, `Actualizar_Clientes_Masivo.py`) aceptan columna opcional `email` en Excel.

---

## Comercial que pasa el pedido

Cuando un comercial representa a un cliente y envia el pedido:

- El email va al **cliente representado** (`usuarios.email` del titular del carrito)
- El **comercial asignado** a ese cliente recibe CC (`usuarios_comerciales.email` via `usuarios.comercial_asignado`)
- En observaciones del pedido ya se anade "Pedido enviado por: [nombre comercial]" — el email refleja las mismas lineas del carrito
