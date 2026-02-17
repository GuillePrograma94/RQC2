# Flujo del codigo de cliente al enviar pedido (paso a paso)

Desde el clic en "Enviar pedido" hasta el JSON que recibe el ERP. En cada paso: donde esta el codigo, tabla/columna si aplica, y contenido simulado.

---

## Paso 0: Usuario hace clic en "Enviar pedido"

**Origen del clic:** boton `#confirmarRecogerAlmacenBtn` (recoger en almacen) o `#confirmarEnviarEnRutaBtn` (enviar en ruta).

**Codigo (app.js):**

```javascript
// app.js ~1490 (recoger en almacen)
this.sendRemoteOrder(almacen, observaciones);

// app.js ~1549 (enviar en ruta)
this.sendRemoteOrder(this.currentUser.almacen_habitual, observaciones);
```

**Codigo de cliente en este paso:** Aun no se usa. Solo se llama `sendRemoteOrder(almacen, observaciones)`.

---

## Paso 1: sendRemoteOrder llama a crearPedidoRemoto con el user_id del titular

**Fichero:** `scan_client_mobile/js/app.js`

**Codigo:**

```javascript
// app.js 3527-3530
const result = await window.supabaseClient.crearPedidoRemoto(
    this.currentUser.user_id,   // <-- identificador del TITULAR (integer id de usuarios)
    almacen
);
```

**Tabla/columna:** No se lee aun el codigo de cliente. Se envia `usuarios.id` (como `currentUser.user_id`) para que la RPC cree el carrito asociado a ese usuario.

**Valor simulado:** `this.currentUser.user_id` = `42` (ejemplo; es el `usuarios.id` del titular, tanto si quien envia es titular como operario).

---

## Paso 2: supabase.js invoca la RPC crear_pedido_remoto

**Fichero:** `scan_client_mobile/js/supabase.js`

**Codigo:**

```javascript
// supabase.js 987-993
const { data, error } = await this.client.rpc(
    'crear_pedido_remoto',
    {
        p_usuario_id: usuarioId,      // 42
        p_almacen_destino: almacenDestino  // ej. 'GANDIA'
    }
);
```

**Tabla/columna:** Aun no. Solo se envia `p_usuario_id` (integer) a la RPC.

---

## Paso 3: RPC crear_pedido_remoto lee codigo_usuario del titular y lo guarda en el carrito

**Fichero:** `scan_client_mobile/migration_carrito_codigo_cliente_usuario.sql` (funcion en Supabase).

**Codigo SQL:**

```sql
-- 1) Obtener codigo_usuario del titular (tabla usuarios, columna codigo_usuario)
SELECT nombre, codigo_usuario INTO v_usuario_nombre, v_codigo_cliente_usuario
FROM usuarios WHERE id = p_usuario_id;

-- 2) Insertar fila en carritos_clientes incluyendo ese valor
INSERT INTO carritos_clientes (
    codigo_qr,
    estado,
    tipo_pedido,
    almacen_destino,
    estado_procesamiento,
    usuario_id,
    codigo_cliente_usuario,   -- <-- aqui se guarda
    fecha_creacion
) VALUES (
    v_codigo_qr,
    'enviado',
    'remoto',
    p_almacen_destino,
    'procesando',
    p_usuario_id,
    v_codigo_cliente_usuario,  -- valor de usuarios.codigo_usuario
    NOW()
)
RETURNING id INTO v_carrito_id;

-- 3) Devolverlo en el resultado
RETURN QUERY SELECT
    v_carrito_id,
    v_codigo_qr,
    v_codigo_cliente_usuario,  -- <-- devuelto a la app
    TRUE,
    'Pedido remoto creado exitosamente'::TEXT;
```

**Tabla y columna:**

| Paso en la RPC | Tabla             | Columna                | Accion        |
|----------------|-------------------|------------------------|---------------|
| SELECT         | `usuarios`        | `codigo_usuario`       | Lectura (WHERE id = p_usuario_id) |
| INSERT         | `carritos_clientes` | `codigo_cliente_usuario` | Escritura   |
| RETURN         | —                 | —                      | Se devuelve `v_codigo_cliente_usuario` |

**Valor simulado:** Si el titular tiene `usuarios.codigo_usuario = '79280'`, entonces `v_codigo_cliente_usuario = '79280'`, se guarda en `carritos_clientes.codigo_cliente_usuario` y se devuelve en el resultado de la RPC.

---

## Paso 4: supabase.js devuelve result con codigo_cliente_usuario

**Fichero:** `scan_client_mobile/js/supabase.js`

**Codigo:**

```javascript
// supabase.js 1000-1007
if (result.success) {
    return {
        success: true,
        carrito_id: result.carrito_id,
        codigo_qr: result.codigo_qr,
        codigo_cliente_usuario: result.codigo_cliente_usuario || null  // <--
    };
}
```

**Tabla/columna:** El valor viene del **resultado** de la RPC (que a su vez lo tomo de `usuarios.codigo_usuario` y lo guardo en `carritos_clientes.codigo_cliente_usuario`).

**Valor simulado:** `result.codigo_cliente_usuario` = `'79280'`.

---

## Paso 5: app.js construye el payload ERP usando result.codigo_cliente_usuario

**Fichero:** `scan_client_mobile/js/app.js`

**Codigo:**

```javascript
// app.js 3569-3570
const referencia = 'RQC/' + result.carrito_id + '-' + result.codigo_qr;
const erpPayload = this.buildErpOrderPayload(cart, almacen, referencia, observaciones, result.codigo_cliente_usuario);
```

**Tabla/columna:** El valor usado es `result.codigo_cliente_usuario` (el que devolvio la RPC, origen: `carritos_clientes.codigo_cliente_usuario` / `usuarios.codigo_usuario`).

**Dentro de buildErpOrderPayload (app.js 3452-3467):**

```javascript
// app.js 3463-3467
const codigoClienteErp = (codigoClienteUsuario != null && codigoClienteUsuario !== '') ? codigoClienteUsuario : null;

return {
    codigo_cliente: codigoClienteErp,  // <-- va al JSON
    serie: serie,
    centro_venta: centro_venta,
    referencia: ref,
    observaciones: observaciones != null ? String(observaciones) : '',
    lineas: lineas
};
```

**Valor simulado:** `codigo_cliente` en el objeto = `'79280'`.

---

## Paso 6: erp.js envia el JSON al ERP

**Fichero:** `scan_client_mobile/js/erp.js`

**Codigo:**

```javascript
// erp.js 45-52 (con proxy) o 60-66 (directo)
return await this._requestProxy(this.proxyPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)   // payload = erpPayload del paso 5
});
```

**Tabla/columna:** Ninguna; el body es el objeto construido en el paso 5.

---

## JSON simulado que recibe el ERP

**Contenido tipico del body del POST (ejemplo):**

```json
{
  "codigo_cliente": "79280",
  "serie": "BT7",
  "centro_venta": "1",
  "referencia": "RQC/12345-847291",
  "observaciones": "RECOGER EN ALMACEN GANDIA - Sin comentarios",
  "lineas": [
    { "codigo_articulo": "ART001", "unidades": 2 },
    { "codigo_articulo": "ART002", "unidades": 1 }
  ]
}
```

- **codigo_cliente:** valor que en todo el flujo viene de:
  1. `usuarios.codigo_usuario` (lectura en la RPC por `usuarios.id = p_usuario_id`),
  2. guardado en `carritos_clientes.codigo_cliente_usuario`,
  3. devuelto por la RPC como `codigo_cliente_usuario`,
  4. pasado a `buildErpOrderPayload(..., result.codigo_cliente_usuario)` y puesto en `payload.codigo_cliente`.

---

## Resumen en tabla

| Paso | Donde | Tabla / columna | Valor simulado |
|------|--------|------------------|----------------|
| 1 | app.js: argumento a crearPedidoRemoto | — (se envia `user_id`) | `42` |
| 2 | supabase.js: rpc('crear_pedido_remoto', { p_usuario_id }) | — | `42` |
| 3a | RPC: SELECT ... FROM usuarios | `usuarios.codigo_usuario` | `'79280'` |
| 3b | RPC: INSERT INTO carritos_clientes | `carritos_clientes.codigo_cliente_usuario` | `'79280'` |
| 3c | RPC: RETURN QUERY SELECT ... codigo_cliente_usuario | resultado de la RPC | `'79280'` |
| 4 | supabase.js: return { codigo_cliente_usuario } | — | `'79280'` |
| 5 | app.js: buildErpOrderPayload(..., result.codigo_cliente_usuario) | — | `payload.codigo_cliente = '79280'` |
| 6 | erp.js: body: JSON.stringify(payload) | — | JSON con `"codigo_cliente": "79280"` |

---

## Casos: titular vs operario

- **Titular:** `this.currentUser.user_id` es su propio `usuarios.id`. En la RPC, `p_usuario_id` es ese id; el SELECT devuelve su `usuarios.codigo_usuario`. Ese valor se guarda en `carritos_clientes.codigo_cliente_usuario` y es el que llega al JSON.
- **Operario:** `this.currentUser.user_id` es el **id del titular** (la app siempre usa el titular para pedidos). `p_usuario_id` es el id del titular; el SELECT devuelve el `usuarios.codigo_usuario` del titular. Ese mismo valor se guarda en el carrito y llega al JSON.

En ambos casos el codigo que ve el ERP es **siempre** `usuarios.codigo_usuario` del titular, guardado en el carrito al crearlo y enviado en `payload.codigo_cliente`.
