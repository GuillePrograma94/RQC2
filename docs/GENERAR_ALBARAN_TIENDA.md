# Generar Albaran y Generar Pedido (staff tienda)

Flujo para **dependiente** y **administrador** en el carrito de `scan_client_mobile`, ejecutado preferentemente desde **TiendaPC.exe**.

## Roles

| Rol | Generar Pedido (REMOTO) | Generar Albaran (PRESENCIAL) |
|-----|-------------------------|------------------------------|
| Dependiente | Si (Imprimir / sin imprimir) | Si |
| Administrador | Si (Imprimir / sin imprimir) | Si |
| Comercial | Enviar Pedido normal | No |
| Cliente / operario | Enviar Pedido normal | No |

## Botones en el carrito

- **Generar Pedido** (antes "Enviar Pedido"): abre modal con *Imprimir Pedido* y *Generar sin imprimir* (tipo ERP `REMOTO`).
- **Generar Albaran**: abre modal con *Imprimir Albaran* (2 copias sin firma) y *Firmar Albaran* (canvas + 1 copia firmada).

Ambos requieren **cliente representado** (selector de clientes).

## Almacen destino staff

- **Dependiente:** `almacen_tienda` del usuario.
- **Administrador:** `almacen_habitual` del cliente representado (o del admin si no representa).

## TiendaPC.exe

El albaran presencial **solo** funciona con TiendaPC (pywebview + `window.pywebview.api`):

- `check_albaran_pdf_ready`
- `apply_albaran_signature`
- `print_albaran_default(albaran, copies)` — impresora predeterminada Windows
- `send_modula_pedido(payload)` — envio a Modula (SQL Server IMPEXP) tras crear albaran

Configuracion: `tienda_config.json` junto al exe (`app_url`, `albaran_pdf_base_path`, `albaran_firma`, `signature_tablet_mode`, `modula`).

### Envio a Modula

Antes de generar el albaran (Imprimir / Firmar), si hay articulos del carrito con stock en la ubicacion Modula del almacen del staff, se muestra el dialogo: **¿Quieres enviar pedidos a modula?**

| Almacen staff | Ubicacion detectada | SQL Server |
|---------------|---------------------|------------|
| ONTINYENT | MODULA7 | `192.168.11.20\SQLEXPRESS` / IMPEXP |
| GANDIA | MODULA1 | `192.168.10.58\SQLEXPRESS` / IMPEXP |

La deteccion consulta Supabase (`stock_almacen_articulo_ubicacion`) filtrando por `codigo_almacen` del dependiente/admin. Un operador de ONTINYENT no ve stock MODULA1 de GANDIA.

Si el usuario acepta, tras crear el albaran en ERP TiendaPC inserta en tablas `idxlista` y `lineas` del Modula correspondiente (via `pyodbc`). Si falla el envio a Modula, se muestra aviso y **se continua** con impresion/firma del albaran.

Mapeo SQL (albaran `2026-BT7-006519`):

| Tabla | Campo | Valor |
|-------|-------|-------|
| idxlista y lineas | nombre | **El mismo** en ambas: `2026PVBT7006519` (ejercicio + PV + serie + numero) |
| idxlista | tipo | `P` |
| lineas | articulo | SKU / codigo del producto |
| lineas | cantidad | unidades pedidas en el carrito |
| lineas | numlin | numero de linea en el carrito (1, 2, 3...) |

TiendaPC detecta automaticamente los nombres de columna reales en `lineas` (`codigo_articulo` vs `articulo`, etc.) y verifica con `SELECT COUNT` tras el commit que las filas existen.

Bloque `modula` en `tienda_config.json`:

```json
"modula": {
  "ONTINYENT": {
    "ubicacion": "MODULA7",
    "connection_string": "DRIVER={SQL Server};SERVER=192.168.11.20\\SQLEXPRESS;DATABASE=IMPEXP;uid=Host;pwd=Host"
  },
  "GANDIA": {
    "ubicacion": "MODULA1",
    "connection_string": "DRIVER={SQL Server};SERVER=192.168.10.58\\SQLEXPRESS;DATABASE=IMPEXP;uid=host;pwd=host"
  }
}
```

### Firma con tableta XPPEN

Con `signature_tablet_mode: true` (por defecto), el modal de firma ocupa **toda la pantalla** y el canvas llena el area disponible. Asi el lapiz de la tableta grafica mapea 1:1 con el recuadro de firma (no hay que recorrer toda la pantalla con el estilete).

Para desactivar el modo pantalla completa (p. ej. solo raton): `"signature_tablet_mode": false`.

Al **Firmar Albaran**, el flujo es en **dos pasos**:

1. Modal **Datos de la firma** (nombre y obra) — obligatorio antes del canvas.
2. Modal a pantalla completa con el canvas (tableta XPPEN o raton).

| Campo | Obligatorio |
|-------|-------------|
| Nombre de persona que firma | Si |
| Obra | No |

Tras confirmar la firma, esos datos se **anaden a las observaciones** ya guardadas en `carritos_clientes.observaciones` (p. ej. `ALBARAN PRESENCIAL TIENDA`, `Generado por: ...`), con el formato:

```
Persona que firma: [nombre]
Obra: [obra]
```

La linea `Obra:` solo aparece si el usuario la rellena.

### Rendimiento al guardar firma

El PDF del albaran esta en una ruta UNC de red. TiendaPC copia el PDF a disco local, aplica la firma y vuelve a subirlo (mucho mas rapido que editar directamente en red).

### Panel de diagnostico en pantalla

En TiendaPC.exe aparece un boton flotante **Log** (abajo a la derecha) y en el menu lateral **Diagnostico TiendaPC**. Muestra en tiempo real:

- Pasos del flujo web (crear albaran, esperar PDF, firma, impresion)
- Logs del backend Python (copia UNC, guardado firma, impresora)
- Errores en rojo; al fallar firma o impresion el panel se abre solo

Botones **Copiar log** (portapapeles para soporte) y **Limpiar**.

Config: `"show_tienda_log_panel": true` en `tienda_config.json` (defecto activo).

Logs adicionales en la consola CMD de TiendaPC al ejecutar el `.bat`.

Al cerrar TiendaPC se elimina la sesion de acceso (PC compartido); el catalogo en IndexedDB se conserva.

## Supabase

Migraciones (aplicar en SQL Editor):

1. `migration_crear_pedido_presencial_tienda.sql` — RPC `crear_pedido_presencial_tienda`
2. `migration_carrito_albaran_erp.sql` — columna `carritos_clientes.albaran_erp`

## ERP

Payload via proxy existente `/api/erp/pedidos`:

- REMOTO: `tipo: 'REMOTO'` (pedido staff remoto)
- PRESENCIAL: `tipo: 'PRESENCIAL'` (albaran tienda)

Respuesta esperada: `pedido` y `albaran` en el cuerpo (mismo criterio que checkout_pc).

## Estados del pedido (Supabase)

| Momento | `estado` | `estado_procesamiento` |
|---------|----------|------------------------|
| Creacion (`crear_pedido_presencial_tienda`) | `en_preparacion` | `procesando` |
| Tras albaran firmado o impreso correctamente | `completado` | `completado` |

La transicion a completado la hace `marcarPedidoPresencialTiendaCompletado` en `supabase.js`, llamada al final de **Imprimir Albaran** (impresion OK) o **Firmar Albaran** (firma guardada en PDF; aunque falle la impresion fisica, el albaran ya esta hecho).

Si el usuario cancela la firma o falla el guardado del PDF firmado, el pedido sigue en `en_preparacion` / `procesando`.

## Matriz de comportamiento

| Accion | Tipo ERP | Supabase RPC | Impresion |
|--------|----------|--------------|-----------|
| Imprimir Pedido | REMOTO | `crear_pedido_remoto` | checkout_pc remoto |
| Generar sin imprimir | REMOTO | `crear_pedido_remoto_sin_imprimir` | ninguna |
| Imprimir Albaran | PRESENCIAL | `crear_pedido_presencial_tienda` | TiendaPC x2 sin firma (+ Modula opcional) |
| Firmar Albaran | PRESENCIAL | idem | firma + TiendaPC x1 (+ Modula opcional) |
