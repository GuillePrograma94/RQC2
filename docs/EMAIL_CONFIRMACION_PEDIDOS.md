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
3. `scan_client_mobile/migration_empresas_smtp_pedidos.sql`
4. `scan_client_mobile/migration_empresas_email_respuesta.sql`

### 2. Emails destinatarios

| Entidad | Campo | Donde configurarlo |
|---------|-------|-------------------|
| Cliente | `usuarios.email` | Panel de usuarios, Excel masivo |
| Comercial (CC) | `usuarios_comerciales.email` | Tab Comerciales |
| **ADMINISTRADOR** | `usuarios.email` | Panel usuarios, tipo ADMINISTRADOR |

---

## Envio de correos: SMTP por almacen (recomendado)

Cada fila de **Datos de Empresa** (ONTINYENT, GANDIA, ALZIRA, REQUENA) puede tener su propio SMTP.

**Donde configurarlo en la app:**

### Rol ADMINISTRADOR (app tienda, menu hamburguesa)

1. Abrir el **menu** (icono arriba a la izquierda).
2. Pulsar **Panel de Control** (solo visible si tu usuario tiene `tipo = ADMINISTRADOR`, no ADMINISTRACION).
3. Pulsar **Datos de Empresa y correo SMTP**.
4. En la lista de almacenes, pulsar **Editar** en ONTINYENT, GANDIA, ALZIRA o REQUENA.
5. Bajar en el formulario (o usar el enlace **Ir a configuracion SMTP**) hasta la seccion **Correo SMTP (pedidos)**.

### Rol ADMINISTRACION (app de solicitudes)

1. Barra inferior → **Empresas**.
2. Pulsar el almacen deseado.
3. Bajar hasta **Correo SMTP (pedidos)** o usar el enlace rapido al inicio del formulario.

> Si no ves **Panel de Control**, comprueba que entras con un usuario **ADMINISTRADOR**. El rol ADMINISTRACION usa otra app distinta (solicitudes de articulos).

**Campos:**

| Campo | Ejemplo Office 365 |
|-------|-------------------|
| Activar SMTP | Marcado |
| Servidor SMTP | `smtp.office365.com` |
| Puerto | `587` (STARTTLS) o `465` (SSL directo) |
| Usuario SMTP | Suele coincidir con el noreply (`noreply@...`) |
| Contrasena SMTP | Contrasena de aplicacion o cuenta |
| SSL directo | Solo si usas puerto 465 |
| **Email remitente (De:)** | `noreply@tuempresa.com` |
| **Email de respuesta (Reply-To)** | `pedidos@tuempresa.com` (buzon humano) |

La contrasena **no se muestra** al reabrir el formulario. Dejar vacia para mantener la guardada.

**Que almacen se usa:** el **almacen destino del pedido** (`carritos_clientes.almacen_destino`), no el almacen habitual del cliente. Debe existir una fila en Datos de Empresa para ese mismo codigo (ONTINYENT, GANDIA, etc.). El **Usuario SMTP** (`noreply@...`) sirve como remitente aunque no rellene Email remitente; al guardar, si el remitente esta vacio, se copia desde Usuario SMTP.

**ORDER_EMAIL_FROM en Vercel** solo hace falta como respaldo si no hay SMTP ni email en la empresa del almacen destino.

### Prioridad de envio

1. **SMTP activo** en `empresas_por_almacen` del almacen destino → envia por SMTP.
2. Si no → **Resend** (`RESEND_API_KEY` en Vercel).
3. Remitente visible: `Razon social <email remitente>` del almacen.

**Reply-To:** si rellenas **Email de respuesta** en Datos de Empresa, los clientes que pulsen Responder envian el correo a ese buzon (no al noreply). Prioridad: `email_respuesta` del almacen → `ORDER_EMAIL_REPLY_TO` en Vercel → email remitente.

Variables Vercel opcionales (fallback Resend):

| Variable | Uso |
|----------|-----|
| `RESEND_API_KEY` | Fallback si SMTP desactivado |
| `ORDER_EMAIL_FROM` | Remitente Resend si no hay email en empresa |
| `ORDER_EMAIL_REPLY_TO` | Reply-to global (opcional) |

Tras cambiar SMTP o variables: **redeploy** en Vercel (`npm install` incluye `nodemailer`).

---

## Flujo confirmacion cliente

1. Pedido remoto enviado **correctamente al ERP** (`estado_procesamiento = procesando`).
2. `POST /api/orders/send-confirmation-email`
3. **To:** cliente. **CC:** comercial asignado.

## Flujo alerta ADMINISTRADOR

1. Pedido en `pendiente_erp` o `error_erp`.
2. `POST /api/orders/send-erp-failure-alert`
3. Email a todos los usuarios **`tipo = ADMINISTRADOR'`** con email.

---

## Archivos

| Archivo | Rol |
|---------|-----|
| `lib/order-email.js` | SMTP (nodemailer) + Resend + plantillas HTML (texto final del correo cliente en `buildOrderConfirmationHtml`) |
| `api/orders/send-confirmation-email.js` | Confirmacion cliente |
| `api/orders/send-erp-failure-alert.js` | Alerta ADMINISTRADOR |
