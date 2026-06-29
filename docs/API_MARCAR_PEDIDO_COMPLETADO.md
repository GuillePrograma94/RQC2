# API: marcar pedido completado (programa externo)

Permite a un sistema externo marcar un pedido de venta como **completado** usando los **6 digitos** de `carritos_clientes.codigo_qr`.

Misma transicion que **checkin_pc** y **checkout_pc** al entregar/preparar:

- `estado = completado`
- `estado_procesamiento = completado`

El cliente recibe la notificacion push en la app si tiene permisos (Realtime sobre `carritos_clientes`).

---

## Endpoint

| Metodo | URL |
|--------|-----|
| POST | `https://<tu-dominio-vercel>/api/orders/complete` |

En desarrollo local (si aplica): `http://localhost:3000/api/orders/complete`

---

## Autenticacion

Variable de entorno en Vercel:

| Variable | Obligatoria | Descripcion |
|----------|-------------|-------------|
| `ORDER_COMPLETE_API_KEY` | Si | Clave secreta para programas externos |
| `SUPABASE_URL` | Si | Ya usada por otras APIs |
| `SUPABASE_SERVICE_ROLE_KEY` | Si | Ya usada por otras APIs |

Formas de enviar la clave (elige una):

1. Cabecera recomendada: `Authorization: Bearer TU_CLAVE`
2. Cabecera: `X-Api-Key: TU_CLAVE`
3. Body JSON: `"api_key": "TU_CLAVE"` (solo para scripts simples)

Sin clave valida: respuesta `401`.

---

## Cuerpo de la peticion

```json
{
  "codigo_qr": "995618"
}
```

`codigo_qr` debe ser **exactamente 6 digitos** (se ignoran espacios; si envias mas digitos no validos, responde 400).

### Unicidad de codigo_qr

En Supabase, `carritos_clientes.codigo_qr` identifica **un solo pedido activo** a la vez:

- El esquema original define `codigo_qr` con restriccion **UNIQUE** (`setup_scan_as_you_shop.sql`).
- Al crear pedidos (`crear_pedido_remoto`, etc.) solo se reutiliza un codigo si el carrito anterior ya esta **completado** o **cancelado** (`migration_codigo_qr_solo_activos.sql`).
- Si esta aplicada `migration_codigo_qr_null_al_finalizar.sql`, al completar o cancelar el trigger pone `codigo_qr = NULL` y el codigo queda libre para un pedido nuevo.

Por eso la API **solo necesita** `codigo_qr`: no hace falta `carrito_id` para desambiguar.

**Reintento idempotente:** si el pedido ya estaba completado y la fila **sigue guardando** ese `codigo_qr`, la API responde `200` con `already_completed: true`. Si tienes el trigger que anula `codigo_qr` al finalizar, tras el primer completado el codigo pasa a `NULL` y un segundo POST con el mismo QR devolvera `404` (el codigo ya no apunta a ese pedido).

---

## Respuestas

### 200 - Completado ahora

```json
{
  "success": true,
  "completed": true,
  "already_completed": false,
  "codigo_qr": "995618",
  "carrito_id": 312,
  "estado": "completado",
  "estado_procesamiento": "completado",
  "tipo_pedido": "remoto",
  "almacen_destino": "GANDIA",
  "pedido_erp": "12345"
}
```

### 200 - Ya estaba completado (idempotente)

```json
{
  "success": true,
  "completed": false,
  "already_completed": true,
  "codigo_qr": "995618",
  "carrito_id": 312,
  "estado": "completado",
  "estado_procesamiento": "completado",
  "tipo_pedido": "remoto",
  "almacen_destino": "GANDIA",
  "pedido_erp": "12345"
}
```

### 404 - No encontrado o estado no completable

El pedido no existe con ese QR, esta cancelado o no esta en `pendiente_erp` / `procesando`.

### 400 - QR invalido

### 401 - API key incorrecta

---

## Estados que permite completar

Solo pedidos con:

- `estado_procesamiento` en `pendiente_erp` o `procesando`
- `estado` distinto de `cancelado`

No completa prepedidos (`activo` + `pendiente`) ni pedidos ya `completado` / `cancelado` (salvo respuesta idempotente si ya estaba completado).

Detalle de estados: [docs/ESTADOS_PEDIDOS.md](../../docs/ESTADOS_PEDIDOS.md)

---

## Ejemplo curl

```bash
curl -X POST "https://TU_DOMINIO.vercel.app/api/orders/complete" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_ORDER_COMPLETE_API_KEY" \
  -d "{\"codigo_qr\": \"995618\"}"
```

## Ejemplo Python

```python
import requests

url = "https://TU_DOMINIO.vercel.app/api/orders/complete"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer TU_ORDER_COMPLETE_API_KEY",
}
payload = {"codigo_qr": "995618"}

response = requests.post(url, json=payload, headers=headers, timeout=30)
print(response.status_code, response.json())
```

---

## Archivos

| Archivo | Rol |
|---------|-----|
| `api/orders/complete.js` | Endpoint Vercel |
| `lib/order-complete-api.js` | Validacion y actualizacion Supabase |

Tras anadir `ORDER_COMPLETE_API_KEY` en Vercel: **redeploy** del proyecto `scan_client_mobile`.
