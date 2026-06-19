# Email de confirmacion de pedido (scan_client_mobile)

Cuando un cliente (o un comercial/dependiente en su nombre) envia un **pedido remoto** desde la app:

- **Cliente:** email de confirmacion solo si el pedido llego al ERP con exito.
- **Comercial asignado:** copia (CC) del email al cliente.
- **ADMINISTRADOR:** email de alerta si el pedido **no** llego al ERP.

> Rol **ADMINISTRACION** (panel de solicitudes) **no** recibe estas alertas. Solo usuarios con `tipo = 'ADMINISTRADOR'`.

---

## Requisitos previos

### 1. Migraciones SQL

Ejecutar en Supabase SQL Editor:

1. `scan_client_mobile/migration_usuarios_email_confirmacion_pedido.sql`
2. `scan_client_mobile/migration_email_alerta_admin_erp.sql`

### 2. Emails en base de datos

| Entidad | Campo | Donde configurarlo |
|---------|-------|-------------------|
| Cliente | `usuarios.email` | Panel de usuarios, Excel masivo |
| Comercial (CC) | `usuarios_comerciales.email` | Tab Comerciales del panel |
| **ADMINISTRADOR** (alerta ERP) | `usuarios.email` | Panel de usuarios, tipo ADMINISTRADOR |
| Remitente | `empresas_por_almacen.email` o `ORDER_EMAIL_FROM` | Panel admin app / Vercel |

### 3. Variables en Vercel

| Variable | Uso |
|----------|-----|
| `RESEND_API_KEY` | Envio de correos |
| `ORDER_EMAIL_FROM` | Remitente (recomendado) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | APIs serverless |

---

## Flujo confirmacion cliente

1. Pedido remoto enviado **correctamente al ERP** (`estado_procesamiento = procesando`).
2. `POST /api/orders/send-confirmation-email` con `{ carrito_id }`.
3. La API comprueba ERP OK; si no, no envia (`reason: erp_not_success`).
4. **To:** cliente. **CC:** comercial asignado.

## Flujo alerta ADMINISTRADOR

1. Pedido queda en `pendiente_erp` o `error_erp`.
2. `POST /api/orders/send-erp-failure-alert` con `{ carrito_id, motivo }`.
3. La API busca usuarios con **`tipo = 'ADMINISTRADOR'`** activos y email valido.
4. Un solo email a todos los administradores (no reenvia si ya se marco `email_alerta_admin_erp_enviado_at`).

Los administradores tambien ven los pedidos en **Panel de control > Pedidos pendientes de ERP** dentro de la app.

---

## Archivos

| Archivo | Rol |
|---------|-----|
| `api/orders/send-confirmation-email.js` | Confirmacion cliente (solo ERP OK) |
| `api/orders/send-erp-failure-alert.js` | Alerta ADMINISTRADOR |
| `api/orders/order-email.js` | Plantillas HTML |
| `js/app.js` | `notifyOrderConfirmationEmail` / `notifyErpFailureAdminAlert` |

---

## Panel de usuarios

Al crear/editar usuarios puedes elegir tipo **ADMINISTRADOR** y asignarle email para recibir alertas ERP.

El rol **ADMINISTRACION** es independiente (gestion de solicitudes de articulos); no interviene en estos correos.
