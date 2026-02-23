# Pedidos Offline y Cola de Reintentos ERP

Documentación del mecanismo de pedidos offline y la cola de reintentos al ERP (`erp-retry-queue.js` + `offline-order-queue.js`).

---

## 1. Escenario: pedido con Supabase inalcanzable (totalmente offline)

1. El usuario pulsa "Enviar pedido" y `crearPedidoRemoto` falla por error de red.
2. `app.js → sendRemoteOrder` detecta el error de conexión (`isConnectionError`) y llama a `offlineOrderQueue.enqueue(item)`.
3. El item se guarda en IndexedDB (`ScanAsYouShop_OfflineOrders`).
4. Cuando vuelve la conexión, `offlineOrderQueue.processAll()` se ejecuta automáticamente.

**Flujo de `processAll()`:**

```
offlineOrderQueue.processAll()
  ├── remove(item.id) desde IndexedDB   ← PRIMERO, antes de llamar al servidor
  ├── supabaseClient.crearPedidoRemoto() → crea 1 pedido en Supabase
  ├── supabaseClient.addProductToRemoteOrder() × N líneas
  └── erpClient.createRemoteOrder(erpPayload)
        ├── OK: updatePedidoErp + registrarHistorialDesdeCarrito
        └── Error red/timeout: erpRetryQueue.enqueue() → flujo B
```

**Deduplicación en `enqueue()`:** Si ya existe un item del mismo `usuario_id` + `almacen` creado hace menos de 90 segundos, no se añade otro (protección contra doble clic).

---

## 2. Escenario: Supabase OK pero ERP falla (cola de reintentos)

1. Se crea el pedido en Supabase correctamente.
2. La llamada al ERP falla por red o timeout.
3. El pedido queda en Supabase con `estado_procesamiento = 'pendiente_erp'`.
4. Se añade a `erpRetryQueue` (IndexedDB `ScanAsYouShop_ErpQueue`) con `carrito_id` como clave primaria.
5. `erp-retry-queue.js` reintenta enviarlo progresivamente:
   - Fase 0: 10 intentos cada 5 minutos
   - Fase 1: 10 intentos cada 10 minutos
   - Fase 2: cada 30 minutos indefinidamente

**Flujo de `runRetries()`:**

```
runRetries(items)
  ├── remove(item.carrito_id) desde IndexedDB  ← PRIMERO (evita duplicados)
  ├── erpClient.createRemoteOrder(item.payload)
  │     ├── OK: updatePedidoErp + marcarPedidoRemotoEnviado + registrarHistorial
  │     ├── Error 400/validacion: updateCarritoEstadoProcesamiento('error_erp') → NO reintento
  │     └── Error red/timeout: re-encolar con retryCount++, nextRetryAt += intervalo
  └── scheduleNextRun()
```

---

## 3. Triggers que activan el procesamiento

Múltiples eventos pueden disparar `processAll()` y `runRetries()` simultáneamente cuando el dispositivo recupera la conexión:

| Trigger | processAll | runRetries |
|---------|-----------|-----------|
| Evento `online` del navegador | Sí (offline-order-queue.js) | Sí vía `onConnectionRestored` (erp-retry-queue.js) |
| `visibilitychange` (pantalla activa) | Sí (offline-order-queue.js) | Sí (offline-order-queue.js) |
| Service Worker `PROCESS_OFFLINE_ORDERS` | Sí (app.js) | Sí (app.js) |
| Timer interno (`scheduleNextRun`) | No | Sí |
| App init (arranque con sesion guardada) | Sí (app.js) | No directo |

---

## 4. Proteccion contra ejecuciones concurrentes

### offlineOrderQueue.processAll()
Protegido por el flag `_processing` en memoria. Si ya está en ejecución, cualquier llamada adicional retorna inmediatamente.

Además, el item se **elimina de IndexedDB ANTES** de llamar a Supabase. Si la eliminación falla, se salta ese item. Si Supabase falla después, se re-encola (con deduplicación de 90 s).

### erpRetryQueue.runRetries()
Protegido por el flag `_running` en memoria. Si ya está en ejecución, cualquier llamada adicional retorna inmediatamente.

El item se **elimina de IndexedDB ANTES** de llamar al ERP. Si el ERP falla con error de red/timeout, se re-encola con el contador de reintentos incrementado.

---

## 5. Riesgo residual: timeout de red en ERP

Si el ERP procesa el pedido pero la respuesta llega después del timeout configurado (`ERP_REQUEST_TIMEOUT_MS`, por defecto 15 000 ms), el cliente lanza `AbortError` y el item se re-encola. En el siguiente reintento se enviará de nuevo al ERP, que podría crear un pedido duplicado si no tiene deduplicacion por `referencia`.

**Mitigacion a nivel de ERP:** El campo `referencia` del payload tiene el formato `RQC/{carritoId}-{codigoQr}`, donde `carritoId` es un UUID único por pedido de Supabase. Si el ERP implementa deduplicación sobre el campo `referencia`, este escenario queda completamente cubierto. Se recomienda solicitarlo al proveedor del ERP.

---

## 6. Problema historico: pedidos duplicados en ERP (corregido)

**Síntoma:** Un pedido offline generaba 1 entrada en Supabase pero 5 pedidos en ERP.

**Causa raiz:** `runRetries()` no tenía mutex. Cuando el dispositivo volvía a estar online, hasta 4-5 triggers disparaban `runRetries()` simultáneamente. Todos leían el mismo item de IndexedDB (aún no eliminado) y todos enviaban el mismo payload al ERP. Resultado: N llamadas ERP concurrentes para el mismo pedido.

**Solucion aplicada (erp-retry-queue.js):**
1. Flag `_running` como mutex: solo una ejecución de `runRetries()` a la vez.
2. El item se elimina de IndexedDB **antes** de llamar al ERP (igual que `offlineOrderQueue.processAll()`).
3. Si el ERP falla con error de red, el item se vuelve a insertar en IndexedDB con el contador de reintentos actualizado.
