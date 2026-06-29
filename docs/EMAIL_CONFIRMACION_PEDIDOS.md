# Email de confirmacion de pedido (scan_client_mobile)

Cuando un cliente (o un comercial/dependiente en su nombre) envia un **pedido remoto** desde la app:

- **Cliente:** email de confirmacion solo si el pedido llego al ERP con exito.
- **Comercial asignado:** copia (CC) del email al cliente.
- **ADMINISTRADOR:** email de alerta si el pedido **no** llego al ERP.

> Rol **ADMINISTRACION** (panel de solicitudes) **no** recibe estas alertas. Solo usuarios con `tipo = 'ADMINISTRADOR'`.

---

## Requisitos previos

### 1. Migraciones SQL

Ejecutar en Supabase SQL Editor (en este orden):

1. `scan_client_mobile/migration_usuarios_email_confirmacion_pedido.sql`
2. `scan_client_mobile/migration_email_alerta_admin_erp.sql`
3. `scan_client_mobile/migration_empresas_smtp_pedidos.sql`
4. `scan_client_mobile/migration_empresas_email_respuesta.sql`
5. **Si guarda desde Panel de Control (rol ADMINISTRADOR):** `scan_client_mobile/migration_empresas_por_almacen_admin_rls.sql`
6. **Encargados de comerciales (CCO en confirmacion):** `scan_client_mobile/migration_comerciales_encargados.sql`

Sin (3) y (4) el guardado SMTP falla. Sin (5) un **ADMINISTRADOR** no puede escribir en `empresas_por_almacen` (solo lectura); **ADMINISTRACION** si puede con las politicas de `migration_presupuestos.sql`.

---

## Si SMTP no se guarda en empresas_por_almacen

1. Al pulsar **Guardar**, si falla veras un toast con el motivo (RLS o columnas faltantes).
2. En Supabase Table Editor, fila del almacen: deben existir columnas `smtp_enabled`, `smtp_host`, `smtp_user`, etc.
3. Vuelva a guardar escribiendo la **contrasena SMTP** (no se muestra al reabrir el formulario).
4. Compruebe que el usuario tiene permiso de escritura (ADMINISTRACION o ADMINISTRADOR con migracion RLS aplicada).

### 2. Emails destinatarios

| Entidad | Campo | Donde configurarlo |
|---------|-------|-------------------|
| Cliente | `usuarios.email` | Panel de usuarios, Excel masivo |
| Comercial (CC visible) | `usuarios_comerciales.email` | Tab Comerciales del panel de usuarios |
| Encargado del comercial (BCC / CCO oculto) | email segun tipo | Panel de Control > Encargados de comerciales (rol ADMINISTRADOR) |
| **ADMINISTRADOR** (alerta ERP) | `usuarios.email` | Panel usuarios, tipo ADMINISTRADOR |

**Encargados:** usuario `COMERCIAL`, `DEPENDIENTE` o `ADMINISTRADOR` (no `ADMINISTRACION`). Varios encargados por comercial; un mismo usuario puede supervisar varios comerciales. El email del encargado comercial se toma de `usuarios_comerciales.email`; dependiente y administrador de `usuarios.email`.

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

**Que almacen se usa:** prioridad `carritos_clientes.almacen_destino` → observaciones del pedido (`RECOGER EN ALMACEN GANDIA`, etc.) → `usuarios.almacen_habitual`. Debe existir Datos de Empresa (SMTP) para ese codigo de almacen.

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
3. El servidor recalcula importes con la misma logica que la app (mejor precio: pacto > tarifa > oferta). Cada linea muestra PVP unitario, precio neto unitario e importe de linea (sin IVA); el total incluye IVA 21%.
4. **To:** cliente. **CC:** comercial asignado (visible para el cliente). **BCC (CCO):** encargados del comercial (ocultos para el cliente).

## Flujo alerta ADMINISTRADOR

1. Pedido en `pendiente_erp` o `error_erp`.
2. `POST /api/orders/send-erp-failure-alert`
3. Email a todos los usuarios **`tipo = ADMINISTRADOR'`** con email.

---

## Archivos

| Archivo | Rol |
|---------|-----|
| `lib/order-email.js` | SMTP (nodemailer) + Resend + plantillas HTML responsive (tarjetas por producto, legible en movil) |
| `lib/order-pricing-email.js` | Recalculo de precios efectivos (tarifa, pacto, ofertas) para importes del email |
| `api/orders/send-confirmation-email.js` | Confirmacion cliente |
| `api/orders/send-erp-failure-alert.js` | Alerta ADMINISTRADOR |
